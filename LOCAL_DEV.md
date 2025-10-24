# Локальная Разработка

Для разработки рекомендуется запускать только инфраструктуру в Docker, а приложения - локально на хосте.

## Быстрый старт

### 1. Запустить инфраструктуру

```bash
make dev-infra
```

Это запустит в Docker:
- ✅ PostgreSQL (порт 5432)
- ✅ Redis (порт 6379)
- ✅ RabbitMQ (порты 5672, 15672)
- ✅ PgAdmin (порт 5050)

### 2. Запустить приложения локально

В отдельных терминалах:

**Терминал 1 - API:**
```bash
make dev-api
# или
npm run start:dev --workspace=apps/api
```

**Терминал 2 - Bot:**
```bash
make dev-bot
# или
npm run start:dev --workspace=apps/bot
```

**Терминал 3 - Crawler:**

Для запуска одного конфига:
```bash
npm run dev --workspace=apps/web-crawler crawl-configs/concert.ua/kyiv/concerts/config.json
```

Для запуска всех конфигов (scheduler):
```bash
npm run scheduler --workspace=apps/web-crawler
```

Или используйте make-команду:
```bash
make dev-crawler
```

### 3. Остановить инфраструктуру

```bash
make dev-infra-down
```

## Преимущества

✅ **Быстрый перезапуск** - просто Ctrl+C и снова запустить
✅ **Нет проблем с hot-reload** - изменения применяются мгновенно
✅ **Легкая отладка** - можно использовать debugger
✅ **Простые логи** - выводятся напрямую в терминал
✅ **Нет проблем с Docker сетью** - все работает через localhost

## Переменные окружения

Убедитесь, что `.env` настроен для localhost:

```bash
# Должно быть localhost, а не имена Docker-сервисов
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/concierge"
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
REDIS_URL=redis://localhost:6379
API_BASE_URL=http://localhost:3000
```

## Проверка подключений

```bash
# PostgreSQL
psql postgresql://postgres:postgres@localhost:5432/concierge

# Redis
redis-cli -h localhost -p 6379 ping

# RabbitMQ Management UI
open http://localhost:15672
# Логин: admin, Пароль: admin123

# API Health
curl http://localhost:3000/health

# PgAdmin
open http://localhost:5050
# Email: admin@example.com, Password: admin
```

## Полезные команды

```bash
# Посмотреть логи инфраструктуры
docker-compose -f docker-compose.dev.yml logs -f

# Посмотреть логи конкретного сервиса
docker-compose -f docker-compose.dev.yml logs -f db
docker-compose -f docker-compose.dev.yml logs -f rabbitmq

# Статус контейнеров
docker-compose -f docker-compose.dev.yml ps

# Перезапустить инфраструктуру
make dev-infra-down && make dev-infra
```

## Миграции базы данных

```bash
# Применить миграции
npx prisma migrate dev

# Сгенерировать Prisma Client
npx prisma generate

# Открыть Prisma Studio
npx prisma studio
```

## Отладка

Для отладки в VS Code создайте `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:dev", "--workspace=apps/api"],
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Bot",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:dev", "--workspace=apps/bot"],
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    }
  ]
}
```
