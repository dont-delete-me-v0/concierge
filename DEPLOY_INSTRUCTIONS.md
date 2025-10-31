# Инструкции по деплою на сервер

## 1. Скопируйте исправленные Dockerfiles на сервер:

### Вариант A: Используйте готовый скрипт
```bash
# Замените servername на ваш реальный сервер
sed -i 's/servername/YOUR_SERVER_IP/g' deploy-dockerfiles.sh
./deploy-dockerfiles.sh
```

### Вариант B: Вручную
```bash
SERVER="root@YOUR_SERVER_IP"
scp apps/api/Dockerfile $SERVER:/opt/concierge-new/apps/api/
scp apps/bot/Dockerfile $SERVER:/opt/concierge-new/apps/bot/
scp apps/web-crawler/Dockerfile $SERVER:/opt/concierge-new/apps/web-crawler/
scp apps/instagram-scraper/Dockerfile $SERVER:/opt/concierge-new/apps/instagram-scraper/
```

## 2. На сервере пересоберите и запустите:

```bash
ssh root@YOUR_SERVER_IP
cd /opt/concierge-new

# Остановить все контейнеры
docker compose down

# Удалить старые образы (опционально, но рекомендуется)
docker rmi concierge-new-api concierge-new-bot concierge-new-web-crawler concierge-new-instagram-scraper

# Пересобрать все образы
docker compose build --no-cache

# Запустить все сервисы
docker compose up -d

# Проверить статус
docker ps

# Проверить логи (должны работать без ошибок)
docker logs concierge-api
docker logs concierge-bot
docker logs concierge-web-crawler
docker logs concierge-instagram-scraper
```

## Что было исправлено:

1. **openssl добавлен в build stages**:
   - web-crawler: `apt-get install -y openssl`
   - instagram-scraper: `apk add --no-cache openssl`

2. **Prisma не будет искать pnpm**:
   - Добавлено `ENV npm_config_user_agent=npm` перед `npx prisma generate`

3. **Симлинки для @concierge/database**:
   - Создаются ПОСЛЕ копирования node_modules
   - Сначала удаляется существующая папка, потом создается симлинк

4. **Копирование packages/database/dist**:
   - Добавлено во все Dockerfiles для правильного разрешения зависимостей

## Результат:

После деплоя все контейнеры должны успешно запуститься:
- ✅ concierge-api (порт 3000)
- ✅ concierge-bot (порт 3001)
- ✅ concierge-web-crawler (scheduler)
- ✅ concierge-instagram-scraper (scheduler)
- ✅ PostgreSQL (порт 5432)
- ✅ Redis (порт 6379)
- ✅ RabbitMQ (порты 5672, 15672)
- ✅ PgAdmin (порт 5050)