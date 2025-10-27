import 'dotenv/config';
import { CronJob } from 'cron';
import InstagramScraper from './index';
import { trackProgress } from './tracker';

/**
 * Scheduler for Instagram scraper
 * Runs the scraper on a cron schedule
 */
class InstagramScraperScheduler {
  private job: CronJob | null = null;
  private isRunning = false;

  constructor(private cronExpression: string) {
    console.log(`📅 Instagram scraper scheduler initialized with cron: ${cronExpression}`);
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
        await this.runScraper();
      },
      null,
      true,
      'Europe/Kiev'
    );

    console.log('✅ Instagram scraper scheduler started');
    trackProgress('📅 Instagram scraper scheduler started', {
      cron: this.cronExpression,
      timezone: 'Europe/Kiev',
    });

    // Run immediately on start
    this.runScraper();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('⏹️ Instagram scraper scheduler stopped');
    }
  }

  /**
   * Run the scraper
   */
  private async runScraper(): Promise<void> {
    if (this.isRunning) {
      console.log('⏳ Scraper is already running, skipping this run');
      return;
    }

    this.isRunning = true;
    console.log('🔄 Starting scheduled Instagram scraper run...');

    try {
      const config = {
        apifyToken: process.env.APIFY_TOKEN || '',
        apifyActorId: process.env.APIFY_ACTOR_ID || 'shu8hvrXbJbY3Eb9W',
        accounts: process.env.INSTAGRAM_ACCOUNTS?.split(',').map(a => a.trim()),
        hashtags: process.env.INSTAGRAM_HASHTAGS?.split(',').map(h => h.trim()),
        locations: process.env.INSTAGRAM_LOCATIONS?.split(',').map(l => l.trim()),
        resultsLimit: Number(process.env.RESULTS_LIMIT || 200),
        saveOutput:
          String(process.env.SAVE_OUTPUT || 'false').toLowerCase() === 'true',
        outputFile: process.env.OUTPUT_FILE || 'instagram-posts.json',
        // AI configuration
        aiProvider: process.env.AI_PROVIDER || 'openai',
        aiApiKey: process.env.AI_API_KEY,
        aiModel: process.env.AI_MODEL,
        minConfidence: Number(process.env.MIN_AI_CONFIDENCE || 0.7),
      };

      const scraper = new InstagramScraper(config);
      await scraper.run();

      console.log('✅ Scheduled Instagram scraper run completed');
    } catch (error) {
      console.error('❌ Scheduled Instagram scraper run failed:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

// Main entry point
async function main() {
  // Default: run every 3 hours
  const cronExpression = process.env.SCRAPER_CRON || '0 */3 * * *';

  const scheduler = new InstagramScraperScheduler(cronExpression);
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