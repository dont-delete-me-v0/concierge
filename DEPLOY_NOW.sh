#!/bin/bash

# Простой деплой на сервер
SERVER="root@YOUR_SERVER_IP"  # Замените на IP вашего сервера
REMOTE="/opt/concierge-new"

echo "📦 Copying Dockerfiles to server..."

# Копируем Dockerfiles
scp apps/api/Dockerfile $SERVER:$REMOTE/apps/api/
scp apps/bot/Dockerfile $SERVER:$REMOTE/apps/bot/
scp apps/web-crawler/Dockerfile $SERVER:$REMOTE/apps/web-crawler/
scp apps/instagram-scraper/Dockerfile $SERVER:$REMOTE/apps/instagram-scraper/

echo "🏗️ Building on server..."

ssh $SERVER << 'ENDSSH'
cd /opt/concierge-new

# Остановить все
docker compose down

# Удалить старые образы
docker rmi -f concierge-new-api concierge-new-bot concierge-new-web-crawler concierge-new-instagram-scraper

# Собрать заново
docker compose build --no-cache

# Запустить
docker compose up -d

# Статус
docker ps

echo "✅ Done! Check logs with:"
echo "docker logs concierge-api"
echo "docker logs concierge-bot"
echo "docker logs concierge-web-crawler"
echo "docker logs concierge-instagram-scraper"
ENDSSH