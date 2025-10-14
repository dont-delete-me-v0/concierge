# Concierge

Система управления событиями с Telegram ботом, веб-краулером и API.

## 🚀 Быстрый старт (Docker)

### 1. Подготовка

```bash
# Клонировать репозиторий
git clone <repo-url> concierge
cd concierge

# Создать .env файл
cp env.example .env
nano .env  # Настроить переменные окружения
```

### 2. Запуск

```bash
# Собрать и запустить все сервисы
make docker-build
make docker-up

# Или автоматический деплой
./deploy.sh
```

### 3. Проверка

```bash
# Статус сервисов
make docker-ps

# Логи
make docker-logs

# Health check
curl http://localhost:3000/health
```

## 📦 Архитектура

### Сервисы

- **API** (NestJS) - REST API для управления событиями (порт 3000)
- **Bot** (NestJS + Telegraf) - Telegram бот для пользователей (порт 3001)
- **Web Crawler** (Node.js + Cron) - Парсер сайтов с событиями (запуск каждые 3 часа)
- **PostgreSQL** - Основная база данных (порт 5432)
- **Redis** - Хранилище сессий и состояния краулера (порт 6379)
- **RabbitMQ** - Очередь сообщений (порты 5672, 15672)
- **PgAdmin** - Веб-интерфейс для БД (порт 5050)
- **DB Backup** - Автоматические бэкапы БД

### Структура проекта

```
concierge/
├── apps/
│   ├── api/              # NestJS API
│   ├── bot/              # Telegram бот
│   ├── web-crawler/      # Веб-краулер
│   └── instagram-crawler/
├── packages/
│   ├── database/         # SQL миграции, бэкапы
│   ├── eslint-config/    # Общая ESLint конфигурация
│   └── prettier-config/  # Общая Prettier конфигурация
├── docker-compose.yml    # Оркестрация сервисов
├── deploy.sh            # Скрипт деплоя
└── Makefile             # Удобные команды
```

## 🔧 Команды

### Docker

| Команда               | Описание               |
| --------------------- | ---------------------- |
| `make docker-build`   | Собрать Docker образы  |
| `make docker-up`      | Запустить все сервисы  |
| `make docker-down`    | Остановить все сервисы |
| `make docker-restart` | Перезапустить сервисы  |
| `make docker-logs`    | Посмотреть логи        |
| `make docker-ps`      | Статус контейнеров     |

### Резервное копирование

| Команда                 | Описание                    |
| ----------------------- | --------------------------- |
| `make backup`           | Создать бэкап БД            |
| `make backup-manual`    | Создать ручной бэкап        |
| `make list-backups`     | Список всех бэкапов         |
| `make restore FILE=...` | Восстановить из бэкапа      |
| `make db-backup-logs`   | Логи автоматических бэкапов |

### Web Crawler

| Команда               | Описание                   |
| --------------------- | -------------------------- |
| `make crawler-logs`   | Логи краулера              |
| `make crawler-health` | Проверка здоровья краулера |

### Деплой

```bash
# Полный деплой с бэкапом
./deploy.sh

# Деплой без бэкапа
./deploy.sh --no-backup

# Только сборка образов
./deploy.sh --build-only
```

## 🔑 Конфигурация

### Обязательные переменные окружения

```bash
# Database
POSTGRES_USER=concierge_user
POSTGRES_PASSWORD=<strong_password>
POSTGRES_DB=concierge

# Telegram
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_TRACKER_TOKEN=<tracker_bot_token>
TELEGRAM_CHAT_ID=<your_chat_id>
```

Полный список переменных см. в [`env.example`](env.example)

## 📚 Документация

### Деплой и эксплуатация

- [QUICK_DEPLOY.md](QUICK_DEPLOY.md) - 🚀 Быстрый деплой за 15 минут
- [DEPLOYMENT.md](DEPLOYMENT.md) - 📖 Полное руководство по деплою
- [DOCKER_SETUP.md](DOCKER_SETUP.md) - 🐳 Docker конфигурация и архитектура

