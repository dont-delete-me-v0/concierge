import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseDateRangeUaToUtcIso, parseDateTimeUaToUtcIso } from './dateUtils';
import {
  computeRowHash,
  loadIncrementalState,
  saveIncrementalState,
} from './incremental.js';
import { parsePriceFrom } from './priceUtils';
import { RabbitPublisher } from './rabbitmq.js';
import { closeRedis, markSeen, updateMeta, wasSeen } from './redisState.js';
import { ConfigurableScraper } from './scraper.js';
import {
  trackCriticalError,
  trackProgressEdit,
  trackProgressStart,
} from './tracker.js';
import {
  validateConfig,
  type ExtractedRow,
  type ScraperConfig,
} from './types.js';

async function readJsonConfig(filePath: string): Promise<unknown> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const content = await fs.readFile(abs, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const dir = path.dirname(abs);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
}

function toAbsoluteUrl(
  input: string | undefined,
  baseUrl: string,
  overrideBase?: string
): string | undefined {
  if (!input) return undefined;
  try {
    const envBase =
      overrideBase && overrideBase.length > 0 ? overrideBase : undefined;
    const base = envBase && envBase.length > 0 ? envBase : baseUrl;
    return new URL(input, base).toString();
  } catch {
    return input;
  }
}

async function runOnce(config: ScraperConfig): Promise<void> {
  console.log('🚀 Starting crawler run...');
  const scraper = new ConfigurableScraper(config);
  let progressMessageId: number | null = null;
  try {
    console.log('🌐 Initializing browser...');
    await scraper.init();
    const incremental = config.incremental;
    const out = config.outputFile ?? 'results.json';

    if (!incremental?.enabled) {
      progressMessageId = await trackProgressStart('⏱️ Parsing started...');
      console.log('📊 Scraping data (no incremental mode)...');
      const rows = await scraper.scrape();
      console.log(`📈 Scraped ${rows.length} rows`);

      const saveOutput =
        String(process.env.CRAWLER_SAVE_OUTPUT || '').toLowerCase() === 'true';
      if (saveOutput) {
        console.log(`💾 Saving to file: ${out}`);
        await writeJson(out, rows);
        console.log(`✅ Saved ${rows.length} rows to ${out}`);
      }

      // Publish to RabbitMQ using all fields as identity when uniqueKey not provided
      console.log('📤 Publishing to RabbitMQ...');
      const fallbackKeys = rows.length > 0 ? Object.keys(rows[0]).sort() : [];
      const publisher = new RabbitPublisher();
      await publisher.publishMany(
        rows.map(row => {
          const range = parseDateRangeUaToUtcIso(
            (row.dateTime ?? row.date_time ?? '').toString()
          );
          const absLink = toAbsoluteUrl(
            row.link,
            config.url,
            config.source_base_url
          );
          return {
            id: computeRowHash(row, fallbackKeys),
            title: row.title,
            description: row.description,
            // Names for resolution on consumer side
            category_name:
              row.category ??
              row.category_name ??
              (config.category_name || undefined),
            venue_name: row.venue ?? row.venue_name,
            category_id: null,
            venue_id: null,
            date_time:
              range.from ||
              parseDateTimeUaToUtcIso(row.dateTime ?? row.date_time ?? ''),
            date_time_from: range.from,
            date_time_to: range.to,
            price_from: parsePriceFrom(row.price),
            source_url: absLink,
          };
        })
      );
      await publisher.close();
      console.log(`✅ Published ${rows.length} rows to RabbitMQ`);
      await trackProgressEdit(
        progressMessageId,
        `✅ Done: ${rows.length} items published`
      );
      return;
    }

    const uniqueKey = incremental.uniqueKey ?? [];
    if (uniqueKey.length === 0) {
      progressMessageId = await trackProgressStart('⏱️ Parsing started...');
      console.log('📊 Scraping data (no unique key)...');
      const rows = await scraper.scrape();
      console.log(`📈 Scraped ${rows.length} rows`);

      const saveOutput =
        String(process.env.CRAWLER_SAVE_OUTPUT || '').toLowerCase() === 'true';
      if (saveOutput) {
        console.log(`💾 Saving to file: ${out}`);
        await writeJson(out, rows);
        console.log(`✅ Saved ${rows.length} rows to ${out}`);
      }

      console.log('📤 Publishing to RabbitMQ...');
      const fallbackKeys = rows.length > 0 ? Object.keys(rows[0]).sort() : [];
      const publisher = new RabbitPublisher();
      await publisher.publishMany(
        rows.map(row => {
          const range = parseDateRangeUaToUtcIso(
            (row.dateTime ?? row.date_time ?? '').toString()
          );
          const absLink = toAbsoluteUrl(
            row.link,
            config.url,
            config.source_base_url
          );
          return {
            id: computeRowHash(row, fallbackKeys),
            title: row.title,
            description: row.description,
            category_name:
              row.category ??
              row.category_name ??
              (config.category_name || undefined),
            venue_name: row.venue ?? row.venue_name,
            category_id: null,
            venue_id: null,
            date_time:
              range.from ||
              parseDateTimeUaToUtcIso(row.dateTime ?? row.date_time ?? ''),
            date_time_from: range.from,
            date_time_to: range.to,
            price_from: parsePriceFrom(row.price),
            source_url: absLink,
          };
        })
      );
      await publisher.close();
      console.log(`✅ Published ${rows.length} rows to RabbitMQ`);
      await trackProgressEdit(
        progressMessageId,
        `✅ Done: ${rows.length} items published`
      );
      return;
    }

    // Force Redis for state when URL is available, otherwise fall back to JSON
    const useRedis =
      (process.env.REDIS_URL || 'redis://localhost:6379').length > 0;
    const prefix =
      (config as ScraperConfig & { state_prefix?: string }).state_prefix ||
      process.env.STATE_PREFIX ||
      'concert.ua';

    console.log(
      `🔍 Incremental mode enabled (Redis: ${useRedis ? '✅' : '❌'})`
    );
    console.log(`🔑 Unique key: [${uniqueKey.join(', ')}]`);
    console.log(`🏷️  State prefix: ${prefix}`);

    const existingState = useRedis
      ? null
      : await loadIncrementalState('state.json');
    const existingHashes = useRedis
      ? new Set<string>()
      : new Set<string>(existingState?.hashes ?? []);

    // Always fully scrape; deduplicate on write
    progressMessageId = await trackProgressStart('⏱️ Parsing started...');
    console.log('📊 Scraping data...');
    const allRows = await scraper.scrape();
    console.log(`📈 Scraped ${allRows.length} total rows`);

    // Process rows: find new ones, optionally detect changes for existing
    console.log('🔍 Processing rows for deduplication...');
    const newRows: ExtractedRow[] = [];
    const newHashes: string[] = [];
    const updatedItems: Array<{ hash: string; row: ExtractedRow }> = [];
    const trackChanges = incremental.trackChanges ?? false;
    const updateExisting = incremental.updateExisting ?? false;

    for (const row of allRows) {
      const hash = computeRowHash(row, uniqueKey);
      const seen = useRedis
        ? await wasSeen(prefix, hash)
        : existingHashes.has(hash);
      if (!seen) {
        newRows.push(row);
        newHashes.push(hash);
      } else if (trackChanges || updateExisting) {
        updatedItems.push({ hash, row });
      }
    }

    console.log(
      `📊 Found ${newRows.length} new rows, ${updatedItems.length} existing rows`
    );

    // Build updated rows if needed
    const updatedRows: ExtractedRow[] = [];
    const itemsState: Record<
      string,
      ExtractedRow & { changes?: import('./types.js').ChangeRecord[] }
    > =
      trackChanges || updateExisting
        ? Object.create(null)
        : (undefined as unknown as Record<string, ExtractedRow>);

    // Seed items state with existing when present
    const existingItems =
      (existingState as unknown as { items?: typeof itemsState })?.items ??
      undefined;

    if (trackChanges || updateExisting) {
      // Carry over previous items to preserve history
      if (existingItems) {
        for (const [h, item] of Object.entries(existingItems)) {
          itemsState[h] = { ...item } as (typeof itemsState)[string];
        }
      }
    }

    if (trackChanges || updateExisting) {
      const { diffRows } = await import('./incremental.js');
      for (const { hash, row } of updatedItems) {
        const prev = existingItems?.[hash];
        if (!prev) continue; // Should exist if hash known
        const diffs = diffRows(prev, row, uniqueKey);
        if (diffs.length > 0) {
          if (trackChanges) {
            const existingHistory = Array.isArray(prev.changes)
              ? prev.changes
              : [];
            itemsState[hash] = {
              ...row,
              changes: [...existingHistory, ...diffs],
            } as (typeof itemsState)[string];
          } else {
            itemsState[hash] = { ...row } as (typeof itemsState)[string];
          }
          if (updateExisting) updatedRows.push(row);
        } else if (!(hash in itemsState)) {
          // No change but ensure item present
          itemsState[hash] = { ...row } as (typeof itemsState)[string];
        }
      }
    }

    // Add new items to items state when enabled
    if (trackChanges || updateExisting) {
      for (let i = 0; i < newRows.length; i++) {
        const h = newHashes[i];
        const r = newRows[i];
        itemsState[h] = { ...r } as (typeof itemsState)[string];
      }
    }

    // Write output: new rows plus optionally updated rows
    // Special case for Redis (no local items to diff): also send existing rows that have description OR venue info
    const minorUpdateRows: ExtractedRow[] = [];
    if (updatedItems.length > 0) {
      for (const { row } of updatedItems) {
        const desc = (row.description || '').toString().trim();
        const venueTxt = (row.venue || row.venue_name || '').toString().trim();
        if (desc.length > 0 || venueTxt.length > 0) minorUpdateRows.push(row);
      }
    }
    const outputRows = updateExisting
      ? [...newRows, ...updatedRows, ...minorUpdateRows]
      : [...newRows, ...minorUpdateRows];
    const saveOutput =
      String(process.env.CRAWLER_SAVE_OUTPUT || '').toLowerCase() === 'true';
    if (saveOutput) {
      await writeJson(out, outputRows);
      console.log(
        `Saved ${newRows.length} new${updateExisting ? ` and ${updatedRows.length} updated` : ''} rows to ${out}`
      );
    }

    // Publish to RabbitMQ with batching and confirms
    console.log('📤 Publishing to RabbitMQ...');
    const publisher = new RabbitPublisher();
    await publisher.publishMany(
      outputRows.map(row => {
        const range = parseDateRangeUaToUtcIso(
          (row.dateTime ?? row.date_time ?? '').toString()
        );
        const absLink = toAbsoluteUrl(
          row.link,
          config.url,
          config.source_base_url
        );
        return {
          id: computeRowHash(row, uniqueKey),
          title: row.title,
          description: row.description,
          category_name:
            row.category ??
            row.category_name ??
            (config.category_name || undefined),
          venue_name: row.venue ?? row.venue_name,
          category_id: null,
          venue_id: null,
          date_time:
            range.from ||
            parseDateTimeUaToUtcIso(row.dateTime ?? row.date_time ?? ''),
          date_time_from: range.from,
          date_time_to: range.to,
          price_from: parsePriceFrom(row.price),
          source_url: absLink,
        };
      })
    );
    await publisher.close();
    console.log(
      `✅ Published ${outputRows.length} ${updateExisting ? `(new: ${newRows.length}, updated: ${updatedRows.length}) ` : ''}rows to RabbitMQ`
    );
    await trackProgressEdit(
      progressMessageId,
      `✅ Done: ${outputRows.length} ${updateExisting ? `(new: ${newRows.length}, updated: ${updatedRows.length}) ` : ''}published`
    );

    // Build next state
    console.log('💾 Updating state...');
    if (useRedis) {
      await markSeen(prefix, newHashes);
      // We cannot know the full set size cheaply; set totalItems to SCard
      const total =
        (await (
          await import('redis')
        )
          .createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
          })
          .connect()
          .then(async c => {
            try {
              const n = await c.sCard(`${prefix}:hashes`);
              await c.quit();
              return n;
            } catch {
              try {
                await c.quit();
              } catch {}
              return undefined;
            }
          })) ?? newHashes.length;
      await updateMeta(prefix, Number(total));
      console.log(
        `✅ Updated Redis state for ${prefix} with ${newHashes.length} new hashes (total: ${total})`
      );
    } else {
      const nextHashes = Array.from(
        new Set([...(existingState?.hashes ?? []), ...newHashes])
      );
      const nextState = {
        lastUpdate: new Date().toISOString(),
        totalItems: nextHashes.length,
        hashes: nextHashes,
        ...(trackChanges || updateExisting ? { items: itemsState } : {}),
      } as const;
      await saveIncrementalState('state.json', nextState);
      console.log(
        `✅ Updated state with ${newHashes.length} new hashes at state.json (total: ${nextHashes.length})`
      );
    }
  } catch (err) {
    try {
      await trackCriticalError(
        `❌ Crawler failed: ${(err as Error)?.message ?? String(err)}`
      );
    } catch {}
    throw err;
  } finally {
    await scraper.close();
  }
}

