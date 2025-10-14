# Web Crawler в Docker - Итоги

## ✅ Что было добавлено

### 1. Docker контейнер для web-crawler

**`apps/web-crawler/Dockerfile`**

- Multi-stage build для оптимизации размера
- Установка dcron (Alpine cron) и bash
- Копирование конфигураций и скриптов
- Healthcheck для проверки работы cron
- Логирование в `/var/log/crawler/`

### 2. Cron конфигурация

**`apps/web-crawler/crontab.docker`**

- Запуск краулеров каждые 3 часа (0, 3, 6, 9, 12, 15, 18, 21:00)
- Healthcheck каждый час
- Логирование всех операций

### 3. Docker Compose сервис

Обновлен **`docker-compose.yml`**:

```yaml
web-crawler:
  build: apps/web-crawler/Dockerfile
  depends_on:
    - rabbitmq
    - redis
  environment:
    - REDIS_URL=redis://redis:6379
    - RABBITMQ_URL=amqp://admin:admin123@rabbitmq:5672
    - ... (все необходимые переменные)
  volumes:
    - crawler_logs:/var/log/crawler
  healthcheck:
    test: pgrep crond || exit 1
```

### 4. Makefile команды

**Новые команды**:

```bash
make crawler-logs       # Просмотр логов краулера
make crawler-health     # Проверка здоровья
```

### 5. Документация

Обновлены файлы:

- ✅ `README.md` - добавлена информация о web-crawler
- ✅ `DEPLOYMENT.md` - добавлены команды для мониторинга
- ✅ `DOCKER_SETUP.md` - обновлена архитектурная диаграмма
- ✅ `apps/web-crawler/README.md` - полная документация по crawler

## 🚀 Как использовать

### Запуск

```bash
# Собрать и запустить все сервисы (включая crawler)
make docker-build
make docker-up

# Или автоматический деплой
./deploy.sh
```

### Мониторинг

```bash
# Просмотр логов cron
make crawler-logs

# Проверка здоровья
make crawler-health

# Статус контейнера
docker ps | grep web-crawler

# Docker логи
docker logs concierge-web-crawler -f
```

### Управление

```bash
# Перезапуск
docker restart concierge-web-crawler

# Остановка
docker stop concierge-web-crawler

# Просмотр логов внутри контейнера
docker exec concierge-web-crawler ls -la /var/log/crawler/
docker exec concierge-web-crawler cat /var/log/crawler/cron.log
```

## 📊 Архитектура

```
┌───────────────────────────────────────┐
│     Web Crawler Container             │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │        Cron Daemon               │ │
│  │   (каждые 3 часа: */3 * * * *)  │ │
│  └───────────────┬─────────────────┘ │
│                  │                    │
│                  ▼                    │
│  ┌─────────────────────────────────┐ │
│  │  run-concert-crawlers.sh        │ │
│  │  - business                     │ │
│  │  - concerts                     │ │
│  │  - theater                      │ │
│  │  - ... (все категории)          │ │
│  └───────────────┬─────────────────┘ │
│                  │                    │
│                  ▼                    │
│  ┌─────────────────────────────────┐ │
│  │   Playwright Scraper            │ │
│  │   + Stealth mode                │ │
│  │   + Proxy rotation              │ │
│  │   + User-Agent rotation         │ │
│  └───────────────┬─────────────────┘ │
└──────────────────┼───────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
  ┌───────┐  ┌──────────┐  ┌──────┐
  │ Redis │  │ RabbitMQ │  │ Logs │
  │(state)│  │(results) │  │ /var │
  └───────┘  └────┬─────┘  └──────┘
                  │
                  ▼
             ┌─────────┐
             │   API   │
             └─────────┘
```

## ⚙️ Настройка расписания

По умолчанию: каждые 3 часа (0:00, 3:00, 6:00, 9:00, 12:00, 15:00, 18:00, 21:00)

Чтобы изменить, отредактируйте `apps/web-crawler/crontab.docker`:

```bash
# Каждый час
0 * * * * cd /app/apps/web-crawler && ./run-concert-crawlers.sh >> /var/log/crawler/cron.log 2>&1

# Каждые 6 часов
0 */6 * * * cd /app/apps/web-crawler && ./run-concert-crawlers.sh >> /var/log/crawler/cron.log 2>&1

# Только в рабочие дни каждые 3 часа
0 */3 * * 1-5 cd /app/apps/web-crawler && ./run-concert-crawlers.sh >> /var/log/crawler/cron.log 2>&1
```

После изменения пересоберите образ:

```bash
make docker-build
docker restart concierge-web-crawler
```

## 🔍 Отладка

### Проверка работы cron

```bash
# Проверить процесс cron
docker exec concierge-web-crawler ps aux | grep crond

# Проверить crontab
docker exec concierge-web-crawler cat /etc/crontabs/root

# Запустить вручную
docker exec concierge-web-crawler /app/apps/web-crawler/run-concert-crawlers.sh
```

