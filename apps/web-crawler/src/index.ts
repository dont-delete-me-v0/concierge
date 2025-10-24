import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  parseDateRangeUaToUtcIso,
  parseDateTimeUaToUtcIso,
} from './dateUtils';
import {
  computeRowHash,
  loadIncrementalState,
  saveIncrementalState,
} from './incremental';
import { parsePriceFrom } from './priceUtils';
import { RabbitPublisher } from './rabbitmq';
import { closeRedis, markSeen, updateMeta, wasSeen } from './redisState';
import { ConfigurableScraper } from './scraper';
import {
  trackCriticalError,
  trackProgressEdit,
  trackProgressStart,
} from './tracker';
import {
  validateConfig,
  type ExtractedRow,
  type ScraperConfig,
} from './types';

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

async function runOnce(
  config: ScraperConfig,
  configName?: string,
  scraper?: ConfigurableScraper,
  shouldInit: boolean = true
): Promise<void> {
  console.log('🚀 Starting crawler run...');
  const scraperInstance = scraper ?? new ConfigurableScraper(config);
  let progressMessageId: number | null = null;
  try {
    if (shouldInit) {
      console.log('🌐 Initializing browser...');
      await scraperInstance.init();
    }
    const incremental = config.incremental;
    const out = config.outputFile ?? 'results.json';

    if (!incremental?.enabled) {
      progressMessageId = await trackProgressStart('⏱️ Парсинг розпочато', {
        configName,
        url: config.url,
      });
      console.log('📊 Scraping data (no incremental mode)...');
      const rows = await scraperInstance.scrape();
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
        `✅ Завдання завершено: опубліковано ${rows.length} елементів`,
        {
          configName,
          itemsCount: rows.length,
        }
      );
      return;
    }

    const uniqueKey = incremental.uniqueKey ?? [];
    if (uniqueKey.length === 0) {
      progressMessageId = await trackProgressStart('⏱️ Парсинг розпочато', {
        configName,
        url: config.url,
      });
      console.log('📊 Scraping data (no unique key)...');
      const rows = await scraperInstance.scrape();
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
        `✅ Завдання завершено: опубліковано ${rows.length} елементів`,
        {
          configName,
          itemsCount: rows.length,
        }
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
    progressMessageId = await trackProgressStart('⏱️ Парсинг розпочато', {
      configName,
      url: config.url,
    });
    console.log('📊 Scraping data...');
    const allRows = await scraperInstance.scrape();
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
      ExtractedRow & { changes?: import('./types').ChangeRecord[] }
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
      const { diffRows } = await import('./incremental');
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
      `✅ Завдання завершено${updateExisting ? `: нових ${newRows.length}, оновлених ${updatedRows.length}` : `: опубліковано ${outputRows.length} елементів`}`,
      {
        configName,
        itemsCount: outputRows.length,
        newItems: newRows.length,
        ...(updateExisting && updatedRows.length > 0
          ? { updatedItems: updatedRows.length }
          : {}),
      }
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
    const errorMessage = (err as Error)?.message ?? String(err);
    console.error('❌ Crawler error:', errorMessage);
    try {
      await trackCriticalError(
        `❌ Парсинг завершився з помилкою: ${errorMessage}`,
        {
          configName,
          errorDetails: errorMessage,
        }
      );
    } catch (trackErr) {
      console.error('Failed to send error notification:', trackErr);
    }
    throw err;
  } finally {
    // Don't close scraper here if it was passed in - let the caller handle it
    if (!scraper) {
      await scraperInstance.close();
    }
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
      // Use directory structure for better identification: kyiv/humor/config.json -> kyiv-humor
      const relativePath = path.relative(process.cwd(), configPath);
      const parts = relativePath.split(path.sep);
      const configName = parts.length >= 3
        ? parts.slice(-3, -1).join('-') // e.g., "kyiv-humor"
        : path.basename(configPath); // fallback to filename
      const scraper = new ConfigurableScraper(cfg);

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          console.log(`Run attempt ${attempt + 1}/${retries + 1}`);

          // On retry attempts, rotate proxy and user-agent if configured
          if (attempt > 0 && (cfg.proxyFile || cfg.userAgents)) {
            console.log('🔄 Rotating proxy and user-agent before retry...');
            try {
              await scraper.rotateProxyAndUserAgent();
            } catch (rotateErr) {
              console.warn('Failed to rotate proxy/user-agent:', rotateErr);
            }
          }

          await runOnce(cfg, configName, scraper, attempt === 0);
          break;
        } catch (err) {
          const errorMessage = (err as Error)?.message ?? String(err);
          console.error(`Run attempt ${attempt + 1} failed:`, errorMessage);

          if (attempt === retries) {
            // Last attempt failed
            console.error(
              `All ${retries + 1} attempts failed for ${configName}`
            );
            process.exitCode = 1;
            break;
          }

          // Check if error is proxy/network related
          const isProxyError =
            errorMessage.includes('429') ||
            errorMessage.includes('403') ||
            errorMessage.includes('503') ||
            errorMessage.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
            errorMessage.includes('ERR_PROXY_CONNECTION_FAILED');

          if (isProxyError) {
            console.log(
              '🔄 Proxy/network error detected, will rotate on next attempt'
            );
          }

          // Wait before retry
          const waitTime = 1000 * (attempt + 1);
          console.log(`Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
        }
      }

      // Always close scraper
      await scraper.close();
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

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exitCode = 1;
});

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
  process.exitCode = 1;
  // Give time for logs to flush
  setTimeout(() => process.exit(1), 1000);
});

// Execute only when run directly
if (require.main === module) {
  void main();
}

export { main };
