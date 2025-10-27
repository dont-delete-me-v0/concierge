/**
 * DEPRECATED: This regex-based extractor is not used in the current implementation.
 * The application uses pure AI extraction as requested by the user.
 * Keeping this file for reference only.
 *
 * User requirement: "гибрид тогда не нужен, пусть тогда всё делает AI а код только получает и отправляет данные"
 * (Translation: "hybrid is not needed then, let AI do everything and the code just receives and sends data")
 */

import { InstagramPost, ExtractedEventInfo, Event } from './types';
import { parseDateTimeUaToUtcIso, parseDateRangeUaToUtcIso } from './dateUtils';
import crypto from 'crypto';

/**
 * Extract event information from Instagram post caption and metadata
 * @deprecated Use AI extraction instead (see aiExtractor.ts)
 */
export function extractEventInfo(post: InstagramPost): ExtractedEventInfo | null {
  if (!post.caption) return null;

  const caption = post.caption;
  const info: ExtractedEventInfo = {};

  // Extract title - look for event name patterns
  // Pattern: "Artist/Band name" followed by concert/show indicators
  const titlePatterns = [
    /([А-Яа-яA-Za-z0-9\s&,.-]+)(?:\s+з\s+концертом|\s+concert|\s+виступ|\s+шоу)/i,
    /концерт\s+([А-Яа-яA-Za-z0-9\s&,.-]+)/i,
    /вистава\s+«([^»]+)»/i,
    /«([^»]+)»/i, // Anything in quotes
    /КОНЦЕРТ:\s*([^\n]+)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = caption.match(pattern);
    if (match) {
      info.title = match[1].trim();
      break;
    }
  }

  // Extract venue - look for location patterns
  const venuePatterns = [
    /(?:в|у|@)\s*([А-Яа-яA-Za-z0-9\s]+)(?:,\s*Київ|,\s*Kyiv)/i,
    /(?:venue|місце|локація|де):\s*([^\n,]+)/i,
    /Origin\s*Stage/i,
    /МЦКМ/i,
    /Caribbean\s*Club/i,
    /Atlas/i,
    /Stereo\s*Plaza/i,
  ];

  for (const pattern of venuePatterns) {
    const match = caption.match(pattern);
    if (match) {
      info.venue = typeof match === 'string' ? match : match[1]?.trim() || match[0];
      break;
    }
  }

  // Use Instagram location if available
  if (!info.venue && post.locationName) {
    info.venue = post.locationName;
  }

  // Extract date and time
  const datePatterns = [
    /(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+(\d{4}))?(?:,?\s*(\d{1,2}):(\d{2}))?/i,
    /(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/,
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
  ];

  for (const pattern of datePatterns) {
    const match = caption.match(pattern);
    if (match) {
      info.date = match[0];
      break;
    }
  }

  // Extract time if not included in date
  if (!info.date || !info.date.includes(':')) {
    const timeMatch = caption.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      info.time = timeMatch[0];
    }
  }

  // Extract price
  const pricePatterns = [
    /(\d+)\s*(?:грн|₴|UAH)/i,
    /(?:вартість|ціна|квитки):\s*(\d+)/i,
    /(?:від|from)\s*(\d+)\s*(?:грн|₴|UAH)/i,
  ];

  for (const pattern of pricePatterns) {
    const match = caption.match(pattern);
    if (match) {
      info.price = match[1];
      break;
    }
  }

  // Extract category based on keywords
  const categories: Record<string, string[]> = {
    'Концерт': ['концерт', 'concert', 'виступ', 'live', 'акустичний'],
    'Театр': ['вистава', 'театр', 'спектакль', 'п\'єса'],
    'Виставка': ['виставка', 'експозиція', 'галерея'],
    'Фестиваль': ['фестиваль', 'festival', 'fest'],
    'Вечірка': ['вечірка', 'party', 'dj', 'діджей'],
    'Стендап': ['стендап', 'stand-up', 'standup', 'comedy'],
  };

  const lowerCaption = caption.toLowerCase();
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerCaption.includes(keyword))) {
      info.category = category;
      break;
    }
  }

  // Use full caption as description
  info.description = caption; // Full description without length limits

  return Object.keys(info).length > 0 ? info : null;
}

/**
 * Convert Instagram post to Event format for RabbitMQ
 */
export function instagramPostToEvent(post: InstagramPost): Event | null {
  const eventInfo = extractEventInfo(post);
  if (!eventInfo || !eventInfo.title) return null;

  // Generate deterministic ID from Instagram post ID and title
  const idString = `${post.id}-${eventInfo.title}`;
  const id = crypto.createHash('sha256').update(idString).digest('hex');

  // Parse date and time
  let dateTime: string | undefined;
  let dateTimeFrom: string | undefined;
  let dateTimeTo: string | undefined;

  if (eventInfo.date) {
    const range = parseDateRangeUaToUtcIso(eventInfo.date);
    if (range.from || range.to) {
      dateTimeFrom = range.from;
      dateTimeTo = range.to;
      dateTime = range.from; // Use start date as primary date
    } else {
      const fullDateTime = eventInfo.time
        ? `${eventInfo.date} ${eventInfo.time}`
        : eventInfo.date;
      dateTime = parseDateTimeUaToUtcIso(fullDateTime);
    }
  }

  // Parse price
  const priceFrom = eventInfo.price ? parseFloat(eventInfo.price) : undefined;

  return {
    id,
    title: eventInfo.title,
    description: eventInfo.description,
    category_name: eventInfo.category,
    venue_name: eventInfo.venue,
    category_id: null,
    venue_id: null,
    date_time: dateTime,
    date_time_from: dateTimeFrom,
    date_time_to: dateTimeTo,
    price_from: priceFrom,
    source_url: post.url,
  };
}

/**
 * Process multiple Instagram posts and extract events
 */
export function extractEventsFromPosts(posts: InstagramPost[]): Event[] {
  const events: Event[] = [];

  for (const post of posts) {
    // Process main post
    const event = instagramPostToEvent(post);
    if (event) {
      events.push(event);
    }

    // Process child posts (carousel items)
    if (post.childPosts && post.childPosts.length > 0) {
      for (const childPost of post.childPosts) {
        // Child posts may not have separate captions, use parent caption
        if (!childPost.caption) {
          childPost.caption = post.caption;
        }
        const childEvent = instagramPostToEvent(childPost);
        if (childEvent && childEvent.id !== event?.id) {
          events.push(childEvent);
        }
      }
    }
  }

  // Remove duplicates by ID
  const uniqueEvents = new Map<string, Event>();
  for (const event of events) {
    uniqueEvents.set(event.id, event);
  }

  return Array.from(uniqueEvents.values());
}