# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Concierge is an events management system that scrapes Ukrainian event websites and Instagram posts, stores event data in PostgreSQL, and provides access via a Telegram bot and REST API. The system consists of four main applications running in Docker containers with shared infrastructure (PostgreSQL, Redis, RabbitMQ):
- **Web crawler** for traditional website scraping (Playwright-based)
- **Instagram scraper** for social media event discovery (AI-powered extraction)
- **REST API** for event management and search
- **Telegram bot** for user interaction

## Architecture

### Monorepo Structure
- **apps/api** - NestJS REST API for event management (port 3000)
- **apps/bot** - NestJS Telegram bot with Telegraf (port 3001)
- **apps/web-crawler** - Node.js web scraper with Playwright (runs on schedule)
- **apps/instagram-scraper** - Instagram event scraper using Apify + AI extraction (runs on schedule)
- **packages/database** - Prisma schema, migrations, backups, and PrismaService
- **packages/eslint-config** - Shared ESLint configuration
- **packages/prettier-config** - Shared Prettier configuration

### Message Flow Architecture

1. **Web Crawler → RabbitMQ**: Crawler scrapes event websites and publishes event data to RabbitMQ queue
2. **Instagram Scraper → RabbitMQ**: Scrapes Instagram posts, extracts events via AI, publishes to same RabbitMQ queue
3. **RabbitMQ → API Consumer**: API service consumes messages in batches and writes to PostgreSQL
4. **API → Database**: All event data stored in PostgreSQL with categories, venues, and user preferences
5. **Bot → API**: Telegram bot queries API for event search and retrieval
6. **Bot → Redis**: Bot uses Redis for session management (user search state, pagination)
7. **Bot → Database**: Direct database access for user management and favorites

### Data Flow

```
Crawler (Playwright)
  → Scrapes events with incremental deduplication (Redis)
  → Publishes to RabbitMQ with batching
Instagram Scraper (Apify + AI)
  → Fetches Instagram posts via Apify
  → Extracts event data using AI (Claude/GPT/Gemini)
  → Publishes to RabbitMQ (same queue)
API Consumer
  → Consumes RabbitMQ in batches (100 events)
  → Resolves categories/venues
  → Bulk upserts to PostgreSQL
Bot
  → Reads events via API HTTP calls
  → Manages user data via direct PostgreSQL queries
  → Stores session state in Redis
```

## Development Commands

### Package Manager
Uses **npm workspaces**. Always specify workspace when running app-specific commands:
```bash
npm install  # Root: installs all dependencies
npm run dev --workspace=apps/bot
npm run build --workspace=apps/api
npm run start:dev --workspace=apps/web-crawler
```

### Development Workflow

**RECOMMENDED: Local development (apps run locally, infrastructure in Docker):**
```bash
# 1. Start infrastructure only (DB, Redis, RabbitMQ, PgAdmin)
make dev-infra

# 2. In separate terminals, run apps locally:
make dev-api            # Run API in dev mode (localhost:3000)
make dev-bot            # Run bot in dev mode (localhost:3001)
make dev-crawler        # Run crawler in dev mode
make dev-instagram      # Run Instagram scraper in dev mode

# 3. Stop infrastructure when done
make dev-infra-down
```

**Advantages of local dev:**
- ✅ Instant hot-reload without Docker volume issues
- ✅ Easy debugging with breakpoints
- ✅ Direct logs in terminal
- ✅ No network issues (localhost only)
- ✅ Fast restarts

**Docker development (all services in Docker with hot-reload) - NOT RECOMMENDED for dev:**
```bash
make docker-dev-build   # Build all Docker dev images
make docker-dev-up      # Start all services in dev mode
make docker-dev-down    # Stop all dev services
make docker-dev-restart # Restart all dev services
make docker-dev-logs    # View all dev logs
```
*Note: This mode has issues with hot-reload, networking, and is slower. Use local dev instead.*

**Production (all services in Docker):**
```bash
make docker-build       # Build all Docker images
make docker-up          # Start all services (crawlers start automatically)
make docker-down        # Stop all services
make docker-logs        # View logs
make docker-restart     # Restart services
make docker-ps          # Show container status
```
*Note: Web crawler and Instagram scraper schedulers start automatically in production and run on configured schedules.*

