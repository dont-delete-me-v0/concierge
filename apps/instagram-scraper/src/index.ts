import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { InstagramPost, Event } from './types';
import { RabbitPublisher } from './rabbitmq';
import {
  trackProgressStart,
  trackProgressEdit,
  trackCriticalError,
} from './tracker';
import {
  AIProvider,
  createAIExtractor,
  aiEventToEvent,
} from './aiExtractor';
import { RedisPostCache } from './redisPostCache';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Instagram scraper configuration
 */
interface ScraperConfig {
  apifyToken: string;
  apifyActorId: string;
  accounts?: string[];
  hashtags?: string[];
  locations?: string[];
  resultsLimit?: number;
  saveOutput?: boolean;
  outputFile?: string;
  // AI configuration
  aiProvider: string;
  aiApiKey?: string;
  aiModel?: string;
  minConfidence?: number;
}

/**
 * Main Instagram scraper class - AI-powered event extraction
 */
export class InstagramScraper {
  private client: ApifyClient;
  private config: ScraperConfig;
  private publisher: RabbitPublisher;
  private aiExtractor: AIProvider | null;
  private redisCache: RedisPostCache;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.client = new ApifyClient({
      token: config.apifyToken,
    });
    this.publisher = new RabbitPublisher();
    this.redisCache = new RedisPostCache();

    // Initialize AI extractor
    this.aiExtractor = createAIExtractor(
      config.aiProvider,
      config.aiApiKey,
      config.aiModel
    );

    if (!this.aiExtractor) {
      throw new Error(`Failed to initialize AI provider: ${config.aiProvider}`);
    }

