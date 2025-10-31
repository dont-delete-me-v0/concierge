# Миграция на pnpm

## На локальной машине:

### 1. Установите pnpm глобально:
```bash
npm install -g pnpm
```

### 2. Удалите старые зависимости и файлы:
```bash
rm -rf node_modules
rm -rf apps/*/node_modules
rm -rf packages/*/node_modules
rm package-lock.json
```

### 3. Установите зависимости через pnpm:
```bash
pnpm install
```

### 4. Соберите проект:
```bash
# Сгенерировать Prisma клиент
pnpm --filter @concierge/database exec prisma generate

# Собрать пакеты
pnpm --filter @concierge/database build
pnpm --filter api build
pnpm --filter bot build
pnpm --filter web-crawler build
pnpm --filter instagram-scraper build
```

### 5. Запустите локально для проверки:
```bash
# Запустить инфраструктуру
make dev-infra

# В разных терминалах:
pnpm --filter api start:dev
pnpm --filter bot start:dev
pnpm --filter web-crawler dev
pnpm --filter instagram-scraper dev
```

## На сервере:

### 1. Скопируйте новые файлы на сервер:
```bash
# С локальной машины
scp pnpm-workspace.yaml .npmrc root@servername:/opt/concierge-new/
scp pnpm-lock.yaml root@servername:/opt/concierge-new/
scp apps/api/Dockerfile.pnpm root@servername:/opt/concierge-new/apps/api/Dockerfile
scp apps/bot/Dockerfile.pnpm root@servername:/opt/concierge-new/apps/bot/Dockerfile
scp apps/web-crawler/Dockerfile.pnpm root@servername:/opt/concierge-new/apps/web-crawler/Dockerfile
scp apps/instagram-scraper/Dockerfile.pnpm root@servername:/opt/concierge-new/apps/instagram-scraper/Dockerfile
```

### 2. На сервере остановите и удалите старые контейнеры:
```bash
cd /opt/concierge-new

# Остановить все
docker compose down

# Удалить старые образы
docker rmi concierge-new-api concierge-new-bot concierge-new-web-crawler concierge-new-instagram-scraper

# Очистить кэш Docker
docker system prune -a
```

### 3. Пересоберите с новыми Dockerfile:
```bash
# Собрать все образы заново
docker compose build --no-cache

# Запустить все сервисы
docker compose up -d

# Проверить статус
docker ps

# Проверить логи
docker logs concierge-api
docker logs concierge-bot
docker logs concierge-web-crawler
docker logs concierge-instagram-scraper
```

## Преимущества pnpm:

1. **Правильная работа с workspaces** - нет проблем с разрешением зависимостей
2. **Экономия места** - использует жесткие ссылки вместо копирования
3. **Быстрее установка** - кэширование на уровне пакетов
4. **Строгие зависимости** - не позволяет использовать неявные зависимости
5. **Детерминированность** - всегда одинаковый результат установки

## Важно:

- Файлы Dockerfile.pnpm после проверки можно переименовать в Dockerfile
- В `.npmrc` параметр `shamefully-hoist=true` нужен для совместимости с некоторыми пакетами (Prisma, NestJS)
- После миграции всегда коммитьте `pnpm-lock.yaml` в git

## Команды pnpm для разработки:

```bash
# Добавить зависимость в конкретный пакет
pnpm --filter api add express

# Добавить dev зависимость
pnpm --filter bot add -D @types/node

# Запустить скрипт в пакете
pnpm --filter web-crawler dev

# Запустить скрипт во всех пакетах
pnpm -r build

# Обновить зависимости
pnpm update

# Проверить устаревшие пакеты
pnpm outdated
```