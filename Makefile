.PHONY: start-dev backup backup-manual restore list-backups db-backup-logs \
	docker-build docker-up docker-down docker-restart docker-logs docker-ps \
	dev-infra dev-infra-down dev-api dev-bot dev-crawler \
	crawler-logs crawler-health

start-dev:
	cd apps/web-crawler && npm run dev

# Development commands (only infrastructure in Docker)
dev-infra:
	@echo "Starting development infrastructure (DB, Redis, RabbitMQ)..."
	@docker-compose -f docker-compose.dev.yml up -d

dev-infra-down:
	@echo "Stopping development infrastructure..."
	@docker-compose -f docker-compose.dev.yml down

dev-api:
	@echo "Starting API in development mode..."
	@npm run start:dev --workspace=apps/api

dev-bot:
	@echo "Starting Bot in development mode..."
	@npm run start:dev --workspace=apps/bot

dev-crawler:
	@echo "Starting Web Crawler in development mode..."
	@npm run dev --workspace=apps/web-crawler

# Docker commands (production)
docker-build:
	@echo "Building Docker images..."
	@docker-compose build

docker-up:
	@echo "Starting all services..."
	@docker-compose up -d

docker-down:
	@echo "Stopping all services..."
	@docker-compose down

docker-restart:
	@echo "Restarting all services..."
	@docker-compose restart

docker-logs:
	@docker-compose logs -f

docker-ps:
	@docker-compose ps

# Database backup commands
backup:
	@echo "Creating database backup using Docker..."
	@BACKUP_DIR=./packages/database/backups \
	 POSTGRES_CONTAINER=concierge-postgres \
	 ./packages/database/docker-backup.sh

backup-manual:
	@echo "Creating manual database backup..."
	@BACKUP_DIR=./packages/database/backups \
	 ./packages/database/backup.sh manual

restore:
	@if [ -z "$(FILE)" ]; then \
		echo "Error: Backup file not specified"; \
		echo "Usage: make restore FILE=<backup_file>"; \
		echo ""; \
		echo "Available backups:"; \
		ls -lh ./packages/database/backups/*.sql.gz 2>/dev/null || echo "No backups found"; \
		exit 1; \
	fi
	@./packages/database/restore.sh $(FILE)

list-backups:
	@echo "Available backups:"
	@ls -lh ./packages/database/backups/*.sql.gz 2>/dev/null || echo "No backups found"

db-backup-logs:
	@docker logs concierge-postgres-backup --tail=50 -f

# Web crawler commands
crawler-logs:
	@echo "Web crawler logs (Ctrl+C to exit):"
	@docker exec concierge-web-crawler tail -f /var/log/crawler/cron.log

crawler-health:
	@echo "Checking crawler health..."
	@docker exec concierge-web-crawler cat /var/log/crawler/health.log 2>/dev/null | tail -10 || echo "Health log not yet available"