    console.log(`🤖 Using AI provider: ${config.aiProvider} (model: ${config.aiModel || 'default'})`);
  }

  /**
   * Fetch Instagram posts from Apify
   */
  async fetchPosts(): Promise<InstagramPost[]> {
    console.log('📱 Fetching Instagram posts from Apify...');

    const allPosts: InstagramPost[] = [];

    // Build direct URLs for accounts
    const accountUrls = this.config.accounts?.map(
      account => `https://www.instagram.com/${account}`
    ) || [];

    // Build direct URLs for hashtags (explore/tags format without trailing slash)
    const hashtagUrls = this.config.hashtags?.map(
      tag => `https://www.instagram.com/explore/tags/${tag.replace('#', '')}`
    ) || [];

    // Fetch from accounts if provided
    if (accountUrls.length > 0) {
      console.log(`👤 Fetching from Accounts: ${this.config.accounts?.join(', ')}`);
      const accountPosts = await this.fetchFromUrls(accountUrls, 'accounts');
      allPosts.push(...accountPosts);
    }

    // Fetch from hashtags if provided (separate request)
    if (hashtagUrls.length > 0) {
      console.log(`#️⃣ Fetching from Hashtags: ${this.config.hashtags?.join(', ')}`);
      const hashtagPosts = await this.fetchFromUrls(hashtagUrls, 'hashtags');
      allPosts.push(...hashtagPosts);
    }

    // Fetch from locations if provided
    if (this.config.locations?.length) {
      console.log(`📍 Fetching from Locations: ${this.config.locations.join(', ')}`);
      const locationPosts = await this.fetchFromLocations(this.config.locations);
      allPosts.push(...locationPosts);
    }

    console.log(`✅ Total fetched: ${allPosts.length} Instagram posts`);
    return allPosts;
  }

  /**
   * Fetch posts from specific URLs (accounts or hashtags)
   */
  private async fetchFromUrls(urls: string[], sourceType: string): Promise<InstagramPost[]> {
    const input: any = {
      directUrls: urls,
      resultsType: 'posts',
      resultsLimit: this.config.resultsLimit || 200,
      searchLimit: 1,
      addParentData: true,
    };

    console.log(`📋 Apify input for ${sourceType}:`, JSON.stringify(input, null, 2));

    try {
      // Run the Actor and wait for it to finish
      const run = await this.client
        .actor(this.config.apifyActorId)
        .call(input);

      // Fetch results from the run's dataset
      const { items } = await this.client
        .dataset(run.defaultDatasetId)
        .listItems();

      console.log(`   ✅ Fetched ${items.length} posts from ${sourceType}`);
      return items as unknown as InstagramPost[];
    } catch (error) {
      console.error(`   ❌ Failed to fetch from ${sourceType}:`, error);
      // Don't throw - continue with other sources
      return [];
    }
  }

  /**
   * Fetch posts from specific locations
   */
  private async fetchFromLocations(locations: string[]): Promise<InstagramPost[]> {
    const input: any = {
      places: locations,
      resultsType: 'posts',
      resultsLimit: this.config.resultsLimit || 200,
      searchLimit: 1,
      addParentData: true,
    };

    console.log(`📋 Apify input for locations:`, JSON.stringify(input, null, 2));

    try {
      // Run the Actor and wait for it to finish
      const run = await this.client
        .actor(this.config.apifyActorId)
        .call(input);

      // Fetch results from the run's dataset
      const { items } = await this.client
        .dataset(run.defaultDatasetId)
        .listItems();

      console.log(`   ✅ Fetched ${items.length} posts from locations`);
      return items as unknown as InstagramPost[];
    } catch (error) {
      console.error(`   ❌ Failed to fetch from locations:`, error);
      // Don't throw - continue with other sources
      return [];
    }
  }

  /**
   * Process Instagram posts with AI (batch mode)
   */
  async processPosts(posts: InstagramPost[]): Promise<Event[]> {
    if (!this.aiExtractor) {
      throw new Error('AI extractor not initialized');
    }

    console.log(`🤖 Processing ${posts.length} posts with AI (batch mode)...`);

    const events: Event[] = [];
    let processed = 0;
    let skipped = 0;

    // Filter out posts without captions
    const validPosts = posts.filter(post => post.caption && post.caption.length >= 10);
    skipped += posts.length - validPosts.length;

    console.log(`📝 Valid posts for analysis: ${validPosts.length}`);

    // Store all posts in Redis for reliable URL lookup
    try {
      await this.redisCache.connect();
      await this.redisCache.storePosts(validPosts);
    } catch (error) {
      console.error('⚠️ Failed to store posts in Redis:', error);
      console.log('⚠️ Continuing without Redis cache...');
    }

    // Check if batch extraction is supported
    if (this.aiExtractor.extractEventsBatch) {
      console.log(`🚀 Using batch extraction with chunking (optimized for llama-3.3-70b-versatile)...`);

      // Split posts into chunks to avoid token limits
      // llama-3.3-70b-versatile TPM limit: 12000 tokens per minute
      // Measured usage: 10 posts = ~5256 tokens
      // Safe strategy: 30s delay allows ~2 chunks per minute (10512 tokens < 12000)
      const CHUNK_SIZE = 10; // Process 10 posts per chunk
      const CHUNK_DELAY_MS = 30000; // 30 seconds delay between chunks to stay under 12000 TPM
      const chunks: InstagramPost[][] = [];

      for (let i = 0; i < validPosts.length; i += CHUNK_SIZE) {
        chunks.push(validPosts.slice(i, i + CHUNK_SIZE));
      }

      console.log(`📦 Split ${validPosts.length} posts into ${chunks.length} chunks (${CHUNK_SIZE} posts per chunk)`);
      console.log(`⏱️  Total estimated time: ~${chunks.length * 2 + (chunks.length - 1) * (CHUNK_DELAY_MS / 1000)} seconds`);

      let allAiResults: any[] = [];

      // Process each chunk
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const chunkOffset = chunkIdx * CHUNK_SIZE; // Calculate offset for this chunk

        console.log(`\n[Chunk ${chunkIdx + 1}/${chunks.length}] Processing ${chunk.length} posts (global offset: ${chunkOffset})...`);

        // Log posts being sent to AI
        console.log('📤 Sending to AI:');
        chunk.forEach((post, idx) => {
          const globalIdx = chunkOffset + idx;
          console.log(`  [${globalIdx}] @${post.ownerUsername}: "${post.caption?.substring(0, 100)}${post.caption && post.caption.length > 100 ? '...' : ''}"`);
        });

        try {
          console.log('⏳ Awaiting AI response...');
          const aiResults = await this.aiExtractor.extractEventsBatch(chunk);
          console.log(`✅ Received AI response with ${aiResults.length} results`);

          // CRITICAL FIX: Correct postIndex by adding chunk offset
          const correctedResults = aiResults.map(result => ({
            ...result,
            postIndex: (result.postIndex ?? 0) + chunkOffset // Add offset to make index global
          }));

          allAiResults.push(...correctedResults);

          // Small delay between chunks to avoid rate limiting
          if (chunkIdx < chunks.length - 1) {
            console.log(`⏸️  Waiting ${CHUNK_DELAY_MS / 1000} seconds before next chunk...`);
            await this.delay(CHUNK_DELAY_MS);
          }
        } catch (error) {
          console.error(`❌ Chunk ${chunkIdx + 1} failed:`, error);
          console.log('⚠️  Continuing with next chunk...');
          // Add placeholder results for failed chunk with correct indices
          chunk.forEach((_, idx) => allAiResults.push({
            isEvent: false,
            confidence: 0,
            postIndex: chunkOffset + idx
          }));
        }
      }

      console.log(`\n✅ All chunks processed. Total results: ${allAiResults.length}`);

      try {
        // Process AI results with proper post-to-event mapping using postIndex
        console.log('\n📊 Processing AI results with corrected post mapping:');

        // Group results by postIndex
        const postEventsMap = new Map<number, any[]>();

        for (const aiResult of allAiResults) {
          const postIdx = aiResult.postIndex ?? 0;
          if (!postEventsMap.has(postIdx)) {
            postEventsMap.set(postIdx, []);
          }
          postEventsMap.get(postIdx)!.push(aiResult);
        }

        // Now process events with correct post assignments
        for (let i = 0; i < validPosts.length; i++) {
          const post = validPosts[i];
          const postAiResults = postEventsMap.get(i) || [];

          console.log(`\n  [Post ${i}] @${post.ownerUsername}:`);
          console.log(`      Post URL: ${post.url}`);
          let postEventsCount = 0;

          for (const aiResult of postAiResults) {
            if (!aiResult) {
              console.log(`      ❌ No result from AI`);
              skipped++;
              continue;
            }

            if (aiResult.isEvent && aiResult.confidence >= (this.config.minConfidence || 0.7)) {
              // Get post URL from Redis using postId for reliable mapping
              let postUrl = post.url; // Default fallback

              if (aiResult.postId) {
                const redisUrl = await this.redisCache.getPostUrl(aiResult.postId);
                if (redisUrl) {
                  postUrl = redisUrl;
                } else {
                  console.warn(`⚠️ Redis URL not found for postId: ${aiResult.postId}, using fallback`);
                }
              }

              // Create event with reliable URL from Redis
              const event = aiEventToEvent(post, aiResult);
              if (event) {
                event.source_url = postUrl; // Override URL with Redis data
              }

              if (event && this.validateEvent(event)) {
                events.push(event);
                processed++;
                postEventsCount++;
                console.log(`      ✅ Event #${postEventsCount}: "${event.title}" (confidence: ${aiResult.confidence.toFixed(2)})`);
                console.log(`         URL: ${event.source_url} (from Redis postId: ${aiResult.postId})`);
              } else {
                console.log(`      ⚠️ Event validation failed`);
                skipped++;
              }
            } else if (aiResult.isEvent) {
              console.log(`      ⚠️ Low confidence (${aiResult.confidence.toFixed(2)}), skipping`);
              skipped++;
            } else {
              console.log(`      ℹ️ Not an event (isEvent: false)`);
              if (postEventsCount === 0) {
                skipped++;
              }
            }
          }

          if (postEventsCount === 0) {
            console.log(`      ℹ️ No valid events found in this post`);
          }
        }

      } catch (error) {
        console.error('❌ Results processing failed:', error);
        console.log('Falling back to single post processing...');
        return this.processSinglePosts(validPosts);
      }

    } else {
      // Fallback to single post processing
      console.log(`🔄 Using single post extraction (legacy mode)...`);
      return this.processSinglePosts(validPosts);
    }

    // Calculate field extraction stats
    const withVenue = events.filter(e => e.venue_name).length;
    const withCategory = events.filter(e => e.category_name).length;
    const withPrice = events.filter(e => e.price_from).length;
    const withDate = events.filter(e => e.date_time).length;

    console.log(`
📊 AI Processing Complete:
- Processed: ${processed} events
- Skipped: ${skipped} posts
- Success rate: ${((processed / validPosts.length) * 100).toFixed(1)}%

📈 Field Extraction Stats:
- With venue: ${withVenue}/${processed} (${((withVenue / processed) * 100).toFixed(0)}%)
- With category: ${withCategory}/${processed} (${((withCategory / processed) * 100).toFixed(0)}%)
- With price: ${withPrice}/${processed} (${((withPrice / processed) * 100).toFixed(0)}%)
- With date: ${withDate}/${processed} (${((withDate / processed) * 100).toFixed(0)}%)
    `);

    return this.deduplicateEvents(events);
  }

  /**
   * Fallback: Process posts one by one
   */
  private async processSinglePosts(posts: InstagramPost[]): Promise<Event[]> {
    const events: Event[] = [];
    let processed = 0;
    let skipped = 0;

    console.log('\n📝 Processing posts one by one (fallback mode)...\n');

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      try {
        console.log(`\n[${i}/${posts.length}] 🔍 Analyzing post from @${post.ownerUsername}...`);
        console.log(`    Caption: "${post.caption?.substring(0, 300)}${post.caption && post.caption.length > 300 ? '...' : ''}"`);

        console.log(`    ⏳ Awaiting AI response...`);
        const aiResult = await this.aiExtractor!.extractEventInfo(post);

        console.log(`    📥 AI Result: ${JSON.stringify(aiResult, null, 2).split('\n').join('\n    ')}`);

        if (aiResult && aiResult.isEvent) {
          if (aiResult.confidence >= (this.config.minConfidence || 0.7)) {
            const event = aiEventToEvent(post, aiResult);
            if (event && this.validateEvent(event)) {
              events.push(event);
              processed++;
              console.log(`    ✅ Event extracted: "${event.title}" (confidence: ${aiResult.confidence.toFixed(2)})`);
            } else {
              console.log(`    ⚠️ Event validation failed`);
              skipped++;
            }
          } else {
            console.log(`    ⚠️ Low confidence (${aiResult.confidence.toFixed(2)}), skipping`);
            skipped++;
          }
        } else {
          console.log(`    ℹ️ Not an event (isEvent: false)`);
          skipped++;
        }

        // Rate limiting for AI API
        await this.delay(500);

      } catch (error) {
        console.error(`    ❌ Error processing post ${post.id}:`, error);
        skipped++;
      }
    }

    console.log(`\n📊 Single post processing complete: ${processed} events, ${skipped} skipped\n`);

    return events;
  }

  /**
   * Validate extracted event - ONLY FUTURE EVENTS
   */
  private validateEvent(event: Event): boolean {
    // Must have title and URL
    if (!event.title || !event.source_url) {
      return false;
    }

    // Title should be reasonable length
    if (event.title.length < 2 || event.title.length > 200) {
      return false;
    }

    // If date exists, it should be valid and IN THE FUTURE
    if (event.date_time) {
      const date = new Date(event.date_time);
      const now = new Date();
      const yearFromNow = new Date();
      yearFromNow.setFullYear(yearFromNow.getFullYear() + 1);

      // Event must be in the future (after now, up to 1 year ahead)
      if (date < now) {
        console.log(`⚠️ Past event skipped: "${event.title}" - ${event.date_time}`);
        return false;
      }

      if (date > yearFromNow) {
        console.log(`⚠️ Too far future: "${event.title}" - ${event.date_time}`);
        return false;
      }
    }

    // Price should be reasonable
    if (event.price_from !== undefined) {
      if (event.price_from < 0 || event.price_from > 100000) {
        console.log(`⚠️ Invalid price for "${event.title}": ${event.price_from}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Remove duplicate events
   */
  private deduplicateEvents(events: Event[]): Event[] {
    console.log(`\n🔄 Deduplicating ${events.length} events...`);
    const uniqueEvents = new Map<string, Event>();
    const semanticDuplicates = new Map<string, Event>(); // Track by title+dates
    let duplicatesRemoved = 0;

    for (const event of events) {
      // Check for exact ID duplicate
      if (uniqueEvents.has(event.id)) {
        duplicatesRemoved++;
        console.log(`  ⚠️ Duplicate by ID: "${event.title}" (ID: ${event.id.substring(0, 8)}...)`);
        continue;
      }

      // Check for semantic duplicate (same title + same dates)
      const semanticKey = this.createSemanticKey(event);
      if (semanticDuplicates.has(semanticKey)) {
        duplicatesRemoved++;
        const existing = semanticDuplicates.get(semanticKey)!;
        console.log(`  ⚠️ Duplicate by content: "${event.title}" on ${event.date_time || 'unknown date'}`);
        console.log(`      Already have: "${existing.title}" with ID ${existing.id.substring(0, 8)}...`);
        continue;
      }

      // Add to both maps
      uniqueEvents.set(event.id, event);
      semanticDuplicates.set(semanticKey, event);
      console.log(`  ✅ Added: "${event.title}" (ID: ${event.id.substring(0, 8)}...)`);
    }

    console.log(`  📊 Result: ${uniqueEvents.size} unique events (removed ${duplicatesRemoved} duplicates)`);
    return Array.from(uniqueEvents.values());
  }

  /**
   * Create a semantic key for deduplication (title + dates)
   */
  private createSemanticKey(event: Event): string {
    const title = event.title.toLowerCase().trim();
    const date = event.date_time || `${event.date_time_from}-${event.date_time_to}` || 'no-date';
    return `${title}|${date}`;
  }

  /**
   * Delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Publish events to RabbitMQ
   */
  async publishEvents(events: Event[]): Promise<void> {
    if (events.length === 0) {
      console.log('⚠️ No events to publish');
      return;
    }

    console.log(`📤 Publishing ${events.length} events to RabbitMQ...`);
    await this.publisher.publishMany(events as unknown as Record<string, unknown>[]);
    console.log(`✅ Published ${events.length} events successfully`);
  }

  /**
   * Save output to file (optional)
   */
  async saveOutput(data: unknown, filePath: string): Promise<void> {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Saved output to ${filePath}`);
  }

  /**
   * Run the scraper
   */
  async run(): Promise<void> {
    console.log('🚀 Starting AI-powered Instagram scraper...');
    let progressMessageId: number | null = null;

    try {
      progressMessageId = await trackProgressStart(
        '🤖 AI Instagram scraper started',
        {
          accounts: this.config.accounts,
          hashtags: this.config.hashtags,
          aiProvider: this.config.aiProvider,
        }
      );

      // Fetch posts from Instagram via Apify
      const posts = await this.fetchPosts();

      // Save raw posts if configured
      if (this.config.saveOutput) {
        await this.saveOutput(
          posts,
          this.config.outputFile || 'instagram-posts.json'
        );
      }

      // Process posts with AI to extract events
      const events = await this.processPosts(posts);

      // Save extracted events if configured
      if (this.config.saveOutput && events.length > 0) {
        await this.saveOutput(
          events,
          this.config.outputFile?.replace('.json', '-events.json') ||
            'instagram-events.json'
        );
      }

      // Publish to RabbitMQ
      await this.publishEvents(events);

      // Update progress
      await trackProgressEdit(
        progressMessageId,
        `✅ AI Instagram scraper completed`,
        {
          postsCount: posts.length,
          eventsCount: events.length,
          accounts: this.config.accounts,
          aiProvider: this.config.aiProvider,
        }
      );

      console.log('✅ AI-powered Instagram scraper completed successfully');
    } catch (error) {
      console.error('❌ Instagram scraper failed:', error);

      await trackCriticalError(error as Error, {
        config: {
          ...this.config,
          aiApiKey: '[REDACTED]', // Don't log API keys
        },
      });

      if (progressMessageId) {
        await trackProgressEdit(
          progressMessageId,
          `❌ Instagram scraper failed: ${(error as Error).message}`
        );
      }

      throw error;
    } finally {
      await this.publisher.close();

      // Close Redis connection
      try {
        await this.redisCache.disconnect();
      } catch (error) {
        console.error('⚠️ Failed to disconnect Redis:', error);
      }
    }
  }
}

// Main entry point
async function main() {
  const config: ScraperConfig = {
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

  // Validate configuration
  if (!config.apifyToken) {
    console.error('❌ APIFY_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!config.aiProvider) {
    console.error('❌ AI_PROVIDER environment variable is required (openai, claude, or ollama)');
    process.exit(1);
  }

  if (config.aiProvider !== 'ollama' && !config.aiApiKey) {
    console.error(`❌ AI_API_KEY environment variable is required for ${config.aiProvider}`);
    process.exit(1);
  }

  if (
    !config.accounts?.length &&
    !config.hashtags?.length &&
    !config.locations?.length
  ) {
    console.error(
      '❌ At least one of INSTAGRAM_ACCOUNTS, INSTAGRAM_HASHTAGS, or INSTAGRAM_LOCATIONS must be provided'
    );
    process.exit(1);
  }

  const scraper = new InstagramScraper(config);
  await scraper.run();
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default InstagramScraper;