### Linting & Formatting
```bash
npm run lint            # Lint web-crawler only (root script)
npm run format          # Format all files
npm run format:check    # Check formatting
```

### Building
```bash
npm run build           # Build web-crawler and bot (root script)
npm run build --workspace=apps/api    # Build API only
npm run build --workspace=apps/bot    # Build bot only
npm run build --workspace=apps/web-crawler    # Build crawler only
```

### Testing
```bash
# Currently no tests configured in root
npm run test --workspace=apps/api          # Run API tests with Jest
npm run test:watch --workspace=apps/api    # Watch mode for API tests
npm run test:cov --workspace=apps/api      # API tests with coverage
npm run test --workspace=apps/bot          # Run bot tests with Jest
npm run test --workspace=apps/web-crawler  # Run crawler tests (not implemented)
```

### Database Backups
```bash
make backup             # Create backup via Docker
make backup-manual      # Create manual backup
make list-backups       # List all backups
make restore FILE=path  # Restore from backup
```

### Web Crawler
```bash
make crawler-logs       # View crawler logs
make crawler-health     # Check crawler health

# Run crawler manually (from root or apps/web-crawler/)
npm run dev --workspace=apps/web-crawler config.json                           # Single config
npm run dev --workspace=apps/web-crawler crawl-configs/concert.ua/kyiv         # Directory of configs

# Run scheduler
npm run scheduler --workspace=apps/web-crawler      # Run in dev mode
npm run scheduler:start --workspace=apps/web-crawler  # Run built version
```

### Bot Commands
```bash
# Daily digest (manual trigger)
npm run digest:dev --workspace=apps/bot    # Run daily digest in dev mode
npm run digest --workspace=apps/bot        # Run built digest
```

### Instagram Scraper
```bash
# Run scraper manually (from root or apps/instagram-scraper/)
npm run dev --workspace=apps/instagram-scraper       # Single run with AI extraction
npm run scheduler --workspace=apps/instagram-scraper # Run scheduler in dev mode
npm run scheduler:start --workspace=apps/instagram-scraper # Run built scheduler

# Production/Docker commands
make instagram-logs       # View Instagram scraper logs
make instagram-run        # Run scraper once (local)
make instagram-scheduler  # Start scheduler (local)
make instagram-build      # Build Instagram scraper
```

## Key Technical Details

### Web Crawler (apps/web-crawler)

**Configuration-driven scraper** using Playwright + stealth mode:
- **Config location**: `apps/web-crawler/crawl-configs/` (JSON files)
- **Main entry**: `src/index.ts` - reads config, orchestrates scraping, publishes to RabbitMQ
- **Scraper engine**: `src/scraper.ts` - Playwright-based with proxy rotation and user-agent management
- **Scheduler**: `src/scheduler.ts` - runs crawler on cron schedule (default: every 3 hours)
  - **Production deployment**: Scheduler starts automatically in Docker container via `CMD ["node", "dist/scheduler.js"]`
  - Runs immediately on container start, then on schedule (configured via `CRAWLER_SCHEDULE` env var)
  - Automatically discovers and runs all configs in `crawl-configs/` directory
- **Incremental crawling**: `src/incremental.ts` + `src/redisState.ts`
  - Uses Redis Set to store SHA256 hashes of uniqueKey fields
  - Falls back to JSON file storage for local development
  - Optional change tracking: stores field-level diffs and timestamps
  - Optional updateExisting: re-publishes events if description/venue changes
  - State structure: `{lastUpdate, totalItems, hashes: string[], items?: {[hash]: row & changes[]}}`
- **Proxy management**: `src/proxyManager.ts`
  - Loads from file in format: `ip:port:user:pass`
  - Rotation strategies: round-robin or random
  - Failure tracking: marks proxy failed after 3 attempts, resets if all fail
  - Playwright requires auth credentials separate from URL (username/password in launchOptions)
- **RabbitMQ publisher**: `src/rabbitmq.ts`
  - Batched publishing: configurable batch size (PUBLISHER_BATCH_SIZE) + time-based flush (PUBLISHER_BATCH_INTERVAL_MS)
  - Confirm channel mode: waits for broker acknowledgments
  - Backpressure handling: waits for drain events when queue full
  - Auto-reconnect with exponential delay on failures
  - Message format: `{id: SHA256_hash, title, category_name, venue_name, date_time, date_time_from, date_time_to, price_from, source_url, image_url}`
