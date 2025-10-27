import crypto from 'crypto';
import { normalizeCategory } from '@concierge/database';
import { Event, InstagramPost } from './types';
import OpenAI from 'openai';
import { encoding_for_model, TiktokenModel } from 'tiktoken';

export interface AIProvider {
  extractEventInfo(post: InstagramPost): Promise<ExtractedEventAI | null>;
  extractEventsBatch?(posts: InstagramPost[]): Promise<ExtractedEventAI[]>;
}

export interface ExtractedEventAI {
  isEvent: boolean;
  confidence: number;
  title?: string;
  venue?: string;
  category?: string;
  description?: string;
  price?: number;
  // Dates in ISO 8601 format (UTC)
  date_time?: string;
  date_time_from?: string;
  date_time_to?: string;
  postIndex?: number; // Track which post this event came from (local to chunk)
  postId?: string; // Instagram post ID for Redis lookup
}

/**
 * Groq-based event extractor (fast and free)
 */
export class GroqExtractor implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractEventsBatch(
    posts: InstagramPost[]
  ): Promise<ExtractedEventAI[]> {
    const currentDate = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    const systemPrompt = `Extract FUTURE Ukrainian events from Instagram posts. Current date: ${currentDate} (${currentYear}).

KEY RULES:
1. ONE POST = MULTIPLE EVENTS possible
2. Extract ONLY FUTURE events (after ${currentDate})
3. Return JSON array maintaining post order

REQUIRED FIELDS:
- isEvent: boolean (true if future event with specific date)
- title: event/artist name
- venue: location name (check username, caption, location tag, @mentions)
- category: ONE of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап, Дитяче, Спорт, Екскурсія, Інше
- date_time: ISO 8601 UTC (e.g., "2025-12-10T17:00:00.000Z" for Dec 10, 19:00 Kyiv time)
- date_time_from/to: for date ranges (also set date_time to start)
- price: minimum ticket price (number)
- description: 2-5 sentences about performers, format, special features (remove emojis/hashtags)
- confidence: 0.0-1.0

DATE CONVERSION:
- Kyiv timezone: UTC+2 winter, UTC+3 summer
- "10 грудня 19:00" → "2025-12-10T17:00:00.000Z"
- If no year: use ${currentYear}
- If no time: use "00:00"

EXAMPLES:
✓ "Концерт 10 грудня" → extract if Dec 10 is in future
✗ "Концерт був вчора" → skip (no specific date)
✗ "Концерт 22 жовтня" → skip if Oct 22 already passed

Return format:
[
  {
    "index": 0,
    "events": [
      {
        "isEvent": true,
        "confidence": 0.9,
        "title": "Event Name",
        "venue": "Venue Name",
        "category": "Концерт",
        "date_time": "2025-12-10T17:00:00.000Z",
        "price": 500,
        "description": "Detailed 2-5 sentence description..."
      }
    ]
  },
  {"index": 1, "events": []}
]`;

    const postsData = posts.map((post, idx) => ({
      index: idx,
      id: post.id, // Instagram post ID (important for Redis lookup)
      shortCode: post.shortCode,
      username: post.ownerUsername,
      caption: post.caption || '', // Full caption without length limits
      location: post.locationName || 'Not specified',
      timestamp: post.timestamp,
    }));

    // Log full data being sent to AI for debugging
    console.log('\n📋 Full data being sent to AI:');
    postsData.forEach((data) => {
      console.log(`\n  [${data.index}] @${data.username}:`);
      console.log(`      Caption length: ${data.caption.length} chars`);
      console.log(`      Location: ${data.location}`);
      console.log(`      Full caption: "${data.caption}"`);
    });

    const userPrompt = `Analyze ${posts.length} posts. Extract ONLY FUTURE events (after ${currentDate}).

INPUT:
${JSON.stringify(postsData, null, 2)}

For each post: identify event title, venue (check username/caption/location), category, dates, price.
Write detailed 2-5 sentence descriptions.

Return JSON array (no markdown):
[{"index": 0, "events": [{isEvent: true, title: "...", venue: "...", category: "...", date_time: "...", price: 500, description: "...", confidence: 0.9}]}, ...]

CRITICAL:
- Skip past events (before ${currentDate})
- Convert Kyiv time to UTC in ISO 8601
- Detailed descriptions (not "Концерт X", but "Концерт X з... виконає... глядачів чекає...")
- No duplicates within same post`;

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            // Note: response_format may not be supported by all Groq models
            // Removed to ensure compatibility with more models
            // response_format: { type: 'json_object' },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Groq API error (${response.status}):`, errorText);
        return [];
      }

      const data = (await response.json()) as any;

      if (
        !data.choices ||
        !Array.isArray(data.choices) ||
        data.choices.length === 0
      ) {
        console.error('Unexpected Groq API response structure');
        return [];
      }

      const content = data.choices[0].message.content;

      // Log raw AI response
      console.log(`\n📥 Raw AI response (first 3000 chars):`);
      console.log(content.substring(0, 3000));
      if (content.length > 3000) {
        console.log(`... (${content.length - 3000} more chars)`);
      }

      // Extract JSON from response (handle markdown code blocks)
      let jsonText = content;

      // Remove markdown code blocks if present
      const codeBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      } else {
        // Try to find JSON array or object
        const jsonMatch = content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (jsonMatch) {
          jsonText = jsonMatch[1];
        }
      }

      const result = JSON.parse(jsonText);

      // Handle both array and object with "events" key
      const events = Array.isArray(result) ? result : result.events || [];

      console.log(`\n🔍 Raw AI response parsed: ${events.length} posts`);

      // Process each post's events
      const allResults: ExtractedEventAI[] = [];

      for (const postData of events) {
        const postIndex = postData.index ?? allResults.length;
        const postEvents = postData.events || [];

        console.log(`  [Post ${postIndex}]: ${postEvents.length} event(s) found`);

        if (postEvents.length === 0) {
          // No events in this post
          allResults.push({
            isEvent: false,
            confidence: 0,
            title: undefined,
            venue: undefined,
            category: undefined,
            description: undefined,
            price: undefined,
            date_time: undefined,
            date_time_from: undefined,
            date_time_to: undefined,
            postIndex: postIndex, // Add post index
            postId: posts[postIndex]?.id, // Add Instagram post ID for Redis lookup
          });
        } else {
          // Process each event from this post
          for (const event of postEvents) {
            const mapped: ExtractedEventAI = {
              isEvent: event.isEvent !== false,
              confidence: event.confidence || 0.7,
              title: event.title,
              venue: event.venue,
              category: event.category,
              description: event.description || undefined,
              price: typeof event.price === 'number' ? event.price : undefined,
              date_time: event.date_time || undefined,
              date_time_from: event.date_time_from || undefined,
              date_time_to: event.date_time_to || undefined,
              postIndex: postIndex, // Add post index to track source
              postId: posts[postIndex]?.id, // Add Instagram post ID for Redis lookup
            };

            // Log mapping for debugging
            if (mapped.isEvent) {
              console.log(`    Event: "${mapped.title}"`);
              console.log(`      venue: ${mapped.venue || 'NOT EXTRACTED'}`);
              console.log(`      category: ${mapped.category || 'NOT EXTRACTED'}`);
              console.log(`      date_time: ${mapped.date_time || 'NOT EXTRACTED'}`);
              console.log(`      from post index: ${postIndex}, postId: ${mapped.postId}`);
            }

            allResults.push(mapped);
          }
        }
      }

      return allResults;
    } catch (error) {
      console.error('Groq batch extraction failed:', error);

      // Debug: log the raw response if available
      if (error instanceof SyntaxError) {
        console.error('JSON Parse Error - this usually means the AI returned text instead of JSON');
        console.error('Check if response_format is supported by your Groq model');
      }

      return [];
    }
  }

  async extractEventInfo(
    post: InstagramPost
  ): Promise<ExtractedEventAI | null> {
    // Fallback to single extraction if needed
    const results = await this.extractEventsBatch([post]);
    return results[0] || null;
  }
}

