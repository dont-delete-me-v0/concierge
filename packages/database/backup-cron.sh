#!/bin/bash

# Automated backup cron script for Docker container
# This script sets up a cron job to run backups on schedule

set -e

echo "=================================================="
echo "PostgreSQL Automated Backup Service"
echo "=================================================="
echo "Schedule: ${BACKUP_SCHEDULE:-0 2 * * *}"
echo "Retention: ${BACKUP_RETENTION_DAYS:-30} days"
echo "Database: ${POSTGRES_DB:-concierge}"
echo "=================================================="

# Install cron if not present
apt-get update -qq && apt-get install -y -qq cron > /dev/null 2>&1

# Create backup script
cat > /usr/local/bin/run-backup.sh << 'EOF'
#!/bin/bash
set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/auto_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..."

if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    -h "$POSTGRES_HOST" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --format=plain \
    --no-owner \
    --no-acl \
    | gzip > "$BACKUP_FILE"; then
    
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed: $BACKUP_FILE ($BACKUP_SIZE)"
    
    # Cleanup old backups
    find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +${BACKUP_RETENTION_DAYS:-30} -delete
    
    REMAINING=$(find "$BACKUP_DIR" -name "*.sql.gz" -type f | wc -l)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Remaining backups: $REMAINING"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup failed!"
    exit 1
fi
EOF

chmod +x /usr/local/bin/run-backup.sh

# Create cron job
CRON_SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"
echo "$CRON_SCHEDULE /usr/local/bin/run-backup.sh >> /var/log/backup-cron.log 2>&1" > /etc/cron.d/db-backup

# Give execution rights
chmod 0644 /etc/cron.d/db-backup

# Apply cron job
crontab /etc/cron.d/db-backup

# Create log file
touch /var/log/backup-cron.log

echo "Cron job installed successfully"
echo "Running initial backup..."

# Run initial backup
/usr/local/bin/run-backup.sh

echo "Starting cron daemon..."
echo "Backup service is now running. Logs: /var/log/backup-cron.log"

# Start cron in foreground
cron && tail -f /var/log/backup-cron.log