- **Date parsing**: `src/dateUtils.ts`
  - Parses Ukrainian date formats using Luxon: "dd місяця yyyy, dow HH:MM"
  - Handles date ranges: "dd.mm - dd.mm" → dateTimeFrom/dateTimeTo
  - Converts Europe/Kyiv timezone → UTC ISO strings
  - Smart fallbacks for missing year/time components
- **Price parsing**: `src/priceUtils.ts` - extracts numeric prices from text
- **Data extraction**: `src/extractor.ts` - applies selectors and transforms to extract data
- **Pagination**: `src/pagination.ts`
  - Three modes: infinite-scroll (smooth with random behavior), load-more (button clicks), next-button (URL-based)
  - Anti-bot measures: random scroll delays (±30%), mouse movements, pauses
  - Configurable max pages (unlimited by default)
- **Detail page enrichment**: Concurrent worker pool (configurable 1-8 workers)
  - Link-based: opens detail URLs in new tabs
  - Click-based: simulates clicks to open detail panels
  - **Image extraction**: Can extract event images via `image_url` selector in detail page config
    - Supports multiple image selectors with fallbacks
    - Extracts `src` attribute from `<img>` tags
    - Images stored in Event.imageUrl field

**Config structure**:
- `url` - Page to scrape
- `waitFor` - Selector to wait for before scraping
- `selectors` - Array of {name, selector, type, multiple, transform}
- `pagination` - Type: "infinite-scroll" | "load-more" | "next-button", maxPages, scrollDelay
- `details` - Optional: {clickSelector OR link field, selectors, maxConcurrency: 1-8}
- `incremental` - {enabled, uniqueKey: string[], trackChanges, updateExisting}
- `proxyFile`, `proxyRotation`, `userAgents`, `userAgentRotation`
- `retries` - Number of retry attempts on failure

### API (apps/api)

**NestJS application** (port 3000):
- **Main**: `src/main.ts` - bootstraps NestJS app on port 3000
- **App Module**: `src/app.module.ts` - root module configuration, includes PrismaService
- **Prisma Service**: Uses `@concierge/database` package for database operations
- **RabbitMQ Consumer**: `src/rabbitmq.consumer.ts`
  - **Buffered consumption pattern**:
    - Prefetch: RABBITMQ_PREFETCH (default: 100 messages)
    - Batch size: CONSUMER_BATCH_SIZE (default: 100 events)
    - Flush interval: CONSUMER_FLUSH_MS (default: 200ms)
    - Overflow protection: forces flush if buffer exceeds 3x batch size
  - **Processing pipeline**:
    1. Receives messages in buffer
    2. Deduplicates by ID within batch
    3. **Fuzzy venue/category resolution**: Uses custom SQL with Cyrillic-Latin transliteration
       - Pattern: `LOWER(translate(regexp_replace(...)))`
       - Normalizes: removes spaces, punctuation, diacritics
       - Transliterates: АВЕ → ABE (Cyrillic to Latin mapping)
       - Case-insensitive matching, orders by name length (prefers shorter names)
    4. Creates new venues/categories if no fuzzy match found
    5. Bulk upserts events to PostgreSQL (transactional)
    6. ACK/NACK RabbitMQ messages
  - **Metrics**: Tracks total events processed, batches, errors, throughput rate
  - **Error handling**: Sends Telegram notifications on failures
- **Events Service**: `src/events.service.ts`
  - CRUD operations: `upsertEvent()`, `upsertMany()`, `findAll()`, `findOne()`, `remove()`
  - Venue/category management: `upsertVenue()`, `upsertCategory()`, `findVenueIdByFuzzy()`
  - **Advanced search** (`searchPaginated`):
    - Full-text: title/description case-insensitive
    - Category filtering: by IDs (OR logic)
    - Venue fuzzy matching: same normalization as consumer
    - Date range: supports ISO dates with/without time
    - Price range: Decimal comparison
    - Pagination: limit (max 50) + offset
    - Complex WHERE: combines OR for text/date, AND for combined filters
  - **Deterministic ID generation**:
    - Events: SHA256 hash from crawler (idempotent)
    - Venues: hash of `name+address`
    - Categories: hash of `name+parentId`
