# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Concierge is an events management system that scrapes Ukrainian event websites, stores event data in PostgreSQL, and provides access via a Telegram bot and REST API. The system consists of three main applications running in Docker containers with shared infrastructure (PostgreSQL, Redis, RabbitMQ).

## Architecture

### Monorepo Structure
- **apps/api** - NestJS REST API for event management (port 3000)
- **apps/bot** - NestJS Telegram bot with Telegraf (port 3001)
- **apps/web-crawler** - Node.js web scraper with Playwright (runs on schedule)
- **packages/database** - SQL migrations, backups, and database utilities
- **packages/eslint-config** - Shared ESLint configuration
- **packages/prettier-config** - Shared Prettier configuration

### Message Flow Architecture

1. **Web Crawler → RabbitMQ**: Crawler scrapes event websites and publishes event data to RabbitMQ queue
2. **RabbitMQ → API Consumer**: API service consumes messages in batches and writes to PostgreSQL
3. **API → Database**: All event data stored in PostgreSQL with categories, venues, and user preferences
4. **Bot → API**: Telegram bot queries API for event search and retrieval
5. **Bot → Redis**: Bot uses Redis for session management (user search state, pagination)
6. **Bot → Database**: Direct database access for user management and favorites

### Data Flow

```
Crawler (Playwright)
  → Scrapes events with incremental deduplication (Redis)
  → Publishes to RabbitMQ with batching
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

**Local development (apps run locally, infrastructure in Docker):**
```bash
make dev-infra          # Start DB, Redis, RabbitMQ only
make dev-api            # Run API in dev mode
make dev-bot            # Run bot in dev mode
make dev-crawler        # Run crawler in dev mode
```

**Production (all services in Docker):**
```bash
make docker-build       # Build all Docker images
make docker-up          # Start all services
make docker-down        # Stop all services
make docker-logs        # View logs
make docker-restart     # Restart services
```

### Linting & Formatting
```bash
npm run lint            # Lint web-crawler only (root script)
npm run format          # Format all files
npm run format:check    # Check formatting
```

### Building
```bash
npm run build           # Build web-crawler and bot (root script)
npm run build --workspace=apps/api    # Build specific app
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

# Run crawler manually (from apps/web-crawler/)
npm run dev config.json                           # Single config
npm run dev crawl-configs/concert.ua/kyiv         # Directory of configs
```

## Key Technical Details

### Web Crawler (apps/web-crawler)

**Configuration-driven scraper** using Playwright + stealth mode:
- **Config location**: `apps/web-crawler/crawl-configs/` (JSON files)
- **Main entry**: `src/index.ts` - reads config, orchestrates scraping, publishes to RabbitMQ
- **Scraper engine**: `src/scraper.ts` - Playwright-based with proxy rotation and user-agent management
- **Incremental crawling**: Uses Redis to track seen items (by hash of uniqueKey fields)
- **Proxy support**: Loads proxies from file, rotates on errors (429, 403, 503)
- **Batched publishing**: RabbitMQ publisher with configurable batch size and confirms

**Config structure**:
- `url` - Page to scrape
- `selectors` - Array of {name, selector, type, multiple, transform}
- `pagination` - Type: "button-click" | "infinite-scroll" | "url-format"
- `details` - Optional: scrape detail pages concurrently (clickSelector or link field)
- `incremental` - {enabled, uniqueKey: string[], trackChanges, updateExisting}
- `proxyFile`, `proxyRotation`, `userAgents`, `userAgentRotation`
- `retries` - Number of retry attempts on failure

**Scheduler**: `src/scheduler.ts` runs crawler on cron schedule (default: every 3 hours)

### API (apps/api)

**NestJS application**:
- **Main**: `src/main.ts` - Bootstraps NestJS app on port 3000
- **RabbitMQ Consumer**: `src/rabbitmq.consumer.ts`
  - Buffered consumer with configurable batch size (env: CONSUMER_BATCH_SIZE, CONSUMER_FLUSH_MS)
  - Resolves venue/category by fuzzy matching or creates new
  - Bulk upserts events to database
- **Events Service**: `src/events.service.ts` - Database operations for events, categories, venues
- **Events Controller**: `src/events.controller.ts` - REST endpoints for search, CRUD
- **Telegram Service**: `src/telegram.service.ts` - Sends notifications to Telegram (tracker bot)

**Key environment variables**:
- `RABBITMQ_URL`, `RABBITMQ_QUEUE`, `RABBITMQ_PREFETCH`
- `CONSUMER_BATCH_SIZE`, `CONSUMER_FLUSH_MS`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `TELEGRAM_TRACKER_TOKEN`, `TELEGRAM_CHAT_ID` (for crawler status notifications)

### Bot (apps/bot)

**NestJS + Telegraf bot**:
- **Main**: `src/main.ts` - Bootstraps NestJS app on port 3001
- **Bot Update**: `src/bot.update.ts` - Handles all Telegram interactions (commands, callbacks, text)
- **Session management**: Redis-backed sessions (`src/redis-session.store.ts`)
- **Events API Service**: `src/events-api.service.ts` - HTTP client to API service
- **User Service**: `src/user.service.ts` - Direct database access for users, preferences, favorites
- **Digest Service**: `src/digest.service.ts` - Daily event digest sent via cron (env: DIGEST_CRON)

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
}
```

