# Руководство по деплою Concierge

## Обзор

Проект полностью контейнеризован и использует Docker Compose для оркестрации всех сервисов.

## Сервисы

- **API** - NestJS REST API (порт 3000)
- **Bot** - Telegram бот (порт 3001)
- **Web Crawler** - парсер сайтов (запуск по cron каждые 3 часа)
- **PostgreSQL** - база данных (порт 5432)
- **Redis** - хранилище сессий и состояния (порт 6379)
- **RabbitMQ** - очередь сообщений (порты 5672, 15672)
- **PgAdmin** - веб-интерфейс для PostgreSQL (порт 5050)
- **DB Backup** - автоматические бэкапы БД

## Требования

- Ubuntu 24.04 LTS (или другая Linux дистрибуция)
- Docker 24.0+
- Docker Compose 2.0+
- 2GB RAM минимум (рекомендуется 4GB+)
- 20GB свободного места на диске

## Быстрый старт

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y curl wget git make

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезайти в систему для применения изменений
exit
```

### 2. Клонирование проекта

```bash
# Клонирование репозитория
git clone <your-repo-url> /opt/concierge
cd /opt/concierge

# Создание пользователя для приложения (опционально)
sudo useradd -r -s /bin/false concierge
sudo chown -R concierge:concierge /opt/concierge
```

### 3. Настройка переменных окружения

```bash
# Копирование примера
cp env.example .env

# Редактирование
nano .env
```

**Обязательные переменные для продакшена:**

```bash
# Database (обязательно сменить пароль!)
POSTGRES_USER=concierge_user
POSTGRES_PASSWORD=<strong_random_password>
POSTGRES_DB=concierge
POSTGRES_PORT=5432

# Telegram (обязательно!)
TELEGRAM_BOT_TOKEN=<your_bot_token_from_@BotFather>
TELEGRAM_TRACKER_TOKEN=<your_tracker_bot_token>
TELEGRAM_CHAT_ID=<your_telegram_chat_id>

# Backups
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30

# Ports (можно оставить по умолчанию)
API_PORT=3000
BOT_PORT=3001
PGADMIN_PORT=5050

# PgAdmin (сменить пароль!)
PGADMIN_DEFAULT_EMAIL=admin@yourdomain.com
PGADMIN_DEFAULT_PASSWORD=<strong_password>
```

### 4. Сборка и запуск

```bash
# Сборка Docker образов
make docker-build

# Запуск всех сервисов
make docker-up

# Проверка статуса
make docker-ps

# Просмотр логов
make docker-logs
```

**Или вручную:**

```bash
# Сборка
docker-compose build

# Запуск
docker-compose up -d

# Статус
docker-compose ps

# Логи
docker-compose logs -f
```

## Команды управления

### Основные команды

| Команда               | Описание                  |
| --------------------- | ------------------------- |
| `make docker-build`   | Собрать Docker образы     |
| `make docker-up`      | Запустить все сервисы     |
| `make docker-down`    | Остановить все сервисы    |
| `make docker-restart` | Перезапустить все сервисы |
| `make docker-logs`    | Посмотреть логи           |
| `make docker-ps`      | Статус контейнеров        |

### Команды для бэкапов

| Команда                 | Описание                    |
| ----------------------- | --------------------------- |
| `make backup`           | Создать бэкап БД            |
| `make list-backups`     | Список всех бэкапов         |
| `make restore FILE=...` | Восстановить из бэкапа      |
| `make db-backup-logs`   | Логи автоматических бэкапов |

## Структура портов

| Сервис              | Порт  | Доступ                 |
| ------------------- | ----- | ---------------------- |
| API                 | 3000  | http://localhost:3000  |
| Bot                 | 3001  | http://localhost:3001  |
| PostgreSQL          | 5432  | localhost:5432         |
| Redis               | 6379  | localhost:6379         |
| RabbitMQ AMQP       | 5672  | localhost:5672         |
| RabbitMQ Management | 15672 | http://localhost:15672 |
| PgAdmin             | 5050  | http://localhost:5050  |

## Настройка Nginx (продакшен)

### Установка Nginx

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

### Конфигурация для API

**`/etc/nginx/sites-available/concierge-api`:**

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Увеличение размера тела запроса
    client_max_body_size 10M;
}
```

### Активация и SSL

```bash
# Активация сайта
sudo ln -s /etc/nginx/sites-available/concierge-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Получение SSL сертификата
sudo certbot --nginx -d api.yourdomain.com
```

## Настройка Firewall

```bash
# Разрешить SSH
sudo ufw allow 22/tcp

# Разрешить HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Включить firewall
sudo ufw enable

# Проверить статус
sudo ufw status
```

## Мониторинг

### Проверка здоровья сервисов

