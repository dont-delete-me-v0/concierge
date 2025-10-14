#!/bin/bash

# Script to run web crawler via system cron
# This script runs the crawler inside the Docker container

set -e

# Configuration
CONTAINER_NAME="concierge-web-crawler"
LOG_FILE="/opt/concierge/logs/crawler.log"
SCRIPT_PATH="/app/apps/web-crawler/run-concert-crawlers.sh"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting crawler execution..."

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    log "ERROR: Container $CONTAINER_NAME is not running!"
    exit 1
fi

# Check if container is healthy
if ! docker ps --filter "name=$CONTAINER_NAME" --filter "status=running" | grep -q "$CONTAINER_NAME"; then
    log "ERROR: Container $CONTAINER_NAME is not in running state!"
    exit 1
fi

log "Container $CONTAINER_NAME is running. Executing crawler..."

# Run the crawler script inside the container
if docker exec "$CONTAINER_NAME" "$SCRIPT_PATH" >> "$LOG_FILE" 2>&1; then
    log "Crawler execution completed successfully"
else
    log "ERROR: Crawler execution failed!"
    exit 1
fi

log "Crawler execution finished"
