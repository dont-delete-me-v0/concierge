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

# Run concerts crawler
echo "[$TIMESTAMP] Running concerts crawler..."
if node dist/index.js config-concert-ua.json >> "$LOG_DIR/concerts.log" 2>&1; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] Concerts crawler completed successfully"
else
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] ERROR: Concerts crawler failed with exit code $?"
    exit 1
fi

# Small delay between crawlers to avoid rate limiting
sleep 5

# Run theater crawler
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] Running theater crawler..."
if node dist/index.js config-concert-ua-theather.json >> "$LOG_DIR/theater.log" 2>&1; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] Theater crawler completed successfully"
else
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] ERROR: Theater crawler failed with exit code $?"
    exit 1
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] All crawlers completed successfully!"

