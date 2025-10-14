# Быстрый деплой на Ubuntu 24

## 1️⃣ Подготовка сервера (5 минут)

```bash
# Обновление и установка Docker
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезайти в систему
exit
```

## 2️⃣ Клонирование проекта (1 минута)

```bash
git clone <your-repo-url> /opt/concierge
cd /opt/concierge
```

## 3️⃣ Настройка окружения (3 минуты)

```bash
# Создать .env
cp env.example .env
nano .env
```

**Обязательно заполните:**

```bash
POSTGRES_PASSWORD=<сильный_пароль>
TELEGRAM_BOT_TOKEN=<токен_от_@BotFather>
TELEGRAM_TRACKER_TOKEN=<токен_трекер_бота>
TELEGRAM_CHAT_ID=<ваш_chat_id>
PGADMIN_DEFAULT_PASSWORD=<сильный_пароль>
```

## 4️⃣ Деплой (5-10 минут)

```bash
# Автоматический деплой
./deploy.sh

# Или вручную
make docker-build
make docker-up
```

## 5️⃣ Проверка (1 минута)

```bash
# Статус
make docker-ps

# Health check
curl http://localhost:3000/health

# Логи
make docker-logs
```

## ✅ Готово!

Сервисы запущены:

- 🌐 API: http://localhost:3000
- 🤖 Bot: Работает с Telegram
- 💾 PostgreSQL: localhost:5432
- 🗄️ Redis: localhost:6379
- 📬 RabbitMQ: http://localhost:15672
- 🔧 PgAdmin: http://localhost:5050

## 📋 Базовые команды

```bash
# Логи
make docker-logs

# Перезапуск
make docker-restart

# Остановка
make docker-down

# Бэкап
make backup

# Обновление
./deploy.sh
```

## 🔒 Безопасность (опционально, 10 минут)

```bash
# Firewall
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# SSL (если есть домен)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## 📚 Дополнительно

- Полная документация: [DEPLOYMENT.md](DEPLOYMENT.md)
- Разработка: [DEVELOPMENT.md](DEVELOPMENT.md)
- Docker: [DOCKER_SETUP.md](DOCKER_SETUP.md)
- Бэкапы: [packages/database/BACKUP_GUIDE.md](packages/database/BACKUP_GUIDE.md)

---

**Время деплоя: ~15-25 минут** ⚡