/**
 * OpenAI GPT-based event extractor with official SDK and optimizations
 */
export class OpenAIExtractor implements AIProvider {
  private client: OpenAI;
  private model: string;
  private encoding: any; // tiktoken encoder

  // Token limits for GPT-4o mini (128k total context window)
  private readonly MAX_INPUT_TOKENS = 120000; // Leave 8k for output
  private readonly MAX_OUTPUT_TOKENS = 8000; // Conservative output reservation

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;

    // Initialize tiktoken for token counting
    try {
      // gpt-4o-mini uses same tokenizer as gpt-4o
      this.encoding = encoding_for_model('gpt-4o' as TiktokenModel);
    } catch (error) {
      console.warn('⚠️ Failed to load tiktoken, using estimates:', error);
      this.encoding = null;
    }
  }

  /**
   * Count tokens in a string using tiktoken
   */
  private countTokens(text: string): number {
    if (!this.encoding) {
      // Rough estimate: ~4 chars per token
      return Math.ceil(text.length / 4);
    }

    try {
      return this.encoding.encode(text).length;
    } catch (error) {
      console.warn('Token counting failed:', error);
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Build chunks based on actual token count
   */
  private buildOptimalChunks(posts: InstagramPost[]): InstagramPost[][] {
    const chunks: InstagramPost[][] = [];
    let currentChunk: InstagramPost[] = [];

    const currentDate = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Base system prompt tokens
    const systemPromptBase = `Extract FUTURE Ukrainian events from Instagram. Today: ${currentDate}...`; // truncated for counting
    const systemTokens = this.countTokens(systemPromptBase) + 500; // Add buffer for full prompt

    // Reserve tokens for output and safety margin
    const reservedTokens = this.MAX_OUTPUT_TOKENS + systemTokens + 2000; // 2000 safety buffer
    const maxInputTokens = this.MAX_INPUT_TOKENS - reservedTokens;

    console.log(`📊 Token budget: ${maxInputTokens} tokens available for posts (${this.MAX_INPUT_TOKENS} total - ${reservedTokens} reserved)`);

    let currentTokens = 0;

    for (const post of posts) {
      // Calculate tokens for this post
      const postData = {
        i: currentChunk.length,
        u: post.ownerUsername,
        c: post.caption?.substring(0, 1000) || '',
        l: post.locationName || '',
      };

      const postTokens = this.countTokens(JSON.stringify(postData));

      // Check if adding this post would exceed limit
      if (currentTokens + postTokens > maxInputTokens && currentChunk.length > 0) {
        // Save current chunk and start new one
        console.log(`📦 Chunk filled: ${currentChunk.length} posts, ~${currentTokens} tokens`);
        chunks.push([...currentChunk]);
        currentChunk = [post];
        currentTokens = postTokens;
      } else {
        // Add to current chunk
        currentChunk.push(post);
        currentTokens += postTokens;
      }
    }

    // Add remaining posts
    if (currentChunk.length > 0) {
      console.log(`📦 Final chunk: ${currentChunk.length} posts, ~${currentTokens} tokens`);
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Extract events from multiple posts using batch processing
   */
  async extractEventsBatch(
    posts: InstagramPost[]
  ): Promise<ExtractedEventAI[]> {
    if (!posts || posts.length === 0) return [];

    const currentDate = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Build optimal chunks based on actual token count
    const chunks = this.buildOptimalChunks(posts);
    console.log(`📊 Optimized into ${chunks.length} chunk(s) for GPT-4o mini`);

    // Process in chunks
    const allResults: ExtractedEventAI[] = [];
    let processedPosts = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = processedPosts;
      const chunkEnd = processedPosts + chunk.length;

      console.log(`\n🔄 Processing chunk ${i + 1}/${chunks.length} (posts ${chunkStart}-${chunkEnd - 1}, ${chunk.length} posts)`);

      try {
        const results = await this.processChunk(chunk, chunkStart, currentDate, currentYear);
        allResults.push(...results);
        processedPosts += chunk.length;

        // Rate limiting between chunks (only if multiple chunks)
        if (i < chunks.length - 1) {
          console.log('⏸️ Rate limit pause: 1 second...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ Chunk ${i + 1} failed:`, error);
        // Add empty results for failed chunk
        for (let j = 0; j < chunk.length; j++) {
          allResults.push({
            isEvent: false,
            confidence: 0,
            postIndex: chunkStart + j,
            postId: chunk[j]?.id,
          });
        }
        processedPosts += chunk.length;
      }
    }

    return allResults;
  }

  /**
   * Process a single chunk of posts
   */
  private async processChunk(
    posts: InstagramPost[],
    chunkOffset: number,
    currentDate: string,
    currentYear: number
  ): Promise<ExtractedEventAI[]> {
    // Strict prompt - extract only what's explicitly stated
    const systemPrompt = `Extract Ukrainian EVENT ANNOUNCEMENTS (афіші) from Instagram. Today: ${currentDate}

CRITICAL RULES:
1. ONLY АФІШІ (event announcements) - not reviews, not impressions
2. Extract ONLY what's EXPLICITLY stated in text
3. DON'T INVENT: if no price → null, no venue → null, no date → null
4. Analyze ALL posts, return results for each

WHAT IS AN EVENT (афіша):
✓ Event announcement with details: "Концерт 15 листопада", "Скоро тур", "Квитки у продажу"
✓ Promotional posts: dates, ticket info, venue info
✓ Can be with or without specific date ("Скоро концерт" = event if clearly future)

WHAT IS NOT AN EVENT (skip these):
✗ Past events: "Концерт був чудовий", "Дякую за вечір", "Як це було"
✗ Reviews/impressions: "відвідати концерт", "отримати задоволення", "я ваша прихильниця"
✗ Concert photos without future event info
✗ General recommendations without specific event details
✗ Hashtag-only posts without context

OUTPUT FORMAT (JSON object):
{"posts": [{"idx": 0, "evts": [{evt}, ...]}, {"idx": 1, "evts": []}, ...]}

EVENT FIELDS (evt) - ONLY if EXPLICITLY stated:
- e: true (is event)
- c: 0.0-1.0 (confidence: high if clear date, medium if vague "скоро")
- t: "title" (artist/event name from text)
- v: "venue" or null (ONLY if mentioned: location tag, @mention, or text)
- cat: Концерт|Театр|Виставка|Фестиваль|Вечірка|Стендап|Дитяче|Спорт|Екскурсія|Інше
- dt: ISO UTC or null (if date mentioned: convert Kyiv→UTC, if no date: null)
- dtf/dtt: date range (ISO UTC) or null
- p: price number or null (ONLY if stated: "500 грн", "від 300")
- d: 2-5 sentences factual description from text

DATE PARSING (if date mentioned):
- Kyiv UTC+2 winter, UTC+3 summer → UTC
- "10 грудня 19:00" → "2025-12-10T17:00:00Z"
- No year → ${currentYear}, no time → "00:00"
- Past date → skip (not event)
- No date ("скоро", "незабаром") → dt:null

EXAMPLES:
✓ "Концерт Скрипки 15 листопада, квитки 500 грн" → АФІША: all fields filled
✓ "Вистава 20.11 у Театрі Франка" → АФІША: v="Театр Франка", p=null, dt="2025-11-20T00:00:00Z"
✓ "Скоро концерт Monatik! Квитки у продажу" → АФІША: t="Monatik", dt=null
✗ "Концерт був чудовий!" → PAST EVENT (skip)
✗ "Як отримати задоволення? Відвідати концерт" → REVIEW/RECOMMENDATION (skip)
✗ "Я ваша прихильниця ❤️ #концерт" → IMPRESSION (skip)
✗ "#kyivconcert" (only hashtags) → NO CONTEXT (skip)`;

    // Prepare posts data (compact format with FULL captions)
    const postsData = posts.map((post, idx) => ({
      i: idx,
      u: post.ownerUsername,
      c: post.caption || '', // Full caption without truncation
      l: post.locationName || '',
    }));

    const userPrompt = `Analyze ${posts.length} posts. Extract ONLY АФІШІ (event announcements), skip reviews/impressions.

POSTS DATA:
${JSON.stringify(postsData)}

INSTRUCTIONS:
- Read each post carefully
- Identify if it's АФІША (event announcement with promotional intent)
- SKIP: reviews ("як це було"), impressions ("отримати задоволення"), past events, hashtag-only posts
- Extract ONLY information that's EXPLICITLY stated
- If date not mentioned → dt:null
- If price not mentioned → p:null
- If venue not mentioned → v:null
- If date exists: convert Kyiv time to UTC ISO format
- Write factual descriptions based on text

Return JSON: {"posts": [{"idx": 0, "evts": [{e:true, c:0.8, t:"...", v:null, cat:"...", dt:null, p:null, d:"..."}, ...]}, {"idx": 1, "evts": []}, ...]}`;

    // Count tokens before sending (for logging)
    const inputTokens = this.countTokens(systemPrompt + userPrompt);
    console.log(`📊 Input tokens: ~${inputTokens}`);

    // Note: Chunks are pre-optimized by buildOptimalChunks, so should never exceed limit
    if (inputTokens > this.MAX_INPUT_TOKENS) {
      console.error(`⚠️ Unexpected: chunk exceeded token limit (${inputTokens} tokens). This shouldn't happen!`);
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: Math.min(this.MAX_OUTPUT_TOKENS, 8000), // Ensure we don't request too many
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        console.error('No content in OpenAI response');
        return [];
      }

      // Log token usage
      console.log(`📊 Tokens used - Input: ${completion.usage?.prompt_tokens}, Output: ${completion.usage?.completion_tokens}, Total: ${completion.usage?.total_tokens}`);

      // Parse compact response
      const result = JSON.parse(content);
      const postsResults = Array.isArray(result) ? result : (result.posts || result.results || []);
      console.log(`✅ Received AI response with ${postsResults.length} post(s) analyzed`);

      const allResults: ExtractedEventAI[] = [];

      for (const postData of postsResults) {
        const postIndex = postData.idx ?? allResults.length;
        const actualIndex = chunkOffset + postIndex; // Adjust for chunk offset
        const events = postData.evts || [];

        if (events.length === 0) {
          // No events in this post
          allResults.push({
            isEvent: false,
            confidence: 0,
            postIndex: actualIndex,
            postId: posts[postIndex]?.id,
          });
        } else {
          // Process each event from this post
          for (const evt of events) {
            const mapped: ExtractedEventAI = {
              isEvent: evt.e === true,
              confidence: evt.c || 0.7,
              title: evt.t,
              venue: evt.v,
              category: evt.cat,
              description: evt.d,
              price: typeof evt.p === 'number' ? evt.p : undefined,
              date_time: evt.dt,
              date_time_from: evt.dtf,
              date_time_to: evt.dtt,
              postIndex: actualIndex,
              postId: posts[postIndex]?.id,
            };

            if (mapped.isEvent) {
              const venueInfo = mapped.venue ? `venue: ${mapped.venue}` : 'venue: NOT FOUND';
              const priceInfo = mapped.price !== undefined ? `price: ${mapped.price}` : 'price: NOT FOUND';
              console.log(`  ✅ Event: "${mapped.title}" from post ${actualIndex} (@${posts[postIndex]?.ownerUsername})`);
              console.log(`      ${venueInfo}, ${priceInfo}`);
            }

            allResults.push(mapped);
          }
        }
      }

      return allResults;
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        console.error(`OpenAI API Error: ${error.status} - ${error.message}`);

        // Handle rate limits
        if (error.status === 429) {
          console.log('⏳ Rate limited, waiting 60 seconds...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          // Retry once
          return this.processChunk(posts, chunkOffset, currentDate, currentYear);
        }
      }
      throw error;
    }
  }

  /**
   * Extract event from a single post (fallback)
   */
  async extractEventInfo(
    post: InstagramPost
  ): Promise<ExtractedEventAI | null> {
    // Use batch processing for single post
    const results = await this.extractEventsBatch([post]);
    return results[0] || null;
  }
}

/**
 * Claude AI-based event extractor
 */
export class ClaudeExtractor implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-3-haiku-20240307') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractEventInfo(
    post: InstagramPost
  ): Promise<ExtractedEventAI | null> {
    const currentDate = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    const prompt = `Extract FUTURE Ukrainian events from Instagram posts. Current date: ${currentDate} (${currentYear}).

KEY RULES:
1. Extract ONLY FUTURE events (after ${currentDate})
2. Return structured JSON data

REQUIRED FIELDS:
- isEvent: boolean (true if future event with specific date)
- title: event/artist name
- venue: location name (check username, caption, location tag, @mentions)
- category: ONE of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап, Дитяче, Спорт, Екскурсія, Інше
- date_time: ISO 8601 UTC (e.g., "2025-12-10T17:00:00.000Z" for Dec 10, 19:00 Kyiv time)
- date_time_from/to: for date ranges (also set date_time to start)
- price: minimum ticket price (number)
- description: 2-5 sentences about performers, format, special features (remove emojis/hashtags)
- confidence: 0.0-1.0

DATE CONVERSION:
- Kyiv timezone: UTC+2 winter, UTC+3 summer
- "10 грудня 19:00" → "2025-12-10T17:00:00.000Z"
- If no year: use ${currentYear}
- If no time: use "00:00"

EXAMPLES:
✓ "Концерт 10 грудня" → extract if Dec 10 is in future
✗ "Концерт був вчора" → skip (no specific date)
✗ "Концерт 22 жовтня" → skip if Oct 22 already passed

ANALYZE THIS POST:
Caption: ${post.caption || ''}
Location: ${post.locationName || 'Not specified'}

Identify venue (check username/caption/location), convert Kyiv time to UTC ISO 8601.
Write detailed 2-5 sentence descriptions.

Return ONLY valid JSON, no markdown or explanation:
{
  "isEvent": boolean,
  "confidence": 0.0-1.0,
  "title": "string or null",
  "venue": "string or null",
  "category": "string or null",
  "date_time": "ISO 8601 UTC or null",
  "date_time_from": "ISO 8601 UTC or null",
  "date_time_to": "ISO 8601 UTC or null",
  "price": number or null,
  "description": "string or null"
}

If not an event or past event, return {"isEvent": false}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Claude API error (${response.status}):`, errorText);
        return null;
      }

      const data = (await response.json()) as any;

      // Check if response has expected structure
      if (
        !data.content ||
        !Array.isArray(data.content) ||
        data.content.length === 0
      ) {
        console.error(
          'Unexpected Claude API response structure:',
          JSON.stringify(data, null, 2)
        );
        return null;
      }

      const content = data.content[0].text;

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('No JSON found in Claude response');
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);

      if (!result.isEvent) {
        return null;
      }

      return {
        isEvent: true,
        confidence: result.confidence || 0.8,
        title: result.title,
        venue: result.venue,
        category: result.category,
        description: result.description || undefined,
        price: typeof result.price === 'number' ? result.price : undefined,
        date_time: result.date_time,
        date_time_from: result.date_time_from,
        date_time_to: result.date_time_to,
      };
    } catch (error) {
      console.error('Claude extraction failed:', error);
      return null;
    }
  }
}

