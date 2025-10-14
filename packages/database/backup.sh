#!/bin/bash

# PostgreSQL Database Backup Script
# Usage: ./backup.sh [backup_name]

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-concierge}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate backup filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="${1:-backup}_${TIMESTAMP}.sql.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

echo "=================================================="
echo "Starting PostgreSQL Database Backup"
echo "=================================================="
echo "Database: $POSTGRES_DB"
echo "Host: $POSTGRES_HOST:$POSTGRES_PORT"
echo "Backup file: $BACKUP_PATH"
echo "=================================================="

# Export password for pg_dump
export PGPASSWORD="$POSTGRES_PASSWORD"

# Create backup
if pg_dump -h "$POSTGRES_HOST" \
           -p "$POSTGRES_PORT" \
           -U "$POSTGRES_USER" \
           -d "$POSTGRES_DB" \
           --verbose \
           --format=plain \
           --no-owner \
           --no-acl \
           | gzip > "$BACKUP_PATH"; then
    
    BACKUP_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
    echo "=================================================="
    echo "✓ Backup completed successfully!"
    echo "File: $BACKUP_PATH"
    echo "Size: $BACKUP_SIZE"
    echo "=================================================="
    
    # Cleanup old backups
    echo "Cleaning up backups older than $BACKUP_RETENTION_DAYS days..."
    find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +$BACKUP_RETENTION_DAYS -delete
    
    REMAINING_BACKUPS=$(find "$BACKUP_DIR" -name "*.sql.gz" -type f | wc -l)
    echo "Remaining backups: $REMAINING_BACKUPS"
    echo "=================================================="
else
    echo "✗ Backup failed!"
    exit 1
fi

unset PGPASSWORD