- **Events Controller**: `src/events.controller.ts`
  - `GET /events` - All events ordered by dateTime
  - `GET /events/search` - Full search with filters (text, category, venue, date, price)
  - `GET /events/:id` - Single event by ID
  - `DELETE /events/:id` - Remove event
- **Telegram Service**: `src/telegram.service.ts` - sends notifications to Telegram (tracker bot)
- **Telegram Controller**: `src/telegram.controller.ts` - Telegram webhook endpoint

**Key environment variables**:
- `DATABASE_URL` - PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/db)
- `RABBITMQ_URL`, `RABBITMQ_QUEUE`, `RABBITMQ_PREFETCH`
- `CONSUMER_BATCH_SIZE`, `CONSUMER_FLUSH_MS`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (legacy, kept for compatibility)
- `TELEGRAM_TRACKER_TOKEN`, `TELEGRAM_CHAT_ID` (for crawler status notifications)

### Bot (apps/bot)

**NestJS + Telegraf bot** (port 3001):
- **Main**: `src/main.ts` - bootstraps NestJS app on port 3001
- **Bot Module**: `src/bot.module.ts` - Telegraf configuration with Redis session store, includes PrismaService
- **Bot Update**: `src/bot.update.ts` - handles all Telegram interactions
  - **Commands**: `/start` - auto-registers user, shows main menu
  - **Search modes**: by name (text), venue (fuzzy), category (multi-select checkboxes), date (presets: today/tomorrow/7days + manual), price (range)
  - **Lazy loading pattern**:
    - Full pagination on first search: loads all results in chunks of 50
    - Caches in session: `searchParams` for reload without re-fetch
    - Search token: prevents callback collision when multiple searches active
  - **Navigation**: card view (single event with next/prev), list view (compact with inline nav)
  - **Favorites**: add/remove to saved events
- **Keyboards**: `src/keyboards.ts`
  - Main menu: search, profile, favorites, recommendations
  - Search type menu: name, venue, category, date, price
  - Date presets: today/tomorrow/7 days
  - Category selector: multi-checkbox for preferences
  - Event navigation: next/previous, card/list toggle, favorites
- **Session management**: `src/redis-session.store.ts`
  - Redis-backed store with TTL: 24 hours
  - Key format: `bot:session:<chat_id>:<user_id>`
  - Automatic JSON serialization/deserialization
  - Error handling: returns undefined on failures
- **Prisma Service**: Uses `@concierge/database` package for database operations
- **Events API Service**: `src/events-api.service.ts`
  - HTTP client to API service
  - Implements `SearchParams` interface
  - Handles date preset logic: today/tomorrow/week → ISO dates
  - Category ID normalization: single string or array
- **User Service**: `src/user.service.ts`
  - User registration: auto-creates on /start with telegramId
  - Preferences: category and price range selection
  - Favorites: add/remove saved events
- **Digest Service**: `src/digest.service.ts` - daily event digest sent via cron (env: DIGEST_CRON)

**Bot features**:
- Search by name, venue, category, date, price
- Card and list views with pagination
- Favorites management
- User profile with preferences (categories, price range)
- Personalized recommendations based on preferences
- Lazy loading: loads events in chunks as user navigates

**Session structure** (stored in Redis):
```typescript
{
  selectedCategories?: string[];
  events?: EventItem[];          // Currently displayed events
  currentIndex?: number;          // Current event in navigation
  view?: 'card' | 'list';
  searchMode?: 'name' | 'price' | 'venue' | null;
  searchParams?: any;             // Last search for reload
  totalEvents?: number;           // Total count from API
  searchToken?: string;           // Isolates callbacks per search
  profileEditMode?: string;       // Current profile edit field
  tempCategorySelection?: string[];
  categoriesList?: CategoryItem[];
}
```

