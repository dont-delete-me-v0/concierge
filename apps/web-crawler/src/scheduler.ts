import 'dotenv/config';
import { CronJob } from 'cron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCrawler } from './index';

/**
 * Scheduler for web crawler
 * Runs the crawler on a cron schedule
 */
class WebCrawlerScheduler {
  private job: CronJob | null = null;
  private isRunning = false;
  private configDir: string;

  constructor(private cronExpression: string, configDir?: string) {
    this.configDir = configDir || process.env.CONFIG_DIR || 'crawl-configs';
    console.log(`📅 Web crawler scheduler initialized with cron: ${cronExpression}`);
    console.log(`📂 Config directory: ${this.configDir}`);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.job) {
      console.warn('⚠️ Scheduler is already running');
      return;
    }

    this.job = new CronJob(
      this.cronExpression,
      async () => {
        await this.runCrawler();
      },
      null,
      true,
      'Europe/Kiev'
    );

    console.log('✅ Web crawler scheduler started');

    // Run immediately on start
    this.runCrawler();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('⏹️ Web crawler scheduler stopped');
    }
  }

  /**
   * Find all config files recursively
   */
  private async findAllConfigs(dir: string): Promise<string[]> {
    const configs: string[] = [];
    const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);

    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(absDir, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subConfigs = await this.findAllConfigs(fullPath);
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

  /**
   * Run the crawler
   */
  private async runCrawler(): Promise<void> {
    if (this.isRunning) {
      console.log('⏳ Crawler is already running, skipping this run');
      return;
    }

    this.isRunning = true;
    console.log('\n=================================');
    console.log('🕐 Scheduled crawler run started');
    console.log(`📅 Time: ${new Date().toISOString()}`);
    console.log('=================================\n');

    try {
      const configs = await this.findAllConfigs(this.configDir);

      if (configs.length === 0) {
        console.warn(`⚠️  No configs found in ${this.configDir}`);
        return;
      }

      console.log(`📋 Found ${configs.length} config(s) to process:`);
      configs.forEach((cfg, idx) => {
        console.log(`  ${idx + 1}. ${path.relative(process.cwd(), cfg)}`);
      });
      console.log();

      // Pass configs as comma-separated string to runCrawler
      await runCrawler(configs.join(','));

      console.log('\n✅ Scheduled crawler run completed successfully\n');
    } catch (error) {
      console.error('\n❌ Scheduled crawler run failed:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Main entry point
async function main() {
  // Default: run every 3 hours
  const cronExpression = process.env.CRAWLER_SCHEDULE || '0 */3 * * *';

  const scheduler = new WebCrawlerScheduler(cronExpression);
  scheduler.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, stopping scheduler...');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, stopping scheduler...');
    scheduler.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
