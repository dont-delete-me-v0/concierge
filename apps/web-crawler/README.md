# Web Crawler

Автоматический парсер сайтов с событиями.

## Особенности

- 🕐 **Запуск по расписанию**: каждые 3 часа через cron
- 🔄 **Инкрементальный парсинг**: отслеживает изменения через Redis
- 🎭 **Stealth режим**: использует playwright-extra для обхода защиты
- 🔄 **Rotation**: автоматическая смена User-Agent и прокси
- 📬 **RabbitMQ**: публикация результатов в очередь
- 📊 **Детальный парсинг**: поддержка извлечения деталей со страниц событий

## Docker контейнер

В продакшене web-crawler работает в Docker контейнере с встроенным cron.

### Расписание

По умолчанию запускается каждые 3 часа (настраивается в `crontab.docker`):

- 00:00
- 03:00
- 06:00
- 09:00
- 12:00
- 15:00
- 18:00
- 21:00

### Команды

```bash
# Просмотр логов
make crawler-logs

# Проверка здоровья
make crawler-health

# Логи Docker контейнера
docker logs concierge-web-crawler -f
```

## Конфигурация

### Переменные окружения

```bash
# Redis для инкрементального парсинга
REDIS_URL=redis://redis:6379
STATE_PREFIX=concert.ua

# RabbitMQ для публикации результатов
RABBITMQ_URL=amqp://admin:admin123@rabbitmq:5672
RABBITMQ_QUEUE=events

# Опции публикации
PUBLISHER_BATCH_SIZE=50
PUBLISHER_BATCH_INTERVAL_MS=200
PUBLISHER_MAX_RETRIES=3

# Сохранять ли результаты в JSON файлы
CRAWLER_SAVE_OUTPUT=false

# Telegram уведомления (опционально)
TELEGRAM_TRACKING=false
TELEGRAM_TRACKER_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat_id>

# API для трекинга
API_BASE_URL=http://api:3000
SOURCE_BASE_URL=https://concert.ua
```

### Конфигурационные файлы

Конфигурации парсеров находятся в `crawl-configs/`:

```
crawl-configs/
└── concert.ua/
    └── kyiv/
        ├── business/
        │   └── config.json
        ├── concerts/
        │   └── config.json
        ├── theater/
        │   └── config.json
        └── ... (другие категории)
```

### Пример конфигурации

```json
{
  "id": "concerts",
  "url": "https://concert.ua/uk/kyiv/category/concerts/",
  "category_name": "Концерти",
  "waitFor": ".event-card",
  "selectors": [
    {
      "name": "title",
      "selector": ".event-title",
      "type": "text"
    },
    {
      "name": "date",
      "selector": ".event-date",
      "type": "text"
    }
  ],
  "incremental": {
    "enabled": true,
    "uniqueKey": ["title", "date"],
    "trackChanges": true,
    "updateExisting": true
  }
}
```

## Локальная разработка

### Без Docker

```bash
# Установить зависимости
npm install

# Запустить один раз
npm run dev

# Запустить конкретную конфигурацию
node dist/index.js crawl-configs/concert.ua/kyiv/concerts/config.json
```

### С Docker (только инфраструктура)

```bash
# Запустить Redis и RabbitMQ
make dev-infra

# Запустить crawler локально
make dev-crawler
```

## Скрипты

### `run-concert-crawlers.sh`

Оркестрирует запуск всех краулеров concert.ua последовательно:

- Предотвращает параллельные запуски через lock-файл
- Запускает все конфигурации из `crawl-configs/concert.ua/kyiv/`
- Логирует результаты каждого краулера
- Добавляет задержку между запусками для избежания rate limiting

### `crontab.docker`

Настройка cron для Docker контейнера:

- Запуск `run-concert-crawlers.sh` каждые 3 часа
- Healthcheck каждый час

## Мониторинг

### Логи

