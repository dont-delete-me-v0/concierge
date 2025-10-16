# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Concierge is an events management system that scrapes Ukrainian event websites, stores event data in PostgreSQL, and provides access via a Telegram bot and REST API. The system consists of three main applications running in Docker containers with shared infrastructure (PostgreSQL, Redis, RabbitMQ).

## Architecture

### Monorepo Structure
- **apps/api** - NestJS REST API for event management (port 3000)
- **apps/bot** - NestJS Telegram bot with Telegraf (port 3001)
- **apps/web-crawler** - Node.js web scraper with Playwright (runs on schedule)
- **packages/database** - Prisma schema, migrations, backups, and PrismaService
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
make dev-infra          # Start DB, Redis, RabbitMQ, PgAdmin only
make dev-infra-down     # Stop development infrastructure
make dev-api            # Run API in dev mode
make dev-bot            # Run bot in dev mode
make dev-crawler        # Run crawler in dev mode
```

**Docker development (all services in Docker with hot-reload):**
```bash
make docker-dev-build   # Build all Docker dev images
make docker-dev-up      # Start all services in dev mode
make docker-dev-down    # Stop all dev services
make docker-dev-restart # Restart all dev services
make docker-dev-logs    # View all dev logs
```

**Production (all services in Docker):**
```bash
make docker-build       # Build all Docker images
make docker-up          # Start all services
make docker-down        # Stop all services
make docker-logs        # View logs
make docker-restart     # Restart services
make docker-ps          # Show container status
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

## Key Technical Details

### Web Crawler (apps/web-crawler)

**Configuration-driven scraper** using Playwright + stealth mode:
- **Config location**: `apps/web-crawler/crawl-configs/` (JSON files)
- **Main entry**: `src/index.ts` - reads config, orchestrates scraping, publishes to RabbitMQ
- **Scraper engine**: `src/scraper.ts` - Playwright-based with proxy rotation and user-agent management
- **Scheduler**: `src/scheduler.ts` - runs crawler on cron schedule (default: every 3 hours)
- **Incremental crawling**: `src/incremental.ts` - uses Redis to track seen items (by hash of uniqueKey fields)
- **Proxy management**: `src/proxyManager.ts` - loads proxies from file, rotates on errors (429, 403, 503)
- **RabbitMQ publisher**: `src/rabbitmq.ts` - batched publishing with configurable batch size and confirms
- **Date parsing**: `src/dateUtils.ts` - converts Ukrainian dates to UTC ISO format
- **Price parsing**: `src/priceUtils.ts` - extracts and normalizes price information
- **Data extraction**: `src/extractor.ts` - applies selectors and transforms to extract data
- **Pagination**: `src/pagination.ts` - handles button-click, infinite-scroll, and url-format pagination

**Config structure**:
- `url` - Page to scrape
- `selectors` - Array of {name, selector, type, multiple, transform}
- `pagination` - Type: "button-click" | "infinite-scroll" | "url-format"
- `details` - Optional: scrape detail pages concurrently (clickSelector or link field)
- `incremental` - {enabled, uniqueKey: string[], trackChanges, updateExisting}
- `proxyFile`, `proxyRotation`, `userAgents`, `userAgentRotation`
- `retries` - Number of retry attempts on failure

### API (apps/api)

**NestJS application** (port 3000):
- **Main**: `src/main.ts` - bootstraps NestJS app on port 3000
- **App Module**: `src/app.module.ts` - root module configuration, includes PrismaService
- **Prisma Service**: Uses `@concierge/database` package for database operations
- **RabbitMQ Consumer**: `src/rabbitmq.consumer.ts`
  - Buffered consumer with configurable batch size (env: CONSUMER_BATCH_SIZE, CONSUMER_FLUSH_MS)
  - Resolves venue/category by fuzzy matching or creates new
  - Bulk upserts events to database using Prisma
- **Events Service**: `src/events.service.ts` - Prisma-based operations for events, categories, venues
- **Events Controller**: `src/events.controller.ts` - REST endpoints for search, CRUD, health check
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
- **Bot Update**: `src/bot.update.ts` - handles all Telegram interactions (commands, callbacks, text)
- **Keyboards**: `src/keyboards.ts` - inline and reply keyboard definitions
- **Session management**: `src/redis-session.store.ts` - Redis-backed session store
- **Prisma Service**: Uses `@concierge/database` package for database operations
- **Events API Service**: `src/events-api.service.ts` - HTTP client to API service
- **User Service**: `src/user.service.ts` - Prisma-based operations for users, preferences, favorites
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
}
```

**Key environment variables**:
- `DATABASE_URL` - PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/db)
- `TELEGRAM_BOT_TOKEN` - Main bot token
- `API_BASE_URL` - URL to API service (default: http://api:3000)
- `REDIS_URL` - Redis connection for sessions
- `DIGEST_CRON` - Cron schedule for daily digest (default: 0 8 * * *)
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (legacy, kept for compatibility)

### Database Schema

**ORM**: The project uses **Prisma** as the ORM for database operations.

**Prisma setup**:
- **Schema location**: `prisma/schema.prisma` - defines all database models
- **Shared service**: `packages/database/src/prisma.service.ts` - PrismaService for both API and Bot
- **Generated client**: `@prisma/client` - auto-generated TypeScript client
- **Database**: PostgreSQL

**Key Prisma commands**:
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
- **Event** - Events (id, title, description, categoryId, venueId, dateTime, dateTimeFrom, dateTimeTo, priceFrom, sourceUrl)
- **User** - Bot users (id, telegramId, name, phone, email, subscriptionType, createdAt)
- **UserPreference** - User search preferences (id, userId, categoryIds, districtIds, priceMin, priceMax, createdAt, updatedAt)
- **Favorite** - User favorite events (id, userId, eventId, createdAt)

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

**Required for local development** (see `env.example`):
- `DATABASE_URL` - PostgreSQL connection string (e.g., postgresql://user:pass@localhost:5432/concierge)
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - Database credentials (used to build DATABASE_URL)
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

## Important Notes

- **Language**: All user-facing text is in Ukrainian
- **Timezone**: Crawler converts Ukrainian dates to UTC ISO format before publishing
- **Error handling**: Crawler sends Telegram notifications on failures (if TELEGRAM_TRACKER_TOKEN set)
- **Deduplication**: Crawler uses hash of uniqueKey fields to detect seen events (stored in Redis)
- **Venue fuzzy matching**: API consumer attempts fuzzy match before creating duplicate venues
- **Proxy rotation**: Crawler rotates proxies on 429/403/503 errors automatically
