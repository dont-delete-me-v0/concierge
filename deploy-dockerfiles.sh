#!/bin/bash

# Deploy Dockerfiles to server
SERVER="root@servername"
REMOTE_PATH="/opt/concierge-new"

echo "📦 Deploying Dockerfiles to server..."

# Copy Dockerfiles
echo "📋 Copying API Dockerfile..."
scp apps/api/Dockerfile $SERVER:$REMOTE_PATH/apps/api/

echo "📋 Copying Bot Dockerfile..."
scp apps/bot/Dockerfile $SERVER:$REMOTE_PATH/apps/bot/

echo "📋 Copying Web Crawler Dockerfile..."
scp apps/web-crawler/Dockerfile $SERVER:$REMOTE_PATH/apps/web-crawler/

echo "📋 Copying Instagram Scraper Dockerfile..."
scp apps/instagram-scraper/Dockerfile $SERVER:$REMOTE_PATH/apps/instagram-scraper/

echo "✅ Dockerfiles deployed successfully!"
echo ""
echo "Now run on server:"
echo "cd $REMOTE_PATH"
echo "docker compose down"
echo "docker compose build --no-cache"
echo "docker compose up -d"