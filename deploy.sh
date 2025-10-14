#!/bin/bash

# Deployment script for Concierge project
# Usage: ./deploy.sh [--no-backup] [--build-only]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
NO_BACKUP=false
BUILD_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-backup)
            NO_BACKUP=true
            shift
            ;;
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Usage: $0 [--no-backup] [--build-only]"
            exit 1
            ;;
    esac
done

log_info "Starting deployment process..."

# Check if .env file exists
if [ ! -f .env ]; then
    log_error ".env file not found!"
    log_info "Copy env.example to .env and configure it:"
    log_info "  cp env.example .env"
    log_info "  nano .env"
    exit 1
fi

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed!"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    log_error "Docker Compose is not installed!"
    exit 1
fi

# Create backup if not skipped
if [ "$NO_BACKUP" = false ]; then
    log_info "Creating database backup before deployment..."
    if docker ps | grep -q concierge-postgres; then
        make backup || log_warn "Backup failed, but continuing with deployment"
    else
        log_warn "PostgreSQL is not running, skipping backup"
    fi
fi

# Pull latest changes if in git repo
if [ -d .git ]; then
    log_info "Pulling latest changes from repository..."
    git pull origin $(git branch --show-current)
fi

# Build Docker images
log_info "Building Docker images..."
docker-compose build --no-cache

if [ "$BUILD_ONLY" = true ]; then
    log_info "Build completed (--build-only flag set)"
    exit 0
fi

# Stop running containers
log_info "Stopping running containers..."
docker-compose down

# Start services
log_info "Starting services..."
docker-compose up -d

# Wait for services to be ready
log_info "Waiting for services to be ready..."
sleep 10

# Check health
log_info "Checking services status..."
docker-compose ps

# Check if API is healthy
log_info "Checking API health..."
MAX_RETRIES=12
RETRY_COUNT=0
until curl -f http://localhost:3000/health &> /dev/null || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
    log_warn "Waiting for API to be ready... ($((RETRY_COUNT+1))/$MAX_RETRIES)"
    sleep 5
    RETRY_COUNT=$((RETRY_COUNT+1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    log_error "API failed to start properly!"
    log_info "Check logs: make docker-logs"
    exit 1
fi

log_info "✓ Deployment completed successfully!"
log_info ""
log_info "Services status:"
docker-compose ps
log_info ""
log_info "To view logs: make docker-logs"
log_info "To check backups: make list-backups"

