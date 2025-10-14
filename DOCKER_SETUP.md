# Docker Setup - Итоговая документация

## Что было добавлено

### 1. Dockerfiles

#### API (`apps/api/Dockerfile`)

- Multi-stage build для оптимизации размера образа
- Установка зависимостей только для production
- Healthcheck с wget
- Non-root пользователь для безопасности
- Порт: 3000

#### Bot (`apps/bot/Dockerfile`)

- Multi-stage build
- Production dependencies only
- Non-root пользователь
- Порт: 3001

### 2. Docker Compose конфигурации

#### Продакшен (`docker-compose.yml`)

Включает все сервисы:

- ✅ **db** - PostgreSQL с healthcheck
- ✅ **db-backup** - Автоматические бэкапы БД
- ✅ **redis** - Хранилище сессий
- ✅ **rabbitmq** - Очередь сообщений
- ✅ **pgadmin** - Веб-интерфейс для БД
- ✅ **api** - REST API (новый)
- ✅ **bot** - Telegram бот (новый)

#### Разработка (`docker-compose.dev.yml`)

Только инфраструктура для локальной разработки:

- db (PostgreSQL)
- redis
- rabbitmq
- pgadmin

### 3. Скрипты и автоматизация

#### `deploy.sh`

Автоматический скрипт деплоя:

```bash
./deploy.sh              # Полный деплой с бэкапом
./deploy.sh --no-backup  # Без бэкапа
./deploy.sh --build-only # Только сборка
```

Возможности:

- Автоматический бэкап перед обновлением
- Git pull (если в репозитории)
- Сборка образов
- Остановка старых контейнеров
- Запуск новых контейнеров
- Проверка health статуса
- Цветной вывод

### 4. Makefile команды

#### Docker продакшен

```bash
make docker-build    # Собрать образы
make docker-up       # Запустить все сервисы
make docker-down     # Остановить все сервисы
make docker-restart  # Перезапустить сервисы
make docker-logs     # Посмотреть логи
make docker-ps       # Статус контейнеров
```

#### Разработка

```bash
make dev-infra       # Запустить инфраструктуру
make dev-infra-down  # Остановить инфраструктуру
make dev-api         # Запустить API локально
make dev-bot         # Запустить Bot локально
make dev-crawler     # Запустить Crawler локально
```

#### Бэкапы (без изменений)

```bash
make backup          # Создать бэкап
make list-backups    # Список бэкапов
make restore FILE=.. # Восстановить
```

### 5. Конфигурационные файлы

#### `.dockerignore`

Исключает из Docker build:

- node_modules
- dist
- логи
- .env файлы
- бэкапы БД
- git файлы

#### Обновлен `env.example`

Добавлены переменные:

```bash
API_PORT=3000
BOT_PORT=3001
```

### 6. Healthchecks

#### API

- Endpoint: `GET /health`
- Возвращает: `{ status: 'ok', timestamp, uptime }`
- Используется Docker healthcheck

#### База данных

- `pg_isready` каждые 5 секунд

#### Redis

- `redis-cli ping` каждые 10 секунд

#### RabbitMQ

- `rabbitmq-diagnostics ping` каждые 10 секунд

### 7. Документация

#### `DEPLOYMENT.md`

Полное руководство по деплою на продакшен:

- Подготовка сервера
- Установка Docker
- Настройка переменных окружения
- Запуск сервисов
- Настройка Nginx + SSL
- Мониторинг
- Устранение проблем

#### `DEVELOPMENT.md`

Руководство для разработчиков:

- Локальная разработка
- Структура проекта
- Разработка отдельных сервисов
- Работа с БД
- Тестирование
- Отладка

#### `README.md`

Обновленный главный README с:

- Быстрым стартом
- Архитектурой
- Командами
- API документацией

## Быстрый старт

### Продакшен

```bash
# 1. Клонировать и настроить
git clone <repo> concierge
cd concierge
cp env.example .env
nano .env  # Настроить переменные

# 2. Деплой одной командой
./deploy.sh

# 3. Проверить
curl http://localhost:3000/health
```

### Разработка

```bash
# 1. Установить зависимости
npm install

# 2. Запустить инфраструктуру
make dev-infra

# 3. Запустить приложения (в отдельных терминалах)
make dev-api
make dev-bot
make dev-crawler
```

## Архитектура