**Key environment variables**:
- `TELEGRAM_BOT_TOKEN` - Main bot token
- `API_BASE_URL` - URL to API service (default: http://api:3000)
- `REDIS_URL` - Redis connection for sessions
- `DIGEST_CRON` - Cron schedule for daily digest (default: 0 8 * * *)

### Database Schema

**PostgreSQL tables** (see `packages/database/init/` for SQL):
- `categories` - Event categories (id, name, created_at)
- `venues` - Event venues (id, name, address, created_at)
- `events` - Events (id, title, description, category_id, venue_id, date_time, date_time_from, date_time_to, price_from, source_url, created_at, updated_at)
- `users` - Bot users (id, telegram_id, name, phone, email, subscription_type, created_at, updated_at)
- `user_preferences` - User search preferences (user_id, category_ids, price_min, price_max)
- `user_favorites` - User favorite events (user_id, event_id)

## Testing

Currently no test suite is configured. To add tests:
- API/Bot: Jest is configured in package.json, run `npm run test --workspace=apps/api`
- Crawler: Add tests in `apps/web-crawler/src/__tests__/`

## Environment Variables

**Required for local development** (see `env.example`):
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - Database credentials
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_TRACKER_TOKEN` - Token for status notifications (optional)
- `TELEGRAM_CHAT_ID` - Chat ID for notifications (optional)

**Optional configuration**:
- `CRAWLER_SAVE_OUTPUT=true` - Save crawler results to JSON files
- `PUBLISHER_BATCH_SIZE=50` - RabbitMQ publisher batch size
- `CONSUMER_BATCH_SIZE=100` - RabbitMQ consumer batch size
- `STATE_PREFIX=concert.ua` - Redis key prefix for crawler state

## Common Patterns

### Adding a new scraper config
1. Create JSON config in `apps/web-crawler/crawl-configs/<site>/<city>/`
2. Define selectors (must include at least: title, link, dateTime)
3. Set `incremental.uniqueKey` to identify duplicate events
4. Test locally: `npm run dev --workspace=apps/web-crawler path/to/config.json`
5. For production: Docker rebuilds and scheduler picks up new configs

### Modifying bot commands
- Add/update handlers in `apps/bot/src/bot.update.ts` using decorators:
  - `@Hears('text')` - Match button text
  - `@On('callback_query')` - Handle inline button callbacks
  - `@On('text')` - Handle text input
- Update keyboards in `apps/bot/src/keyboards.ts`
- Sessions auto-persist to Redis

### Adding API endpoints
1. Add method to `apps/api/src/events.service.ts` for database operations
2. Add route to `apps/api/src/events.controller.ts` with `@Get()` / `@Post()` decorators
3. Update bot's `apps/bot/src/events-api.service.ts` if bot needs to call it

### Database migrations
- SQL files in `packages/database/init/` run on first container start
- For schema changes: create new SQL file, restart database container
- Always backup before schema changes: `make backup`

## Important Notes

- **Language**: All user-facing text is in Ukrainian
- **Timezone**: Crawler converts Ukrainian dates to UTC ISO format before publishing
- **Error handling**: Crawler sends Telegram notifications on failures (if TELEGRAM_TRACKER_TOKEN set)
- **Deduplication**: Crawler uses hash of uniqueKey fields to detect seen events (stored in Redis)
- **Venue fuzzy matching**: API consumer attempts fuzzy match before creating duplicate venues
- **Proxy rotation**: Crawler rotates proxies on 429/403/503 errors automatically
