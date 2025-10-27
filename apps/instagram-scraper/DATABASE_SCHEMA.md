# Database Schema for Event Extraction

This document describes the database schema that AI uses to extract and structure event data from Instagram posts.

## Event Model

The `events` table in PostgreSQL has the following structure:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ Yes | SHA256 hash (auto-generated from post ID + title) |
| `title` | string | ✅ Yes | Event name or artist/performer name |
| `description` | string | ❌ No | Full event description (clean text) |
| `category_name` | string | ❌ No | Event category (see below) |
| `venue_name` | string | ❌ No | Venue/location name |
| `category_id` | number | ❌ No | Category ID (auto-resolved by API from category_name) |
| `venue_id` | number | ❌ No | Venue ID (auto-resolved by API from venue_name) |
| `date_time` | DateTime | ❌ No | Main event date/time (UTC ISO format) |
| `date_time_from` | DateTime | ❌ No | Start of date range (for multi-day events) |
| `date_time_to` | DateTime | ❌ No | End of date range (for multi-day events) |
| `price_from` | Decimal | ❌ No | Minimum/starting price in UAH |
| `source_url` | string | ✅ Yes | Instagram post URL (auto-generated) |

## Event Categories

AI must classify events into **exactly ONE** of these 6 categories:

| Category | Ukrainian | Description | Examples |
|----------|-----------|-------------|----------|
| Concert | **Концерт** | Music concerts, live performances | MONATIK, Onuka, Джамала |
| Theater | **Театр** | Theater plays, performances | Лускунчик, Гамлет, Вистава |
| Exhibition | **Виставка** | Art exhibitions, gallery shows | Виставка сучасного мистецтва |
| Festival | **Фестиваль** | Festivals, multi-day events | Atlas Weekend, Файне Місто |
| Party | **Вечірка** | Club parties, DJ sets, nightlife | Techno night, DJ set |
| Stand-up | **Стендап** | Stand-up comedy shows | Stand-up вечір, Комік шоу |

## Venue Model

Venues are stored separately and linked to events:

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Auto-generated |
| `name` | string | Venue name (e.g., "Atlas", "Палац Україна") |
| `address` | string | Full address |
| `lat` | float | Latitude |
| `lng` | float | Longitude |
| `phone` | string | Contact phone |
| `website` | string | Website URL |

**Important:** AI should extract **venue name only**, not the full address. The API will perform fuzzy matching to find existing venues or create new ones.

Example:
- ✅ Good: "Atlas", "Origin Stage", "Палац Спорту"
- ❌ Bad: "Atlas, вул. Січових Стрільців 37", "Origin Stage (Podil)"

## Category Model

Categories are predefined and hierarchical:

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Auto-generated |
| `name` | string | Category name (Ukrainian) |
| `icon` | string | Icon/emoji |
| `parentId` | number | Parent category ID (for subcategories) |

## AI Extraction Guidelines

### 1. Title Extraction
**Requirement:** Must extract the main event name or artist/performer name.

Good examples:
- "MONATIK з програмою 'HUMAN'"
- "Лускунчик. Балет"
- "Техно вечірка в Atlas"
- "Stand-up від Влада Ямми"

Bad examples:
- "Супер концерт!" (too generic)
- "Не пропустіть!" (not descriptive)
- Just hashtags or emojis

### 2. Description Extraction
**Requirement:** Clean, informative text without emojis, hashtags, and promotional fluff.

Good examples:
- "Виступ відомого українського артиста MONATIK з концертною програмою HUMAN. Незабутня атмосфера та хіти які ви любите."
- "Класичний балет Лускунчик у виконанні Національної опери України. Вистава для всієї родини."

Bad examples:
- "🔥🔥🔥 MONATIK 🔥🔥🔥 #concert #kyiv #music" (emojis and hashtags)
- "ЗВ'ЯЗАТИСЯ ЗА НОМЕРОМ..." (contact info, not description)

### 3. Venue Name Extraction
**Requirement:** Extract venue name ONLY, without address details.