async function main(): Promise<void> {
  try {
    const inputArg = process.argv[2] ?? 'config.json';

    async function resolveConfigPaths(input: string): Promise<string[]> {
      const tokens = input
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const out: string[] = [];
      for (const t of tokens) {
        const abs = path.isAbsolute(t) ? t : path.join(process.cwd(), t);
        try {
          const st = await fs.stat(abs);
          if (st.isDirectory()) {
            const files = await fs.readdir(abs);
            for (const f of files) {
              if (f.toLowerCase().endsWith('.json')) {
                out.push(path.join(abs, f));
              }
            }
          } else {
            out.push(abs);
          }
        } catch {
          // treat as file path that may not exist; still try read later for clear error
          out.push(abs);
        }
      }
      return out;
    }

    const configPaths = await resolveConfigPaths(inputArg);
    if (configPaths.length === 0) {
      console.error('No config paths resolved.');
      process.exitCode = 1;
      return;
    }

    for (const configPath of configPaths) {
      console.log(`\n==== Running config: ${configPath} ====`);
      const raw = await readJsonConfig(configPath);
      const validated = validateConfig(raw);
      if (!validated.ok) {
        console.error('Invalid config:');
        for (const err of validated.errors) console.error(`- ${err}`);
        // mark failure for this config and continue to next
        process.exitCode = 1;
        continue;
      }
      const cfg = validated.config;
      const retries = cfg.retries ?? 0;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          console.log(`Run attempt ${attempt + 1}/${retries + 1}`);
          await runOnce(cfg);
          break;
        } catch (err) {
          console.error('Run failed:', err);
          if (attempt === retries) {
            process.exitCode = 1;
            break;
          }
          await sleep(1000 * (attempt + 1));
        }
      }
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  } finally {
    // Ensure all connections are closed
    // publisher is created per run and closed above
    await closeRedis();
    process.exit(process.exitCode || 0);
  }
}

// Execute only when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

export { main };