**Key environment variables**:
- `DATABASE_URL` - PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/db)
- `TELEGRAM_BOT_TOKEN` - Main bot token
- `API_BASE_URL` - URL to API service (default: http://api:3000)
- `REDIS_URL` - Redis connection for sessions
- `DIGEST_CRON` - Cron schedule for daily digest (default: 0 8 * * *)
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (legacy, kept for compatibility)

### Instagram Scraper (apps/instagram-scraper)

**AI-powered Instagram scraper** using Apify + LLM extraction:
- **Main entry**: `src/index.ts` - scrapes Instagram posts and extracts event data using AI
- **Scheduler**: `src/scheduler.ts` - runs scraper on cron schedule (configurable via SCRAPER_CRON)
  - **Production deployment**: Scheduler starts automatically in Docker container via `CMD ["node", "dist/scheduler.js"]`
  - Runs immediately on container start, then on schedule (default: every 3 hours)
  - Uses CronJob with Europe/Kiev timezone
- **Apify integration**: Uses Apify Instagram Profile Scraper actor to fetch posts
  - Supports scraping by accounts, hashtags, or locations
  - Configurable results limit per source
- **AI extraction**: `src/aiExtractor.ts`
  - Supports multiple AI providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Groq
  - **Batch processing with chunking**: Splits posts into chunks of 10 for efficient processing (optimized for llama-3.3-70b-versatile with 12000 TPM limit)
  - Extracts structured event data from Instagram post captions and metadata
  - Confidence scoring: only publishes events above minimum threshold (default: 0.7)
  - Rate limiting: 30-second delay between chunks to stay under TPM limit (2 chunks per minute = 10512 tokens < 12000)
- **Date parsing**: `src/dateUtils.ts` - parses Ukrainian/English date formats from captions
- **RabbitMQ publisher**: `src/rabbitmq.ts` - publishes extracted events to same queue as web-crawler
- **Tracker**: `src/tracker.ts` - sends Telegram notifications on scraper progress/errors

**Key environment variables**:
- `APIFY_TOKEN` - Apify API token (required)
- `APIFY_ACTOR_ID` - Instagram scraper actor ID (default: shu8hvrXbJbY3Eb9W)
- `INSTAGRAM_ACCOUNTS` - Comma-separated list of Instagram usernames to scrape
- `INSTAGRAM_HASHTAGS` - Comma-separated list of hashtags to scrape (optional)
- `INSTAGRAM_LOCATIONS` - Comma-separated list of location IDs (optional)
- `RESULTS_LIMIT` - Max posts per source (default: 200)
- `SAVE_OUTPUT` - Save output to JSON files (default: false)
- `OUTPUT_FILE` - Output filename (default: instagram-posts.json)
- `SCRAPER_CRON` - Cron schedule (default: 0 */3 * * * - every 3 hours)
- `AI_PROVIDER` - AI provider: openai | anthropic | google | groq (default: openai)
- `AI_API_KEY` - API key for the selected AI provider (required)
- `AI_MODEL` - Model name (optional, uses provider default)
- `MIN_AI_CONFIDENCE` - Minimum confidence score for event extraction (default: 0.7)
- `RABBITMQ_URL`, `RABBITMQ_QUEUE` - RabbitMQ connection (shares queue with web-crawler)
- `TELEGRAM_TRACKER_TOKEN`, `TELEGRAM_CHAT_ID` - Telegram notifications

**AI extraction flow**:
1. Fetch Instagram posts via Apify (accounts/hashtags/locations) - separate API calls per source type
2. For each post: extract caption, timestamp, ownerUsername, url
3. **Batch processing with chunking**: Split posts into chunks of 10 (optimized for llama-3.3-70b-versatile, 12000 TPM limit)
4. Send each chunk to AI with structured prompt requesting event data
5. AI responds with JSON array: [{isEvent, title, dateTime, venue, price, category, confidence, reasoning}, ...]
6. Combine all chunk results with 30-second delay between chunks to stay under TPM limit (2 chunks/min = 10512 tokens < 12000)
7. Filter by confidence threshold (MIN_CONFIDENCE, default: 0.7)
8. Deduplicate events by ID and semantic key (title + date)
9. Publish to RabbitMQ with same format as web-crawler events
10. Fallback to single-post processing if batch processing fails

### Database Schema

**ORM**: The project uses **Prisma** as the ORM for database operations.

**Prisma setup**:
- **Schema location**: `prisma/schema.prisma` - defines all database models
- **Shared service**: `packages/database/src/prisma.service.ts` - PrismaService for both API and Bot
- **Generated client**: `@prisma/client` - auto-generated TypeScript client
- **Database**: PostgreSQL
- **Category system**: `packages/database/src/categories.ts` - standardized category mapping
  - Exports `STANDARD_CATEGORIES` (Ukrainian category names)
  - `CATEGORY_MAPPING` maps English/various names → Ukrainian standards
  - `normalizeCategory()` function for consistent category resolution
  - Used by both web-crawler and Instagram scraper for unified categorization

**Key Prisma commands** (run from project root):
```bash
npx prisma generate                    # Generate Prisma Client
npx prisma migrate dev                 # Create and apply migrations (dev)
npx prisma migrate deploy              # Apply migrations (production)
npx prisma studio                      # Open Prisma Studio GUI
npx prisma db push                     # Push schema changes without migrations
```

**Database models** (see `prisma/schema.prisma`):
- **Category** - Event categories (id, name, icon, parentId with self-relation)
- **Venue** - Event venues (id, name, address, lat, lng, phone, website)
- **Event** - Events (id, title, description, categoryId, venueId, dateTime, dateTimeFrom, dateTimeTo, priceFrom, priceTo, sourceUrl, imageUrl)
  - **Key indexes**:
    - `idx_events_category` on categoryId - for category filtering
    - `idx_events_venue` on venueId - for venue filtering
    - `idx_events_date_time` on dateTime - for date-based queries (fallback date)
    - `idx_events_date_time_from` on dateTimeFrom - for range start queries
    - `idx_events_date_time_to` on dateTimeTo - for range end queries
- **User** - Bot users (id, telegramId, name, phone, email, subscriptionType, createdAt)
  - **Key indexes**:
    - `idx_users_telegram_id` on telegramId - for bot user lookups (unique constraint)
- **UserPreference** - User search preferences (id, userId, categoryIds, districtIds, priceMin, priceMax, createdAt, updatedAt)
  - **Key indexes**:
    - `idx_user_preferences_user_id` on userId - for preference lookups (unique constraint)
- **Favorite** - User favorite events (id, userId, eventId, createdAt)
  - **Key indexes**:
    - `idx_favorites_user_id` on userId - for user's favorites queries
    - `idx_favorites_event_id` on eventId - for event popularity queries
    - Unique constraint on (userId, eventId) - prevents duplicate favorites

**Legacy SQL migrations** (see `packages/database/init/` for initial schema):
- `01_events.sql` - creates events, categories, venues tables
- `02_users.sql` - creates users and favorites tables
- `03_user_preferences.sql` - creates user_preferences table with triggers

## Testing

Jest is configured for API and bot, but no tests are currently implemented:
- **API**: `npm run test --workspace=apps/api` (Jest configured, no tests written yet)
- **Bot**: `npm run test --workspace=apps/bot` (Jest configured, no tests written yet)
- **Crawler**: No test suite configured yet

To add tests:
- API/Bot: Create `.spec.ts` files in `src/` directories (Jest will auto-discover)
- Crawler: Configure Jest or another test framework, add tests in `apps/web-crawler/src/__tests__/`

## Environment Variables

**Required for local development** (see `.env.example`):
- `DATABASE_URL` - PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/concierge)
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - Database credentials (used to build DATABASE_URL)
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_TRACKER_TOKEN` - Token for status notifications (optional)
- `TELEGRAM_CHAT_ID` - Chat ID for notifications (optional)

**Optional configuration**:
- `CRAWLER_SCHEDULE=0 */3 * * *` - Cron schedule for web crawler (default: every 3 hours)
- `CONFIG_DIR=crawl-configs` - Directory containing crawler configurations
- `STATE_PREFIX=concert.ua` - Redis key prefix for crawler state
- `CRAWLER_SAVE_OUTPUT=false` - Save crawler results to JSON files
- `SOURCE_BASE_URL=https://concert.ua` - Base URL for the source website
- `PUBLISHER_BATCH_SIZE=50` - RabbitMQ publisher batch size
- `CONSUMER_BATCH_SIZE=100` - RabbitMQ consumer batch size