/**
 * Local LLM extractor (using Ollama)
 */
export class OllamaExtractor implements AIProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async extractEventInfo(
    post: InstagramPost
  ): Promise<ExtractedEventAI | null> {
    const currentDate = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    const prompt = `Extract FUTURE Ukrainian events from Instagram posts. Current date: ${currentDate} (${currentYear}).

KEY RULES:
1. Extract ONLY FUTURE events (after ${currentDate})
2. Return structured JSON data

REQUIRED FIELDS:
- isEvent: boolean (true if future event with specific date)
- title: event/artist name
- venue: location name (check username, caption, location tag, @mentions)
- category: ONE of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап, Дитяче, Спорт, Екскурсія, Інше
- date_time: ISO 8601 UTC (e.g., "2025-12-10T17:00:00.000Z" for Dec 10, 19:00 Kyiv time)
- date_time_from/to: for date ranges (also set date_time to start)
- price: minimum ticket price (number)
- description: 2-5 sentences about performers, format, special features (remove emojis/hashtags)
- confidence: 0.0-1.0

DATE CONVERSION:
- Kyiv timezone: UTC+2 winter, UTC+3 summer
- "10 грудня 19:00" → "2025-12-10T17:00:00.000Z"
- If no year: use ${currentYear}
- If no time: use "00:00"

EXAMPLES:
✓ "Концерт 10 грудня" → extract if Dec 10 is in future
✗ "Концерт був вчора" → skip (no specific date)
✗ "Концерт 22 жовтня" → skip if Oct 22 already passed

POST:
Caption: ${post.caption || ''}
Location: ${post.locationName || ''}

Identify venue (check username/caption/location), convert Kyiv time to UTC ISO 8601.
Write detailed 2-5 sentence descriptions.

Return JSON:
{
  "isEvent": boolean,
  "confidence": 0.0-1.0,
  "title": "string or null",
  "venue": "string or null",
  "category": "string or null",
  "date_time": "ISO 8601 UTC or null",
  "date_time_from": "ISO 8601 UTC or null",
  "date_time_to": "ISO 8601 UTC or null",
  "price": number or null,
  "description": "string or null"
}

If not an event or past event, return {"isEvent": false}`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ollama API error (${response.status}):`, errorText);
        return null;
      }

      const data = (await response.json()) as any;

      // Check if response has expected structure
      if (!data.response) {
        console.error(
          'Unexpected Ollama API response structure:',
          JSON.stringify(data, null, 2)
        );
        return null;
      }

      const result = JSON.parse(data.response);

      if (!result.isEvent) {
        return null;
      }

      return {
        isEvent: true,
        confidence: result.confidence || 0.7, // Lower confidence for local models
        title: result.title,
        venue: result.venue,
        category: result.category,
        description: result.description || undefined,
        price: typeof result.price === 'number' ? result.price : undefined,
        date_time: result.date_time,
        date_time_from: result.date_time_from,
        date_time_to: result.date_time_to,
      };
    } catch (error) {
      console.error('Ollama extraction failed:', error);
      return null;
    }
  }
}

/**
 * Convert AI-extracted data to Event format
 * AI does all the work - this function just maps fields
 */
export function aiEventToEvent(
  post: InstagramPost,
  aiData: ExtractedEventAI
): Event | null {
  if (!aiData.isEvent || !aiData.title) {
    return null;
  }

  // Generate deterministic ID based on EVENT characteristics (not Instagram post ID)
  // This ensures the same event from different Instagram posts gets the same ID
  const idComponents = [
    aiData.title.toLowerCase().trim(),
    aiData.date_time || '',
    aiData.venue?.toLowerCase().trim() || '',
  ];
  const idString = idComponents.join('|');
  const id = crypto.createHash('sha256').update(idString).digest('hex');

  console.log(`      🔑 Generated ID from: "${idString}" -> ${id.substring(0, 12)}...`);

  const event: Event = {
    id,
    title: aiData.title,
    description: aiData.description,
    category_name: normalizeCategory(aiData.category),
    venue_name: aiData.venue,
    category_id: null,
    venue_id: null,
    date_time: aiData.date_time,
    date_time_from: aiData.date_time_from,
    date_time_to: aiData.date_time_to,
    price_from: aiData.price,
    source_url: post.url,
  };

  // Log final event structure
  console.log(`      📦 Final event object:`);
  console.log(`          title: ${event.title}`);
  console.log(`          venue_name: ${event.venue_name || '❌ MISSING'}`);
  console.log(`          category_name: ${event.category_name || '❌ MISSING'}`);
  console.log(`          price_from: ${event.price_from || '❌ MISSING'}`);
  console.log(`          date_time: ${event.date_time || 'not set'}`);

  return event;
}

/**
 * Factory for creating AI extractors
 */
export function createAIExtractor(
  provider: string,
  apiKey?: string,
  model?: string
): AIProvider | null {
  switch (provider.toLowerCase()) {
    case 'groq':
      if (!apiKey) {
        console.error('Groq API key required');
        return null;
      }
      return new GroqExtractor(apiKey, model);

    case 'openai':
      if (!apiKey) {
        console.error('OpenAI API key required');
        return null;
      }
      return new OpenAIExtractor(apiKey, model);

    case 'claude':
    case 'anthropic':
      if (!apiKey) {
        console.error('Claude API key required');
        return null;
      }
      return new ClaudeExtractor(apiKey, model);

    case 'ollama':
    case 'local':
      return new OllamaExtractor('http://localhost:11434', model);

    default:
      console.error(`Unknown AI provider: ${provider}`);
      return null;
  }
}
