#!/bin/bash

# Script to run concert.ua crawlers sequentially
# This script runs concerts crawler first, then theater crawler

set -e  # Exit on any error

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Lock file to prevent concurrent executions
LOCK_FILE="/tmp/concert-crawlers.lock"

# Function to cleanup lock file on exit
cleanup() {
    rm -f "$LOCK_FILE"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check if another instance is running
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another instance is already running with PID $PID. Exiting."
        exit 0
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stale lock file found. Removing..."
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock file with current PID
echo $$ > "$LOCK_FILE"

# Log file locations
LOG_DIR="${LOG_DIR:-$HOME/.crawler-logs}"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting concert.ua crawlers..."

# Find all config directories in concert.ua/kyiv
# Using ls for compatibility (works on systems with fd or find)
CONFIG_DIRS=$(ls -1d crawl-configs/concert.ua/kyiv/*/ 2>/dev/null | sed 's:/$::' | sort)

TOTAL_CONFIGS=$(echo "$CONFIG_DIRS" | wc -l | tr -d ' ')
CURRENT=0
FAILED=0

for CONFIG_DIR in $CONFIG_DIRS; do
    CURRENT=$((CURRENT + 1))
    CATEGORY=$(basename "$CONFIG_DIR")
    CONFIG_FILE="$CONFIG_DIR/config.json"
    
    if [ ! -f "$CONFIG_FILE" ]; then
        echo "[$TIMESTAMP] WARNING: Config file not found: $CONFIG_FILE"
        continue
    fi
    
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] Running crawler $CURRENT/$TOTAL_CONFIGS: $CATEGORY..."
    
    if node dist/index.js "$CONFIG_FILE" >> "$LOG_DIR/$CATEGORY.log" 2>&1; then
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
        echo "[$TIMESTAMP] ✅ $CATEGORY completed successfully"
    else
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
        echo "[$TIMESTAMP] ❌ ERROR: $CATEGORY failed with exit code $?"
        FAILED=$((FAILED + 1))
    fi
    
    # Small delay between crawlers to avoid rate limiting
    if [ $CURRENT -lt $TOTAL_CONFIGS ]; then
        sleep 3
    fi
done

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
if [ $FAILED -eq 0 ]; then
    echo "[$TIMESTAMP] 🎉 All $TOTAL_CONFIGS crawlers completed successfully!"
else
    echo "[$TIMESTAMP] ⚠️  Completed with $FAILED failures out of $TOTAL_CONFIGS crawlers"
    exit 1
fi

