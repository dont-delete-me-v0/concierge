.PHONY: start-dev backup backup-manual restore list-backups db-backup-logs

start-dev:
	cd apps/web-crawler && npm run dev

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