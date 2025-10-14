#!/bin/bash

# PostgreSQL Database Restore Script
# Usage: ./restore.sh <backup_file>

set -e

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-concierge}"

# Check if backup file is provided
if [ -z "$1" ]; then
    echo "Error: Backup file not specified"
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Available backups:"
    ls -lh ./backups/*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file '$BACKUP_FILE' not found"
    exit 1
fi

echo "=================================================="
echo "PostgreSQL Database Restore"
echo "=================================================="
echo "Database: $POSTGRES_DB"
echo "Host: $POSTGRES_HOST:$POSTGRES_PORT"
echo "Backup file: $BACKUP_FILE"
echo "=================================================="
echo ""
echo "⚠️  WARNING: This will drop and recreate the database!"
echo "All existing data will be lost."
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

# Export password
export PGPASSWORD="$POSTGRES_PASSWORD"

echo "Dropping existing database..."
psql -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d postgres \
     -c "DROP DATABASE IF EXISTS $POSTGRES_DB;"

echo "Creating database..."
psql -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d postgres \
     -c "CREATE DATABASE $POSTGRES_DB;"

echo "Restoring backup..."
if gunzip -c "$BACKUP_FILE" | psql -h "$POSTGRES_HOST" \
                                    -p "$POSTGRES_PORT" \
                                    -U "$POSTGRES_USER" \
                                    -d "$POSTGRES_DB" \
                                    --quiet; then
    echo "=================================================="
    echo "✓ Restore completed successfully!"
    echo "=================================================="
else
    echo "✗ Restore failed!"
    exit 1
fi

unset PGPASSWORD