### Проверка логов

```bash
# Основной лог cron
docker exec concierge-web-crawler tail -f /var/log/crawler/cron.log

# Healthcheck лог
docker exec concierge-web-crawler tail -f /var/log/crawler/health.log

# Логи отдельных категорий
docker exec concierge-web-crawler ls /var/log/crawler/
docker exec concierge-web-crawler cat /var/log/crawler/concerts.log
```

### Проверка подключений

```bash
# Redis
docker exec concierge-web-crawler nc -zv redis 6379

# RabbitMQ
docker exec concierge-web-crawler nc -zv rabbitmq 5672

# Проверка ключей в Redis
docker exec concierge-redis redis-cli KEYS "concert.ua:*"
```

## 📈 Мониторинг производительности

### Время выполнения

```bash
# Последние запуски
docker exec concierge-web-crawler grep "Starting concert.ua crawlers" /var/log/crawler/cron.log | tail -10
docker exec concierge-web-crawler grep "completed successfully" /var/log/crawler/cron.log | tail -10
```

### Количество обработанных элементов

```bash
# Количество ключей в Redis
docker exec concierge-redis redis-cli DBSIZE

# События в очереди RabbitMQ
curl -u admin:admin123 http://localhost:15672/api/queues/%2F/events
```

### Ресурсы контейнера

```bash
# Использование CPU/RAM
docker stats concierge-web-crawler

# Размер логов
docker exec concierge-web-crawler du -sh /var/log/crawler/
```

## 🎯 Преимущества Docker решения

### До (системный cron)

- ❌ Нужно настраивать cron на каждом сервере
- ❌ Зависимость от системного окружения
- ❌ Сложность с портабельностью
- ❌ Ручная настройка путей и переменных

### После (Docker + cron)

- ✅ Полная контейнеризация
- ✅ Работает идентично на любом сервере
- ✅ Все в одном `docker-compose up`
- ✅ Изолированная среда
- ✅ Легкое масштабирование
- ✅ Централизованное логирование
- ✅ Healthchecks из коробки

## 🔄 Сравнение с предыдущим подходом

| Аспект                   | Системный cron             | Docker + cron            |
| ------------------------ | -------------------------- | ------------------------ |
| **Установка**            | Настройка вручную          | `docker-compose up`      |
| **Переменные окружения** | Экспорт в crontab          | Docker environment       |
| **Логи**                 | Разные файлы               | Централизованно в volume |
| **Мониторинг**           | `tail -f ~/.crawler-logs/` | `make crawler-logs`      |
| **Healthcheck**          | Нет                        | Встроенный               |
| **Портабельность**       | Низкая                     | Высокая                  |
| **Обновление**           | `git pull` + перезапуск    | `make docker-build`      |

## 📝 Чек-лист миграции

Если у вас уже был системный cron:

- [ ] Остановите старый cron: `crontab -e` и закомментируйте строки
- [ ] Пересоберите Docker образы: `make docker-build`
- [ ] Запустите новый контейнер: `make docker-up`
- [ ] Проверьте логи: `make crawler-logs`
- [ ] Проверьте healthcheck: `make crawler-health`
- [ ] Дождитесь первого запуска по расписанию
- [ ] Проверьте результаты в RabbitMQ/API

## 🆘 Устранение проблем

### Crawler не запускается

**Проблема**: Контейнер запущен, но краулер не работает

**Решение**:

```bash
# 1. Проверить cron процесс
docker exec concierge-web-crawler ps aux | grep crond

# 2. Проверить логи
make crawler-logs

# 3. Запустить вручную
docker exec concierge-web-crawler /app/apps/web-crawler/run-concert-crawlers.sh

# 4. Перезапустить контейнер
docker restart concierge-web-crawler
```

### Нет результатов

**Проблема**: Crawler работает, но данных в API нет

**Решение**:

```bash
# 1. Проверить RabbitMQ
docker logs rabbitmq | tail -50

# 2. Проверить очередь
curl -u admin:admin123 http://localhost:15672/api/queues

# 3. Проверить API consumer
docker logs concierge-api | grep -i rabbit

# 4. Проверить логи crawler
docker exec concierge-web-crawler cat /var/log/crawler/concerts.log
```

### Lock файл заблокирован

**Проблема**: Crawler пишет "Another instance is already running"

**Решение**:

```bash
# Удалить lock файл
docker exec concierge-web-crawler rm -f /tmp/concert-crawlers.lock

# Или перезапустить контейнер
docker restart concierge-web-crawler
```

## 🎉 Готово!

Web-crawler теперь полностью интегрирован в Docker инфраструктуру. Все работает автоматически по расписанию, с мониторингом и healthchecks.

**Команды для быстрого старта:**

```bash
make docker-build       # Собрать все образы
make docker-up          # Запустить все сервисы
make crawler-logs       # Смотреть логи
make crawler-health     # Проверить здоровье
```
