# Руководство для разработчиков

## Локальная разработка

### Вариант 1: Полностью в Docker (рекомендуется для быстрого старта)

```bash
# Собрать и запустить все сервисы
make docker-build
make docker-up

# Посмотреть логи
make docker-logs

# Остановить
make docker-down
```

### Вариант 2: Только инфраструктура в Docker (рекомендуется для разработки)

Этот вариант позволяет запускать приложения локально с hot-reload.

```bash
# 1. Запустить инфраструктуру (БД, Redis, RabbitMQ)
make dev-infra

# 2. Установить зависимости (один раз)
npm install

# 3. Запустить приложения в отдельных терминалах

# Терминал 1 - API
make dev-api

# Терминал 2 - Bot
make dev-bot

# Терминал 3 - Web Crawler
make dev-crawler

# Когда закончите
make dev-infra-down
```

## Структура проекта

```
concierge/
├── apps/
│   ├── api/              # REST API (NestJS)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── events.controller.ts
│   │   │   └── ...
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── bot/              # Telegram Bot (NestJS + Telegraf)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── bot.update.ts
│   │   │   └── ...
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web-crawler/      # Web Scraper (Node.js)
│       ├── src/
│       │   ├── index.ts
│       │   ├── scraper.ts
│       │   └── ...
│       └── package.json
│
├── packages/
│   ├── database/         # SQL миграции и бэкапы
│   ├── eslint-config/    # Общие настройки ESLint
│   └── prettier-config/  # Общие настройки Prettier
│
├── docker-compose.yml        # Продакшен конфигурация
├── docker-compose.dev.yml    # Разработка (только инфраструктура)
└── package.json              # Root package (workspaces)
```

## Настройка окружения

### 1. Переменные окружения

Создайте `.env` файл в корне проекта:

```bash
cp env.example .env
```

Минимальные настройки для разработки:

```bash
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=concierge
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
RABBITMQ_QUEUE=events

# Telegram (получите у @BotFather)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_TRACKER_TOKEN=your_tracker_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# API
API_BASE_URL=http://localhost:3000
```

### 2. Установка зависимостей

```bash
# Установить все зависимости для всех workspace
npm install
```

## Разработка отдельных сервисов

### API

```bash
cd apps/api

# Development с hot-reload
npm run start:dev

# Build
npm run build

# Production
npm run start:prod

# Тесты
npm run test
npm run test:watch
npm run test:e2e
```

**Основные файлы:**

- `src/main.ts` - точка входа
- `src/app.module.ts` - главный модуль
- `src/events.controller.ts` - контроллер событий
- `src/events.service.ts` - бизнес-логика событий
- `src/database.service.ts` - работа с PostgreSQL
- `src/rabbitmq.consumer.ts` - консьюмер RabbitMQ

**API Endpoints:**

```
GET    /health                     - Healthcheck
GET    /events                     - Все события
GET    /events/:id                 - Одно событие
GET    /events/search              - Поиск событий
GET    /events/categories/all      - Все категории
POST   /events                     - Создать событие
PUT    /events/:id                 - Обновить событие
DELETE /events/:id                 - Удалить событие
POST   /telegram/track             - Telegram уведомление
```

### Bot

```bash
cd apps/bot

# Development с hot-reload
npm run start:dev

# Build
npm run build

# Production
npm run start:prod

# Запуск дайджеста вручную
npm run digest:dev
```

**Основные файлы:**

- `src/main.ts` - точка входа
- `src/bot.update.ts` - обработчики Telegram команд
- `src/bot.module.ts` - модуль бота
- `src/digest.service.ts` - ежедневные дайджесты
- `src/user.service.ts` - управление пользователями
- `src/keyboards.ts` - клавиатуры бота

**Telegram команды:**

- `/start` - Начать работу с ботом
- `/help` - Помощь
- `/events` - Поиск событий
- `/categories` - Категории событий
- `/settings` - Настройки уведомлений

### Web Crawler

```bash
cd apps/web-crawler

# Development
npm run dev

# Build
npm run build

# Production
npm run start

# Scheduler (для периодического запуска)
npm run scheduler:start
```

**Основные файлы:**

