import crypto from 'crypto';
import { normalizeCategory } from '@concierge/database';
import { Event, InstagramPost } from './types';

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
 * OpenAI GPT-based event extractor
 */
export class OpenAIExtractor implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractEventInfo(
    post: InstagramPost
  ): Promise<ExtractedEventAI | null> {
    const systemPrompt = `You are an expert at extracting structured event data from Ukrainian Instagram posts for a PostgreSQL database.

DATABASE SCHEMA (events table):
- title: string (REQUIRED) - Event name or artist/performer name
- description: string (optional but IMPORTANT) - DETAILED event description (2-5 sentences minimum)
  Write a comprehensive description including: performers, special features, program details, target audience
  Example: "Концерт гурту Океан Ельзи з презентацією нової програми. Глядачів чекають улюблені хіти та прем'єри нових пісень. Спеціальні візуальні ефекти та світлове шоу створять неповторну атмосферу."
- category_name: string (optional) - MUST be one of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап
- venue_name: string (optional) - Venue name only (e.g., "Atlas", not "Atlas, вул. Січових Стрільців")
- date: string (optional) - Ukrainian format (DD month YYYY or DD.MM.YYYY)
- time: string (optional) - 24-hour format (HH:MM)
- price: number (optional) - Minimum price in UAH (numeric only)

TASK: Determine if this is an UPCOMING event announcement and extract structured data for database storage.

IMPORTANT: If the same event is mentioned multiple times in the caption, extract it only once.

Return JSON only, no explanation.`;

    const userPrompt = `Extract structured event data from this Instagram post:

Caption: ${post.caption || ''}
Location: ${post.locationName || 'Not specified'}
Posted: ${post.timestamp || 'Unknown'}

Return JSON:
{
  "isEvent": boolean,
  "confidence": number (0-1),
  "title": "string or null",
  "description": "string or null",
  "venue": "string or null",
  "date": "DD month YYYY or DD.MM.YYYY or null",
  "time": "HH:MM or null",
  "price": number or null,
  "category": "Концерт/Театр/Виставка/Фестиваль/Вечірка/Стендап or null"
}

If not an event, return {"isEvent": false}`;

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
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
            response_format: { type: 'json_object' },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenAI API error (${response.status}):`, errorText);
        return null;
      }

      const data = (await response.json()) as any;

      // Check if response has expected structure
      if (
        !data.choices ||
        !Array.isArray(data.choices) ||
        data.choices.length === 0
      ) {
        console.error(
          'Unexpected OpenAI API response structure:',
          JSON.stringify(data, null, 2)
        );
        return null;
      }

      const result = JSON.parse(data.choices[0].message.content);

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
        price: typeof result.price === 'number' ? result.price : (result.price ? parseFloat(result.price) : undefined),
        date_time: result.date_time,
        date_time_from: result.date_time_from,
        date_time_to: result.date_time_to,
      };
    } catch (error) {
      console.error('OpenAI extraction failed:', error);
      return null;
    }
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
    const prompt = `You are extracting structured event data from Ukrainian Instagram posts for a PostgreSQL database.

DATABASE SCHEMA (events table):
- title: string (REQUIRED) - Event name or artist/performer name
- description: string (IMPORTANT) - DETAILED event description (2-5 sentences)
  Include: who performs, event format, special features, what to expect, target audience
  Make it informative and engaging for potential visitors
- category_name: string - ONE of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап
- venue_name: string - Venue name only (e.g., "Atlas", not full address)
- date: string - Ukrainian format (DD month YYYY or DD.MM.YYYY)
- time: string - 24-hour format (HH:MM)
- price: number - Minimum price in UAH (numeric only)

ANALYZE THIS POST:
Caption: ${post.caption || ''}
Location: ${post.locationName || 'Not specified'}

TASK: Determine if this is an UPCOMING event announcement and extract structured data.

IMPORTANT: If the same event is mentioned multiple times in the caption, extract it only once.

Return ONLY valid JSON, no markdown or explanation:
{
  "isEvent": boolean,
  "confidence": number (0-1),
  "title": "string or null",
  "description": "string or null",
  "venue": "string or null",
  "date": "string or null",
  "time": "string or null",
  "price": number or null,
  "category": "string or null"
}`;

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
    const prompt = `Extract structured event data for PostgreSQL database from this Ukrainian Instagram post.

DATABASE SCHEMA:
- title (REQUIRED): Event/artist name
- description (IMPORTANT): Detailed description (2-5 sentences about performers, format, features)
- category: ONE of: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап
- venue: Venue name only
- date: DD month YYYY or DD.MM.YYYY
- time: HH:MM (24-hour)
- price: number (UAH)

POST:
Caption: ${post.caption || ''}
Location: ${post.locationName || ''}

IMPORTANT: If the same event is mentioned multiple times, extract it only once.

Return JSON:
{
  "isEvent": boolean,
  "confidence": 0-1,
  "title": "string or null",
  "description": "string or null",
  "venue": "string or null",
  "date": "string or null",
  "time": "string or null",
  "price": number or null,
  "category": "string or null"
}

If not an event, return {"isEvent": false}`;

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