### Разработка

- [DEVELOPMENT.md](DEVELOPMENT.md) - 💻 Руководство для разработчиков

### Резервное копирование

- [packages/database/BACKUP_GUIDE.md](packages/database/BACKUP_GUIDE.md) - 💾 Полное руководство по бэкапам
- [packages/database/QUICK_START.md](packages/database/QUICK_START.md) - ⚡ Быстрый старт бэкапов

## 🌐 API Endpoints

### Health Check

```bash
GET /health
```

### События

```bash
GET /events                    # Все события
GET /events/:id               # Одно событие
GET /events/search?q=...      # Поиск событий
GET /events/categories/all    # Все категории
POST /events                  # Создать событие
PUT /events/:id              # Обновить событие
DELETE /events/:id           # Удалить событие
```

## 🤖 Telegram Bot

Бот предоставляет интерфейс для:

- Поиска событий
- Фильтрации по категориям и датам
- Получения деталей о событиях
- Ежедневного дайджеста новых событий

## 🔄 Веб-краулер

Автоматически парсит сайты с событиями и отправляет данные в API через RabbitMQ.

- **Расписание**: каждые 3 часа (0:00, 3:00, 6:00, 9:00, 12:00, 15:00, 18:00, 21:00)
- **Технологии**: Playwright + Stealth режим
- **Инкрементальный парсинг**: использует Redis для отслеживания изменений
- **Настройки**: `apps/web-crawler/crawl-configs/`

```bash
# Просмотр логов
make crawler-logs

# Проверка здоровья
make crawler-health
```

## 🛠️ Разработка

### Локальная разработка

```bash
# Установка зависимостей
npm install

# Запуск инфраструктуры (БД, Redis, RabbitMQ)
docker-compose up -d db redis rabbitmq

# Запуск API в dev режиме
npm run dev --workspace=apps/api

# Запуск Bot в dev режиме
npm run dev --workspace=apps/bot

# Запуск Crawler в dev режиме
npm run dev --workspace=apps/web-crawler
```

### Сборка

```bash
# Сборка всех приложений
npm run build

# Сборка конкретного приложения
npm run build --workspace=apps/api
```

### Линтинг и форматирование

```bash
# Линтинг
npm run lint

# Форматирование
npm run format

# Проверка форматирования
npm run format:check
```

## 🚨 Мониторинг

### Проверка здоровья

```bash
# API
curl http://localhost:3000/health

# PostgreSQL
docker exec concierge-postgres pg_isready

# Redis
docker exec concierge-redis redis-cli ping

# RabbitMQ
curl http://localhost:15672/api/health/checks/alarms
```

### Логи

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f api
docker-compose logs -f bot

# С фильтром по времени
docker-compose logs --since 1h api
```

### Мониторинг ресурсов

```bash
# Статистика контейнеров
docker stats

# Дисковое пространство
docker system df
```

## 🔒 Безопасность

- ✅ Все пароли по умолчанию должны быть изменены
- ✅ Используйте сильные пароли для продакшена
- ✅ Настройте firewall на сервере
- ✅ Используйте SSL для внешних подключений
- ✅ Регулярно обновляйте зависимости
- ✅ Настройте автоматические бэкапы в облако

## 🐛 Устранение проблем

### Контейнер не запускается

```bash
docker-compose logs <service_name>
docker-compose restart <service_name>
```

### База данных недоступна

```bash
docker-compose logs db
docker-compose restart db
```

### Ошибки сборки

```bash
docker-compose build --no-cache
docker system prune -a
```

## 📄 Лицензия

[Укажите вашу лицензию]

## 👥 Авторы

[Укажите авторов]

## 🤝 Вклад

Приветствуются pull requests. Для серьезных изменений сначала откройте issue для обсуждения.