**Instagram scraper** (optional if using Instagram scraping):
- `APIFY_TOKEN` - Apify API token (required)
- `APIFY_ACTOR_ID=shu8hvrXbJbY3Eb9W` - Instagram scraper actor ID
- `INSTAGRAM_ACCOUNTS` - Comma-separated Instagram usernames
- `INSTAGRAM_HASHTAGS` - Comma-separated hashtags (optional)
- `INSTAGRAM_LOCATIONS` - Comma-separated location IDs (optional)
- `RESULTS_LIMIT=200` - Max posts per source
- `SAVE_OUTPUT=false` - Save output to JSON files
- `OUTPUT_FILE=instagram-posts.json` - Output filename
- `SCRAPER_CRON=0 */3 * * *` - Cron schedule for Instagram scraper

**AI extraction** (for Instagram scraper):
- `AI_PROVIDER=openai` - AI provider: openai | anthropic | google | groq
- `AI_API_KEY` - API key for the selected provider
- `AI_MODEL` - Model name (optional, uses provider default)
- `MIN_AI_CONFIDENCE=0.7` - Minimum confidence for event extraction (0.0-1.0)

## Common Patterns

### Adding a new scraper config
1. Create JSON config in `apps/web-crawler/crawl-configs/<site>/<city>/`
2. Define selectors (must include at least: title, link, dateTime)
3. Set `incremental.uniqueKey` to identify duplicate events
4. Use English category names in config - they'll be auto-normalized to Ukrainian via `normalizeCategory()` from `packages/database/src/categories.ts`
5. **Optional**: Add `image_url` selector in `details.selectors` to extract event images (stored in Event.imageUrl)
6. Test locally: `npm run dev --workspace=apps/web-crawler path/to/config.json`
7. For production: Docker rebuilds and scheduler picks up new configs

