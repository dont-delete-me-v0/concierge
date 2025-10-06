import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConfigurableScraper } from './scraper.js';
import { validateConfig, type ScraperConfig } from './types.js';

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
  const scraper = new ConfigurableScraper(config);
  try {
    await scraper.init();
    const rows = await scraper.scrape();
    const out = config.outputFile ?? 'results.json';
    await writeJson(out, rows);
    console.log(`Saved ${rows.length} rows to ${out}`);
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
  }
}

// Execute only when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

export { main };
