import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  computeRowHash,
  loadIncrementalState,
  saveIncrementalState,
} from './incremental.js';
import { RabbitPublisher } from './rabbitmq.js';
import { closeRedis, markSeen, updateMeta, wasSeen } from './redisState.js';
import { ConfigurableScraper } from './scraper.js';
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

async function runOnce(config: ScraperConfig): Promise<void> {
  console.log('🚀 Starting crawler run...');
  const scraper = new ConfigurableScraper(config);
  try {
    console.log('🌐 Initializing browser...');
    await scraper.init();
    const incremental = config.incremental;
    const out = config.outputFile ?? 'results.json';

    if (!incremental?.enabled) {
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
        rows.map(row => ({
          id: computeRowHash(row, fallbackKeys),
          title: row.title,
          price: row.price,
          link: row.link,
          eventId: row.eventId,
          dateTime: row.dateTime,
          venue: row.venue,
        }))
      );
      await publisher.close();
      console.log(`✅ Published ${rows.length} rows to RabbitMQ`);
      return;
    }

    const uniqueKey = incremental.uniqueKey ?? [];
    if (uniqueKey.length === 0) {
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
        rows.map(row => ({
          id: computeRowHash(row, fallbackKeys),
          title: row.title,
          price: row.price,
          link: row.link,
          eventId: row.eventId,
          dateTime: row.dateTime,
          venue: row.venue,
        }))
      );
      await publisher.close();
      console.log(`✅ Published ${rows.length} rows to RabbitMQ`);
      return;
    }

    // Force Redis for state when URL is available, otherwise fall back to JSON
    const useRedis =
      (process.env.REDIS_URL || 'redis://localhost:6379').length > 0;
    const prefix = process.env.STATE_PREFIX || 'concert.ua';

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
    const outputRows = updateExisting ? [...newRows, ...updatedRows] : newRows;
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
      outputRows.map(row => ({
        id: computeRowHash(row, uniqueKey),
        title: row.title,
        price: row.price,
        link: row.link,
        eventId: row.eventId,
        dateTime: row.dateTime,
        venue: row.venue,
      }))
    );
    await publisher.close();
    console.log(
      `✅ Published ${outputRows.length} ${updateExisting ? `(new: ${newRows.length}, updated: ${updatedRows.length}) ` : ''}rows to RabbitMQ`
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
  } finally {
    await scraper.close();
  }
}

async function main(): Promise<void> {
  try {
    const configPath = process.argv[2] ?? 'config.json';
    const raw = await readJsonConfig(configPath);
    const validated = validateConfig(raw);
    if (!validated.ok) {
      console.error('Invalid config:');
      for (const err of validated.errors) console.error(`- ${err}`);
      process.exitCode = 1;
      return;
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