### Modifying bot commands
- Add/update handlers in `apps/bot/src/bot.update.ts` using Telegraf decorators:
  - `@Start()` - Handle /start command
  - `@Hears('text')` - Match button text (exact match)
  - `@On('callback_query')` - Handle inline button callbacks
  - `@On('text')` - Handle text input (fallback for unmatched text)
- Update keyboards in `apps/bot/src/keyboards.ts`:
  - `mainKeyboard` - main menu reply keyboard
  - `viewKeyboard` - card/list view switcher
  - Inline keyboards created dynamically for navigation, categories, etc.
- Sessions auto-persist to Redis after each interaction

### Adding API endpoints
1. Add method to `apps/api/src/events.service.ts` for Prisma database operations
2. Add route to `apps/api/src/events.controller.ts` with `@Get()` / `@Post()` decorators
3. Update bot's `apps/bot/src/events-api.service.ts` if bot needs to call it

### Database migrations with Prisma
1. **Modify the schema**: Edit `prisma/schema.prisma`
2. **Generate migration**: `npx prisma migrate dev --name migration_name` (creates migration file)
3. **Apply migration**: Migration is auto-applied in dev, use `npx prisma migrate deploy` for production
4. **Regenerate client**: `npx prisma generate` (auto-run after migrate dev)

**Alternative: Direct schema push** (for quick prototyping, not recommended for production):
```bash
npx prisma db push  # Push schema changes directly to database without creating migration
```

**Legacy SQL migrations** (deprecated, use Prisma migrations):
- Initial SQL files in `packages/database/init/` run on first container start
- These are now superseded by Prisma schema in `prisma/schema.prisma`
- Always backup before schema changes: `make backup`

### Configuring Instagram scraper
1. **Get Apify token**: Sign up at apify.com and get API token, add to `APIFY_TOKEN`
2. **Configure AI provider**:
   - Set `AI_PROVIDER` (openai/anthropic/google/groq)
   - Add corresponding API key to `AI_API_KEY`
   - Optionally set `AI_MODEL` (uses provider default if not set)
3. **Set Instagram sources**: Add accounts to `INSTAGRAM_ACCOUNTS` env var (comma-separated)
4. **Test locally**: `npm run dev --workspace=apps/instagram-scraper` or `make instagram-run`
5. **Adjust confidence threshold**: Tune `MIN_AI_CONFIDENCE` (0.0-1.0) based on extraction quality
6. **Configure scheduler**: Set `SCRAPER_CRON` for custom schedule (default: every 3 hours)
7. **For production**: Run `make docker-build && make docker-up` - scheduler starts automatically
8. **Category normalization**: AI extracts categories in any language, but they're normalized to Ukrainian standards via `normalizeCategory()`