Good examples:
- "Atlas"
- "Origin Stage"
- "Палац Спорту"
- "Caribbean Club"

Bad examples:
- "Atlas, вул. Січових Стрільців 37, Київ"
- "Origin Stage (Podil)"
- "Палац Спорту, м. Київ"

### 4. Date/Time Extraction
**Requirement:** Keep in Ukrainian format for parsing. Use 24-hour time format.

Date formats:
- "15 грудня 2025"
- "15.12.2025"
- "15 грудня"

Time format:
- "19:00" ✅
- "7:00 PM" ❌

### 5. Price Extraction
**Requirement:** Extract minimum/starting price as a number only.

Good examples:
- 500
- 1200
- 0 (for free events)

Bad examples:
- "від 500 грн"
- "500-1000"
- "500₴"

### 6. Category Classification
**Requirement:** Choose exactly ONE category from the 6 available.

Guidelines:
- Music concerts → **Концерт**
- Theater/ballet/opera → **Театр**
- Art/photo exhibitions → **Виставка**
- Multi-day events → **Фестиваль**
- Club parties/DJ sets → **Вечірка**
- Comedy shows → **Стендап**

### 7. Confidence Scoring
Rate extraction confidence from 0.0 to 1.0:

- **0.9-1.0:** All key fields present (title, venue, date, time, price)
- **0.7-0.9:** Most fields present, clear event announcement
- **0.5-0.7:** Some fields missing, but definitely an event
- **0.3-0.5:** Unclear if event, missing critical info
- **0.0-0.3:** Not an event or very unclear

## Data Flow

1. **Instagram Post** → AI extracts structured data
2. **AI Output** → Validated and converted to Event format
3. **Event** → Published to RabbitMQ queue
4. **API Consumer** → Reads from queue
5. **Fuzzy Matching** → API finds/creates Categories and Venues
6. **Database** → Event stored with linked category_id and venue_id

## Example: Complete Extraction

**Instagram Post Caption:**
```
🎵 MONATIK з програмою 'HUMAN'

📅 15 грудня 2025, неділя
⏰ Початок о 19:00
📍 Палац Спорту, Київ

Квитки: від 800 грн
Передпродаж на concert.ua

Не пропустіть унікальний виступ однієї з найяскравіших зірок України!
🎤✨

#monatik #концерт #київ #human #concert
```

**AI Output:**
```json
{
  "isEvent": true,
  "confidence": 0.95,
  "title": "MONATIK з програмою 'HUMAN'",
  "description": "Виступ відомої української зірки MONATIK з концертною програмою HUMAN у Палаці Спорту.",
  "venue": "Палац Спорту",
  "date": "15 грудня 2025",
  "time": "19:00",
  "price": 800,
  "category": "Концерт"
}
```

**Final Event in Database:**
```json
{
  "id": "a7f3c8d9e1b2...",
  "title": "MONATIK з програмою 'HUMAN'",
  "description": "Виступ відомої української зірки MONATIK з концертною програмою HUMAN у Палаці Спорту.",
  "category_id": 1,
  "category_name": "Концерт",
  "venue_id": 5,
  "venue_name": "Палац Спорту",
  "date_time": "2025-12-15T17:00:00.000Z",
  "date_time_from": null,
  "date_time_to": null,
  "price_from": 800,
  "source_url": "https://www.instagram.com/p/..."
}
```

## Common Pitfalls to Avoid

### ❌ Don't:
- Include emojis in title/description
- Include hashtags in description
- Add address details to venue name
- Use 12-hour time format (AM/PM)
- Include currency symbols in price
- Mix multiple categories
- Extract past events or event reviews
- Include promotional text in description

### ✅ Do:
- Extract clean, structured data
- Focus on factual information
- Use Ukrainian category names
- Keep venue names simple
- Use 24-hour time format
- Extract numeric prices only
- Choose the most specific category
- Only extract UPCOMING events
- Write clear, informative descriptions
