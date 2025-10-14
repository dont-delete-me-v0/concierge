#!/bin/bash

# Docker-based PostgreSQL Backup Script
# This script runs pg_dump inside the Docker container

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-concierge}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-concierge-postgres}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate backup filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

echo "=================================================="
echo "Starting PostgreSQL Database Backup (Docker)"
echo "=================================================="
echo "Container: $CONTAINER_NAME"
echo "Database: $POSTGRES_DB"
echo "Backup file: $BACKUP_PATH"
echo "=================================================="

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container '$CONTAINER_NAME' is not running"
    exit 1
fi

# Create backup using docker exec
if docker exec "$CONTAINER_NAME" pg_dump \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
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