```bash
# API healthcheck
curl http://localhost:3000/health

# PostgreSQL
docker exec concierge-postgres pg_isready -U postgres

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
docker-compose logs -f web-crawler
docker-compose logs -f db

# Логи краулера (cron)
make crawler-logs

# Проверка здоровья краулера
make crawler-health

# С ограничением по времени
docker-compose logs --since 1h api

# Последние 100 строк
docker-compose logs --tail=100 api
```

### Использование ресурсов

```bash
# Статистика контейнеров
docker stats

# Использование дискового пространства
docker system df

# Очистка неиспользуемых ресурсов
docker system prune -a
```

## Обновление проекта

### Обновление кода

```bash
cd /opt/concierge

# Остановить сервисы
make docker-down

# Обновить код
git pull origin main

# Пересобрать образы
make docker-build

# Запустить сервисы
make docker-up

# Проверить логи
make docker-logs
```

### Создание скрипта обновления

**`/opt/concierge/deploy.sh`:**

```bash
#!/bin/bash
set -e

echo "Starting deployment..."

cd /opt/concierge

# Создать бэкап перед обновлением
echo "Creating database backup..."
make backup

# Получить последние изменения
echo "Pulling latest changes..."
git pull origin main

# Остановить сервисы
echo "Stopping services..."
docker-compose down

# Собрать новые образы
echo "Building images..."
docker-compose build --no-cache

# Запустить сервисы
echo "Starting services..."
docker-compose up -d

# Ждать готовности
echo "Waiting for services to be ready..."
sleep 30

# Проверить статус
echo "Checking services status..."
docker-compose ps

echo "Deployment completed!"
```

```bash
chmod +x /opt/concierge/deploy.sh
```

## Резервное копирование

### Автоматические бэкапы

Автоматические бэкапы настроены по расписанию (по умолчанию каждый день в 2:00).

```bash
# Проверить статус бэкапов
make list-backups

# Посмотреть логи
make db-backup-logs
```

### Ручной бэкап

```bash
# Создать бэкап
make backup

# Список бэкапов
make list-backups
```

### Восстановление

```bash
# Список доступных бэкапов
make list-backups

# Восстановить из бэкапа
make restore FILE=packages/database/backups/backup_20241014_020000.sql.gz
```

### Настройка удаленного хранения (рекомендуется)

**Пример синхронизации с S3:**

```bash
# Установка AWS CLI
sudo apt install awscli

# Настройка
aws configure

# Создание скрипта синхронизации
cat > /opt/concierge/backup-to-s3.sh << 'EOF'
#!/bin/bash
aws s3 sync /opt/concierge/packages/database/backups/ \
  s3://your-bucket/concierge-backups/ \
  --exclude "*" \
  --include "*.sql.gz"
EOF

chmod +x /opt/concierge/backup-to-s3.sh

# Добавить в crontab
crontab -e
# 0 3 * * * /opt/concierge/backup-to-s3.sh
```

## Устранение проблем

### Контейнер не запускается

```bash
# Проверить логи
docker-compose logs <service_name>

# Проверить статус
docker-compose ps

# Перезапустить конкретный сервис
docker-compose restart <service_name>
```

### База данных недоступна

```bash
# Проверить статус PostgreSQL
docker exec concierge-postgres pg_isready

# Проверить логи
docker-compose logs db

# Перезапустить БД
docker-compose restart db
```

### Ошибки сборки образов

```bash
# Очистить кэш и пересобрать
docker-compose build --no-cache

# Удалить старые образы
docker system prune -a
```

### Недостаточно памяти

```bash
# Проверить использование
docker stats

# Очистить неиспользуемые ресурсы
docker system prune -a

# Ограничить память для контейнеров (в docker-compose.yml)
# mem_limit: 512m
```

## Безопасность

### Контрольный список безопасности

- [ ] Изменены все пароли по умолчанию
- [ ] Firewall настроен и активен
- [ ] SSL сертификаты установлены
- [ ] Telegram токены защищены
- [ ] Настроены автоматические бэкапы
- [ ] Бэкапы копируются в удаленное хранилище
- [ ] Мониторинг настроен
- [ ] Обновления системы автоматизированы

### Дополнительные меры

```bash
# Автоматические обновления безопасности
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Fail2ban для защиты SSH
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Масштабирование

### Увеличение ресурсов для контейнеров

В `docker-compose.yml`:

```yaml
api:
  # ... существующая конфигурация
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '0.5'
        memory: 512M
```

### Несколько экземпляров API

```bash
# Запустить несколько экземпляров
docker-compose up -d --scale api=3
```

## Полезные ссылки

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [NestJS Documentation](https://nestjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## Поддержка

При возникновении проблем:

1. Проверьте логи: `make docker-logs`
2. Проверьте статус: `make docker-ps`
3. Проверьте healthcheck: `curl http://localhost:3000/health`
4. Создайте issue в репозитории проекта