- `src/index.ts` - точка входа
- `src/scraper.ts` - логика парсинга
- `src/extractor.ts` - извлечение данных
- `src/pagination.ts` - пагинация страниц
- `src/rabbitmq.ts` - публикация в RabbitMQ
- `src/redisState.ts` - инкрементальный парсинг
- `crawl-configs/` - конфигурации краулеров

**Конфигурация краулера:**

```json
{
  "id": "example-crawler",
  "url": "https://example.com/events",
  "selectors": {
    "item": ".event-card",
    "title": "h2.title",
    "date": ".event-date"
  }
}
```

## База данных

### Инициализация

SQL скрипты в `packages/database/init/` выполняются автоматически при первом запуске PostgreSQL.

Структура:

- `01_events.sql` - таблица событий
- `02_users.sql` - таблица пользователей
- `03_user_preferences.sql` - настройки пользователей

### Подключение к БД

```bash
# Через psql
psql -h localhost -U postgres -d concierge

# Через PgAdmin
# Откройте http://localhost:5050
# Логин: admin@example.com
# Пароль: admin
```

### Миграции

В данный момент миграции применяются через SQL скрипты в `init/`.

Для добавления новой таблицы:

1. Создайте новый SQL файл в `packages/database/init/`
2. Используйте нумерацию `0X_name.sql`
3. Пересоздайте БД или выполните SQL вручную

## Линтинг и форматирование

```bash
# Форматирование всего кода
npm run format

# Проверка форматирования
npm run format:check

# Линтинг
npm run lint
```

## Тестирование

```bash
# API тесты
npm run test --workspace=apps/api

# Bot тесты
npm run test --workspace=apps/bot

# E2E тесты
npm run test:e2e --workspace=apps/api
```

## Отладка

### VS Code

Создайте `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:debug", "--workspace=apps/api"],
      "console": "integratedTerminal",
      "restart": true,
      "protocol": "inspector"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Bot",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:debug", "--workspace=apps/bot"],
      "console": "integratedTerminal",
      "restart": true,
      "protocol": "inspector"
    }
  ]
}
```

### Логирование

```typescript
// В коде используйте console.log или Logger из NestJS
import { Logger } from '@nestjs/common';

const logger = new Logger('ServiceName');
logger.log('Info message');
logger.error('Error message');
logger.warn('Warning message');
logger.debug('Debug message');
```

## Мониторинг в разработке

### Проверка сервисов

```bash
# API
curl http://localhost:3000/health

# PostgreSQL
docker exec concierge-postgres-dev pg_isready

# Redis
docker exec concierge-redis-dev redis-cli ping

# RabbitMQ Management UI
open http://localhost:15672
# Логин: admin / admin123
```

### Логи Docker контейнеров

```bash
# Все сервисы
docker-compose -f docker-compose.dev.yml logs -f

# Конкретный сервис
docker-compose -f docker-compose.dev.yml logs -f db
docker-compose -f docker-compose.dev.yml logs -f redis
```

## Частые проблемы

### Порт уже занят

```bash
# Найти процесс на порту 3000
lsof -ti:3000

# Убить процесс
kill -9 $(lsof -ti:3000)
```

### База данных не подключается

```bash
# Проверить статус контейнера
docker ps | grep postgres

# Проверить логи
docker logs concierge-postgres-dev

# Перезапустить
docker restart concierge-postgres-dev
```

### Ошибки зависимостей

```bash
# Очистить и переустановить
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules
npm install
```

### Redis Connection Refused

```bash
# Проверить Redis
docker ps | grep redis
docker logs concierge-redis-dev

# Перезапустить
docker restart concierge-redis-dev
```

## Git Workflow

```bash
# Создать ветку для фичи
git checkout -b feature/new-feature

# Коммит изменений
git add .
git commit -m "feat: add new feature"

# Пуш в remote
git push origin feature/new-feature

# Создать Pull Request
```

### Commit сообщения

Используем [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: новая функциональность
fix: исправление бага
docs: изменения в документации
style: форматирование кода
refactor: рефакторинг
test: добавление тестов
chore: обновление зависимостей, конфигурации
```

## Дополнительные ресурсы

- [NestJS Documentation](https://nestjs.com/)
- [Telegraf Documentation](https://telegraf.js.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [RabbitMQ Tutorial](https://www.rabbitmq.com/getstarted.html)