## Architectural Patterns & Design Decisions

### Idempotency & Deduplication
- **Crawler-level**: Generates deterministic event IDs using SHA256 hash of uniqueKey fields
- **Consumer-level**: Deduplicates events within batch before database operations
- **Database-level**: Prisma upsert operations (update if exists, insert if new)
- **Result**: Safe at-least-once delivery - duplicate messages don't create duplicate events

### Fuzzy Matching Strategy
- **Problem**: Ukrainian text has multiple variants (Cyrillic/Latin, with/without diacritics, different spacing)
- **Solution**: Custom PostgreSQL normalization function
  - Step 1: `regexp_replace()` removes punctuation and extra spaces
  - Step 2: `translate('АВЕ', 'ABE')` converts common Cyrillic → Latin
  - Step 3: `LOWER()` for case-insensitive comparison
  - Step 4: Order by `length(name)` to prefer shorter (canonical) names
- **Used in**: Venue/category resolution, venue search

### Batching & Buffering
- **Crawler → RabbitMQ**: Batches events (PUBLISHER_BATCH_SIZE=50) with time-based flush (200ms)
- **RabbitMQ → API Consumer**: Buffers messages (CONSUMER_BATCH_SIZE=100) with time-based flush (200ms)
- **Benefits**: Reduces round-trips, enables transactional processing, improves throughput
- **Tradeoff**: Slight delay (max 200ms) in event availability

### Lazy Loading in Bot
- **Strategy**: Load all search results on first search, cache in Redis session
- **Benefits**: Fast pagination without API calls, consistent results during navigation
- **Session token**: Isolates callbacks - prevents old search callbacks from affecting new search
- **Tradeoff**: Session size grows with result count (mitigated by 24-hour TTL)

### State Management
- **Crawler state**: Redis for distributed/production, JSON file for local development
- **Bot sessions**: Redis with 24-hour TTL, key format: `bot:session:<chat_id>:<user_id>`
- **RabbitMQ**: Durable queues with persistent messages (survives broker restart)
- **Database**: PostgreSQL as source of truth for all event data

### Error Resilience
- **Crawler**: Retries with proxy rotation on 429/403/503, sends Telegram notifications on failures
- **Consumer**: NACKs malformed messages (RabbitMQ requeues), sends Telegram notifications on processing errors
- **Bot**: Graceful fallbacks on API errors, shows user-friendly error messages in Ukrainian
- **RabbitMQ Publisher**: Confirm mode + auto-reconnect with exponential backoff

### Data Normalization
- **Dates**: Crawler converts all dates to UTC ISO format (from Europe/Kyiv timezone)
- **Prices**: Stored as Decimal(12,2) to avoid float precision issues
- **IDs**: Deterministic hashing for events (content-based), venues (name+address), categories (name+parentId)
- **Text encoding**: All text stored in UTF-8 (supports Ukrainian Cyrillic)
- **Categories**: All category names normalized to Ukrainian standards via `normalizeCategory()` function
  - Web-crawler: English names in configs (e.g., "concert", "theater") → Ukrainian
  - Instagram scraper: AI extracts in any language → normalized to Ukrainian
  - API/Bot: Always work with Ukrainian category names
  - Ensures consistency across all event sources

## Important Notes

- **Language**: All user-facing text is in Ukrainian
- **Timezone**: Crawler converts Ukrainian dates to UTC ISO format before publishing
- **Error handling**: Crawler sends Telegram notifications on failures (if TELEGRAM_TRACKER_TOKEN set)
- **Deduplication**: Crawler uses hash of uniqueKey fields to detect seen events (stored in Redis)
- **Venue fuzzy matching**: API consumer attempts fuzzy match before creating duplicate venues
- **Proxy rotation**: Crawler rotates proxies on 429/403/503 errors automatically
- **Redis key namespacing**: State keys prefixed with STATE_PREFIX (e.g., `concert.ua:hashes`, `concert.ua:meta`)
- **Session isolation**: Bot uses search tokens to prevent callback collision across multiple searches
- **Transactional safety**: Consumer uses Prisma transactions for atomic multi-entity operations
