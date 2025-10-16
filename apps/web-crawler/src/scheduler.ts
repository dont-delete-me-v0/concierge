import 'dotenv/config';
import cron from 'node-cron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { main as runCrawler } from './index';

const CRAWLER_SCHEDULE = process.env.CRAWLER_SCHEDULE || '0 */3 * * *'; // Every 3 hours by default
const CONFIG_DIR = process.env.CONFIG_DIR || 'crawl-configs';

async function findAllConfigs(dir: string): Promise<string[]> {
  const configs: string[] = [];
  const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);

  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subConfigs = await findAllConfigs(fullPath);
        configs.push(...subConfigs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        configs.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Failed to read directory ${absDir}:`, err);
  }

  return configs;
}

async function runScheduledCrawl(): Promise<void> {
  console.log('\n=================================');
  console.log('🕐 Scheduled crawler run started');
  console.log(`📅 Time: ${new Date().toISOString()}`);
  console.log('=================================\n');

  try {
    const configs = await findAllConfigs(CONFIG_DIR);

    if (configs.length === 0) {
      console.warn(`⚠️  No configs found in ${CONFIG_DIR}`);
      return;
    }

    console.log(`📋 Found ${configs.length} config(s) to process:`);
    configs.forEach((cfg, idx) => {
      console.log(`  ${idx + 1}. ${path.relative(process.cwd(), cfg)}`);
    });
    console.log();

    // Set the config path as command-line argument for the crawler
    const originalArgs = process.argv.slice(2);
    process.argv = ['node', 'scheduler.ts', configs.join(',')];

    await runCrawler();

    // Restore original args
    process.argv = ['node', 'scheduler.ts', ...originalArgs];

    console.log('\n✅ Scheduled crawler run completed successfully\n');
  } catch (err) {
    console.error('\n❌ Scheduled crawler run failed:', err);
  }
}

async function main(): Promise<void> {
  console.log('🚀 Crawler Scheduler starting...');
  console.log(`📅 Schedule: ${CRAWLER_SCHEDULE}`);
  console.log(`📂 Config directory: ${CONFIG_DIR}`);
  console.log(`🔍 Node environment: ${process.env.NODE_ENV || 'development'}`);

  // Validate cron expression
  if (!cron.validate(CRAWLER_SCHEDULE)) {
    console.error(`❌ Invalid cron expression: ${CRAWLER_SCHEDULE}`);
    process.exit(1);
  }

  // Run immediately on startup
  console.log('\n🏃 Running initial crawl on startup...\n');
  await runScheduledCrawl();

  // Schedule recurring runs
  console.log(`\n⏰ Scheduling recurring runs with pattern: ${CRAWLER_SCHEDULE}`);
  const task = cron.schedule(CRAWLER_SCHEDULE, async () => {
    await runScheduledCrawl();
  });

  console.log('✅ Scheduler is running. Press Ctrl+C to stop.\n');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Received SIGINT signal. Stopping scheduler...');
    task.stop();
    console.log('✅ Scheduler stopped gracefully');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Received SIGTERM signal. Stopping scheduler...');
    task.stop();
    console.log('✅ Scheduler stopped gracefully');
    process.exit(0);
  });
}

// Execute only when run directly
if (require.main === module) {
  void main();
}

export { main };