```
┌─────────────────────────────────────────────────┐
│                  Docker Network                  │
│                                                  │
│  ┌──────────┐     ┌──────────┐                 │
│  │   API    │────▶│PostgreSQL│◀────┐           │
│  │  :3000   │     │  :5432   │     │           │
│  └─────┬────┘     └──────────┘     │           │
│        │                            │           │
│        │          ┌──────────┐     │           │
│        └─────────▶│  Redis   │◀────┼──┐        │
│        │          │  :6379   │     │  │        │
│        │          └──────────┘     │  │        │
│        │                            │  │        │
│        │          ┌──────────┐     │  │        │
│        └─────────▶│ RabbitMQ │◀────┼──┼──┐     │
│                   │ :5672    │     │  │  │     │
│                   └──────────┘     │  │  │     │
│                                    │  │  │     │
│  ┌──────────┐                     │  │  │     │
│  │   Bot    │─────────────────────┘  │  │     │
│  │  :3001   │                        │  │     │
│  └──────────┘                        │  │     │
│                                       │  │     │
│  ┌──────────────┐                    │  │     │
│  │ Web Crawler  │────────────────────┘  │     │
│  │    (cron)    │───────────────────────┘     │
│  └──────────────┘                             │
│                                                │
│  ┌───────────┐    ┌───────────┐              │
│  │ DB Backup │────│  PgAdmin  │              │
│  │           │    │   :5050   │              │
│  └───────────┘    └───────────┘              │
└─────────────────────────────────────────────────┘
```

## Переменные окружения

### Обязательные для продакшена

```bash
# Database
POSTGRES_USER=concierge_user
POSTGRES_PASSWORD=<strong_random_password>
POSTGRES_DB=concierge

# Telegram
TELEGRAM_BOT_TOKEN=<from_@BotFather>
TELEGRAM_TRACKER_TOKEN=<from_@BotFather>
TELEGRAM_CHAT_ID=<your_chat_id>
```

### Опциональные (имеют defaults)

```bash
# Ports
API_PORT=3000
BOT_PORT=3001
POSTGRES_PORT=5432
PGADMIN_PORT=5050

# Backups
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@rabbitmq:5672
RABBITMQ_QUEUE=events
```

## Мониторинг

### Проверка здоровья

```bash
# Все контейнеры
docker-compose ps

# API Health
curl http://localhost:3000/health

# PostgreSQL
docker exec concierge-postgres pg_isready

# Redis
docker exec concierge-redis redis-cli ping
```

### Логи

```bash
# Все сервисы
make docker-logs

# Конкретный сервис
docker-compose logs -f api
docker-compose logs -f bot
docker-compose logs -f db
```

### Ресурсы

```bash
# Использование CPU/RAM
docker stats

# Дисковое пространство
docker system df
```

## Обновление

```bash
# Автоматическое обновление
./deploy.sh

# Или вручную
git pull
make docker-build
make docker-down
make docker-up
```

## Бэкапы

Автоматические бэкапы настроены по умолчанию:

- **Расписание**: каждый день в 2:00 AM
- **Ретеншн**: 30 дней
- **Локация**: `packages/database/backups/`

```bash
# Создать бэкап вручную
make backup

# Список бэкапов
make list-backups

# Восстановить
make restore FILE=packages/database/backups/backup_20241014_020000.sql.gz
```

## Безопасность

### Чек-лист

- [ ] Изменены все пароли по умолчанию в `.env`
- [ ] Настроен firewall (ufw)
- [ ] Установлен SSL (certbot)
- [ ] Настроены автоматические бэкапы
- [ ] Бэкапы копируются в облако (S3/GCS)
- [ ] Мониторинг настроен
- [ ] Логирование настроено

### Рекомендации

1. **Сильные пароли**: используйте генератор паролей
2. **SSL/TLS**: обязательно для продакшена
3. **Firewall**: закрыть все порты кроме 22, 80, 443
4. **Бэкапы**: настроить копирование в облако
5. **Обновления**: автоматические обновления безопасности

## Производительность

### Оптимизация Docker образов

```bash
# Проверка размера образов
docker images | grep concierge

# Очистка неиспользуемых образов
docker system prune -a
```

### Масштабирование

```bash
# Запустить несколько экземпляров API
docker-compose up -d --scale api=3

# С балансировщиком нагрузки (Nginx)
# См. DEPLOYMENT.md
```

### Ограничение ресурсов

В `docker-compose.yml`:

```yaml
api:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
```

## Устранение проблем

### Контейнер не запускается

```bash
docker-compose logs <service>
docker-compose restart <service>
```

### Out of memory

```bash
docker stats
docker system prune -a
```

### Database connection error

```bash
docker logs concierge-postgres
docker restart concierge-postgres
```

## Полезные ссылки

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [NestJS](https://nestjs.com/)
- [PostgreSQL](https://www.postgresql.org/)

## Поддержка

При возникновении проблем:

1. Проверьте логи: `make docker-logs`
2. Проверьте статус: `make docker-ps`
3. Посмотрите документацию: `DEPLOYMENT.md`, `DEVELOPMENT.md`
4. Создайте issue в репозитории