```bash
# Основной лог cron
make crawler-logs

# Healthcheck лог
make crawler-health

# Docker логи
docker logs concierge-web-crawler

# Логи внутри контейнера
docker exec concierge-web-crawler ls -la /var/log/crawler/
docker exec concierge-web-crawler cat /var/log/crawler/cron.log
docker exec concierge-web-crawler cat /var/log/crawler/concerts.log
```

### Healthcheck

Контейнер имеет встроенный healthcheck, который проверяет работу cron демона:

```bash
# Проверка статуса
docker ps | grep web-crawler

# Детали healthcheck
docker inspect concierge-web-crawler | grep -A 10 Health
```

## Архитектура

```
┌─────────────────────┐
│   Web Crawler       │
│     (Docker)        │
│                     │
│  ┌──────────────┐   │
│  │ Cron Daemon  │   │
│  │  (каждые 3ч) │   │
│  └──────┬───────┘   │
│         │           │
│         v           │
│  ┌──────────────┐   │
│  │run-concert-  │   │
│  │ crawlers.sh  │   │
│  └──────┬───────┘   │
│         │           │
│         v           │
│  ┌──────────────┐   │
│  │  Playwright  │   │
│  │   Scraper    │   │
│  └──────┬───────┘   │
└─────────┼───────────┘
          │
          ├──────────▶ Redis (состояние)
          │
          └──────────▶ RabbitMQ (результаты)
                              │
                              v
                         ┌─────────┐
                         │   API   │
                         └─────────┘
```

## Инкрементальный парсинг

Crawler использует Redis для отслеживания уже обработанных элементов:

1. **Первый запуск**: парсит все элементы, сохраняет хеши в Redis
2. **Последующие запуски**:
   - Парсит все элементы
   - Проверяет хеши в Redis
   - Публикует только новые/измененные элементы
3. **Отслеживание изменений**: опционально может обнаруживать изменения в существующих элементах

### Ключи Redis

```
concert.ua:concerts:seen:<hash>  # Флаг "видели ранее"
concert.ua:concerts:meta:<hash>  # Метаданные элемента
```

## Устранение проблем

### Crawler не запускается

```bash
# Проверить логи
make crawler-logs

# Проверить cron
docker exec concierge-web-crawler ps aux | grep cron

# Перезапустить контейнер
docker restart concierge-web-crawler
```

### Нет результатов в RabbitMQ

```bash
# Проверить подключение к RabbitMQ
docker exec concierge-web-crawler wget -q -O- http://rabbitmq:15672/api/overview

# Проверить очередь
curl -u admin:admin123 http://localhost:15672/api/queues
```

### Redis недоступен

```bash
# Проверить подключение
docker exec concierge-web-crawler wget -q -O- redis:6379

# Проверить ключи
docker exec concierge-redis redis-cli KEYS "concert.ua:*"
```

## Производительность

### Оптимизация

- **Concurrency**: настройка `maxConcurrency` для детального парсинга
- **Timeouts**: настройка `timeoutMs` для медленных сайтов
- **Retries**: автоматические повторные попытки при ошибках
- **Batch Publishing**: группировка сообщений для RabbitMQ

### Мониторинг производительности

```bash
# Время выполнения
docker exec concierge-web-crawler cat /var/log/crawler/cron.log | grep "completed"

# Количество обработанных элементов
docker exec concierge-redis redis-cli DBSIZE
```

## Дополнительные возможности

- **Proxy rotation**: автоматическая смена прокси из файла
- **User-Agent rotation**: смена User-Agent для обхода блокировок
- **Stealth mode**: использование playwright-extra для маскировки
- **Details extraction**: извлечение дополнительной информации со страниц событий
- **Transform functions**: нормализация данных (даты, цены, текст)

## См. также

- [CRON_SETUP_GUIDE.md](CRON_SETUP_GUIDE.md) - Настройка cron (для локальной разработки)
- [crawl-configs/README.md](crawl-configs/README.md) - Документация по конфигурациям
- [../../DEPLOYMENT.md](../../DEPLOYMENT.md) - Общее руководство по деплою
