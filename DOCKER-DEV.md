# Docker Development Mode with Hot-Reload

This guide explains how to run the Concierge project in Docker development mode with hot-reload support.

## Overview

The project now supports two development approaches:

1. **Docker Dev Mode** (NEW) - All services run in Docker with hot-reload
2. **Local Dev Mode** (existing) - Only infrastructure in Docker, apps run locally

## Docker Dev Mode Setup

### Prerequisites

- Docker and Docker Compose installed
- `.env` file configured (see `env.example`)

### Quick Start

```bash
# Build development images
make docker-dev-build

# Start all services in development mode
make docker-dev-up

# View logs (all services)
make docker-dev-logs

# View logs for specific service
docker-compose -f docker-compose.dev.yml logs -f api
docker-compose -f docker-compose.dev.yml logs -f bot
docker-compose -f docker-compose.dev.yml logs -f web-crawler

# Stop all services
make docker-dev-down

# Restart services
make docker-dev-restart
```

### How Hot-Reload Works

#### API & Bot (NestJS apps)
- Source code is mounted as read-only volumes from `./apps/{api,bot}/src`
- NestJS watches for file changes using `nest start --watch`
- Changes are automatically detected and the app recompiles
- No container restart needed

#### Web Crawler
- Source code is mounted as read-only volume from `./apps/web-crawler/src`
- Config files mounted from `./apps/web-crawler/crawl-configs`
- For scheduler mode, you need to manually trigger reruns after code changes
- For one-off runs: `docker exec concierge-web-crawler-dev npm run dev --workspace=apps/web-crawler`

### Volume Mounts

The development configuration mounts:

**API:**
- `./apps/api/src` → `/app/apps/api/src` (source code)
- Configuration files: `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`

**Bot:**
- `./apps/bot/src` → `/app/apps/bot/src` (source code)
- Configuration files: `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`

**Web Crawler:**
- `./apps/web-crawler/src` → `/app/apps/web-crawler/src` (source code)
- `./apps/web-crawler/crawl-configs` → `/app/apps/web-crawler/crawl-configs` (configs)
- Configuration file: `tsconfig.json`

**Note:** `node_modules` are NOT mounted - they stay inside containers to avoid conflicts.

### Development Workflow

1. Make changes to source code in your local editor
2. Save the file
3. Watch the logs to see automatic recompilation:
   ```bash
   make docker-dev-logs
   # or for specific service:
   docker-compose -f docker-compose.dev.yml logs -f api
   ```
4. Test your changes immediately

### Differences from Production Mode

| Feature | Production | Development |
|---------|-----------|-------------|
| Dockerfile | `Dockerfile` | `Dockerfile.dev` |
| Dependencies | Production only | All (including dev) |
| Source mounting | No | Yes (read-only) |
| NODE_ENV | production | development |
| Restart policy | unless-stopped | unless-stopped |
| Build stage | Multi-stage | Single stage |
| Hot-reload | No | Yes |

### Troubleshooting

#### Changes not detected
```bash
# Restart the specific service
docker-compose -f docker-compose.dev.yml restart api
# or
docker-compose -f docker-compose.dev.yml restart bot
```

#### Permission issues
If you encounter permission issues with mounted volumes on Linux:
```bash
# Add user ownership to source directories
sudo chown -R $USER:$USER apps/
```

#### Port already in use
```bash
# Stop local dev services if running
pkill -f "nest start"
pkill -f "tsx"

# Or stop infrastructure services
make dev-infra-down
```

#### Clean rebuild
```bash
# Stop and remove all containers
make docker-dev-down

# Remove old images
docker-compose -f docker-compose.dev.yml build --no-cache

# Start fresh
make docker-dev-up
```

### Environment Variables

All environment variables from `.env` are passed to containers. Key variables:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - Database credentials
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_TRACKER_TOKEN` - Token for status notifications (optional)
- `API_PORT`, `BOT_PORT` - Port mappings (default: 3000, 3001)

## Local Dev Mode (Existing Approach)

If you prefer to run apps locally and only infrastructure in Docker:

```bash
# Start only infrastructure
make dev-infra

# In separate terminals, run apps locally:
make dev-api
make dev-bot
make dev-crawler

# Stop infrastructure
make dev-infra-down
```

This approach gives you more direct control but requires Node.js installed locally.

## Comparing Approaches

### Docker Dev Mode
**Pros:**
- Consistent environment across team
- No local Node.js version conflicts
- Easy onboarding for new developers
- All dependencies containerized

**Cons:**
- Slightly slower file change detection
- More resource usage (Docker overhead)
- Requires Docker knowledge

### Local Dev Mode
**Pros:**
- Faster hot-reload response
- Direct debugging with IDE
- Lower resource usage
- Familiar workflow

**Cons:**
- Requires local Node.js setup
- Potential version mismatches
- Manual dependency management

## Services Overview

### Infrastructure Services (shared)
- **PostgreSQL** (port 5432) - Database
- **Redis** (port 6379) - Session storage and crawler state
- **RabbitMQ** (port 5672, management UI: 15672) - Message queue
- **PgAdmin** (port 5050) - Database management UI

### Application Services (dev mode only)
- **API** (port 3000) - REST API with NestJS hot-reload
- **Bot** (port 3001) - Telegram bot with NestJS hot-reload
- **Web Crawler** - Playwright-based scraper (runs on schedule or manual)

## Tips

1. **Use selective logs**: Instead of viewing all logs, focus on one service:
   ```bash
   docker-compose -f docker-compose.dev.yml logs -f api
   ```

2. **Check service health**:
   ```bash
   docker-compose -f docker-compose.dev.yml ps
   ```

3. **Execute commands in containers**:
   ```bash
   # Run crawler manually
   docker exec -it concierge-web-crawler-dev npm run dev --workspace=apps/web-crawler

   # Access API container
   docker exec -it concierge-api-dev sh
   ```

4. **Database access**:
   - Use PgAdmin: http://localhost:5050
   - Or connect directly: `psql -h localhost -U postgres -d concierge`

5. **RabbitMQ management**:
   - Access UI: http://localhost:15672 (admin/admin123)

## Next Steps

- See `CLAUDE.md` for project architecture details
- See `README.md` for general project information
- See `Makefile` for all available commands
