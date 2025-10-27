/**
 * DEPRECATED: This hybrid extractor is not used in the current implementation.
 * The application uses pure AI extraction as requested by the user.
 * Keeping this file for reference only.
 *
 * User requirement: "гибрид тогда не нужен, пусть тогда всё делает AI а код только получает и отправляет данные"
 * (Translation: "hybrid is not needed then, let AI do everything and the code just receives and sends data")
 */

import { InstagramPost, Event } from './types';
import { extractEventInfo, instagramPostToEvent } from './eventExtractor';
import {
  AIProvider,
  createAIExtractor,
  aiEventToEvent,
  ExtractedEventAI
} from './aiExtractor';

export interface HybridExtractorConfig {
  useAI: boolean;
  aiProvider?: string;
  aiApiKey?: string;
  aiModel?: string;
  fallbackToRegex: boolean;
  minConfidence: number;
}

/**
 * Hybrid extractor that combines AI and regex-based extraction
 */
export class HybridEventExtractor {
  private config: HybridExtractorConfig;
  private aiExtractor: AIProvider | null = null;

  constructor(config: Partial<HybridExtractorConfig> = {}) {
    this.config = {
      useAI: config.useAI ?? false,
      aiProvider: config.aiProvider,
      aiApiKey: config.aiApiKey,
      aiModel: config.aiModel,
      fallbackToRegex: config.fallbackToRegex ?? true,
      minConfidence: config.minConfidence ?? 0.7
    };

    if (this.config.useAI && this.config.aiProvider) {
      this.aiExtractor = createAIExtractor(
        this.config.aiProvider,
        this.config.aiApiKey
      );

      if (!this.aiExtractor) {
        console.warn('⚠️ AI extractor initialization failed, falling back to regex');
        this.config.useAI = false;
      }
    }
  }

  /**
   * Extract events from Instagram posts using hybrid approach
   */
  async extractEventsFromPosts(posts: InstagramPost[]): Promise<Event[]> {
    console.log(`🔍 Processing ${posts.length} Instagram posts...`);

    const events: Event[] = [];
    let aiProcessed = 0;
    let regexProcessed = 0;
    let skipped = 0;

    for (const post of posts) {
      try {
        let event: Event | null = null;

        // Try AI extraction first if enabled
        if (this.config.useAI && this.aiExtractor) {
          const aiResult = await this.extractWithAI(post);
          if (aiResult) {
            event = aiResult;
            aiProcessed++;
          }
        }

        // Fallback to regex if AI failed or disabled
        if (!event && this.config.fallbackToRegex) {
          event = this.extractWithRegex(post);
          if (event) {
            regexProcessed++;
          }
        }

        if (event) {
          events.push(event);
        } else {
          skipped++;
        }

        // Process child posts (carousel items)
        if (post.childPosts && post.childPosts.length > 0) {
          for (const childPost of post.childPosts) {
            // Child posts may not have separate captions
            if (!childPost.caption) {
              childPost.caption = post.caption;
            }

            let childEvent: Event | null = null;

            if (this.config.useAI && this.aiExtractor) {
              childEvent = await this.extractWithAI(childPost);
            }

            if (!childEvent && this.config.fallbackToRegex) {
              childEvent = this.extractWithRegex(childPost);
            }

            if (childEvent && childEvent.id !== event?.id) {
              events.push(childEvent);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing post ${post.id}:`, error);
      }

      // Rate limiting for AI providers
      if (this.config.useAI && this.aiExtractor) {
        await this.delay(100); // 100ms delay between AI calls
      }
    }

    console.log(`✅ Extraction complete:
    - AI processed: ${aiProcessed}
    - Regex processed: ${regexProcessed}
    - Skipped: ${skipped}
    - Total events: ${events.length}`);

    // Remove duplicates
    const uniqueEvents = this.deduplicateEvents(events);

    return uniqueEvents;
  }

  /**
   * Extract event using AI
   */
  private async extractWithAI(post: InstagramPost): Promise<Event | null> {
    if (!this.aiExtractor || !post.caption) {
      return null;
    }

    try {
      const aiResult = await this.aiExtractor.extractEventInfo(post);

      if (!aiResult || !aiResult.isEvent) {
        return null;
      }

      if (aiResult.confidence < this.config.minConfidence) {
        console.log(`⚠️ Low confidence (${aiResult.confidence}) for post ${post.id}`);
        return null;
      }

      const event = aiEventToEvent(post, aiResult);
      if (event) {
        console.log(`🤖 AI extracted: "${event.title}" from @${post.ownerUsername}`);
      }
      return event;
    } catch (error) {
      console.error('AI extraction error:', error);
      return null;
    }
  }

  /**
   * Extract event using regex patterns
   */
  private extractWithRegex(post: InstagramPost): Event | null {
    const event = instagramPostToEvent(post);
    if (event) {
      console.log(`📝 Regex extracted: "${event.title}" from @${post.ownerUsername}`);
    }
    return event;
  }

  /**
   * Remove duplicate events by ID
   */
  private deduplicateEvents(events: Event[]): Event[] {
    const uniqueEvents = new Map<string, Event>();
    for (const event of events) {
      uniqueEvents.set(event.id, event);
    }
    return Array.from(uniqueEvents.values());
  }

  /**
   * Delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate extracted event data
   */
  public validateEvent(event: Event): boolean {
    // Must have title and source URL
    if (!event.title || !event.source_url) {
      return false;
    }

    // If date exists, it should be valid
    if (event.date_time && isNaN(Date.parse(event.date_time))) {
      return false;
    }

    // Price should be reasonable
    if (event.price_from && (event.price_from < 0 || event.price_from > 100000)) {
      return false;
    }

    return true;
  }
}

/**
 * Quality score for extracted events
 */
export function calculateEventQuality(event: Event): number {
  let score = 0;

  // Has title (required)
  if (event.title) score += 20;

  // Has venue
  if (event.venue_name) score += 20;

  // Has date/time
  if (event.date_time) score += 20;

  // Has price
  if (event.price_from) score += 15;

  // Has category
  if (event.category_name) score += 15;

  // Has description
  if (event.description && event.description.length > 50) score += 10;

  return score;
}

/**
 * Filter events by quality
 */
export function filterEventsByQuality(
  events: Event[],
  minQuality = 50
): Event[] {
  return events.filter(event => calculateEventQuality(event) >= minQuality);
}