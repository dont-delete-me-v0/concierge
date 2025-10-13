# 🕐 Гайд по настройке Cron для Web Crawler

## 📋 Обзор

Этот гайд поможет настроить автоматический запуск web-crawler для concert.ua каждые 3 часа с использованием cron.

## 🎯 Что делает скрипт

- **Последовательно** запускает два crawler'а:
  1. `config-concert-ua.json` (концерты)
  2. `config-concert-ua-theather.json` (театр)
- **Предотвращает** параллельные запуски через lock-файл
- **Логирует** все действия с timestamp'ами
- **Автоматически очищает** lock-файлы при завершении

## 🚀 Быстрая настройка

### 1. Убедитесь что скрипт исполняемый

```bash
chmod +x /Users/alumetri/code/concierge/apps/web-crawler/run-concert-crawlers.sh
```

### 2. Откройте crontab для редактирования

```bash
crontab -e
```

### 3. Добавьте следующую конфигурацию

```bash
SHELL=/bin/bash
PATH=/Users/alumetri/.nvm/versions/node/v24.4.0/bin:/usr/local/bin:/usr/bin:/bin
NODE_ENV=production

# Запуск crawler'ов каждые 3 часа
0 */3 * * * cd /Users/alumetri/code/concierge/apps/web-crawler && ./run-concert-crawlers.sh >> /Users/alumetri/.crawler-logs/crawler-runner.log 2>&1
```

### 4. Сохраните и выйдите

- **Vim**: `:wq`
- **Nano**: `Ctrl+X` → `Y` → `Enter`

## ⏰ Расписание запусков

Cron будет запускать скрипт в следующие времена:

- **00:00** (полночь)
- **03:00** (3 утра)
- **06:00** (6 утра)
- **09:00** (9 утра)
- **12:00** (полдень)
- **15:00** (3 дня)
- **18:00** (6 вечера)
- **21:00** (9 вечера)

## 📊 Мониторинг и логи

### Структура логов

```
~/.crawler-logs/
├── crawler-runner.log    # Основной лог скрипта
├── concerts.log          # Лог crawler концертов
└── theater.log           # Лог crawler театра
```

### Полезные команды для мониторинга

```bash
# Следить за логами в реальном времени
tail -f ~/.crawler-logs/crawler-runner.log

# Посмотреть последние 50 строк
tail -50 ~/.crawler-logs/crawler-runner.log

# Проверить статус процессов
ps aux | grep -E "(run-concert-crawlers|node dist/index)" | grep -v grep

# Проверить текущий crontab
crontab -l

# Проверить что cron работает
sudo launchctl list | grep cron
```

## 🔧 Устранение проблем

### Проблема: Скрипт не запускается

```bash
# Проверить права на выполнение
ls -la /Users/alumetri/code/concierge/apps/web-crawler/run-concert-crawlers.sh

# Проверить что Node.js доступен
which node

# Проверить что dist/ существует
ls -la /Users/alumetri/code/concierge/apps/web-crawler/dist/
```

### Проблема: Lock-файл заблокирован

```bash
# Удалить lock-файл вручную
rm -f /tmp/concert-crawlers.lock

# Проверить что нет зависших процессов
ps aux | grep -E "(run-concert-crawlers|node dist/index)" | grep -v grep
```

### Проблема: Cron не работает

```bash
# Перезапустить cron
sudo launchctl stop com.apple.cron
sudo launchctl start com.apple.cron

# Проверить логи cron
sudo tail -f /var/log/cron.log
```

## 🧪 Тестирование

### Ручной запуск для тестирования

```bash
cd /Users/alumetri/code/concierge/apps/web-crawler
./run-concert-crawlers.sh
```

### Тест с логированием

```bash
cd /Users/alumetri/code/concierge/apps/web-crawler
./run-concert-crawlers.sh >> ~/.crawler-logs/test-run.log 2>&1 &
```

### Проверка что lock-механизм работает

```bash
# Запустить первый экземпляр
./run-concert-crawlers.sh &

# Попытаться запустить второй (должен завершиться с сообщением о блокировке)
./run-concert-crawlers.sh
```

## 📝 Примеры логов

### Успешный запуск

```
[2025-10-13 22:07:13] Starting concert.ua crawlers...
[2025-10-13 22:07:13] Running concerts crawler...
[2025-10-13 22:08:56] Concerts crawler completed successfully
[2025-10-13 22:09:01] Running theater crawler...
[2025-10-13 22:10:45] Theater crawler completed successfully
[2025-10-13 22:10:45] All crawlers completed successfully!
```

### Блокировка параллельного запуска

```
[2025-10-13 22:07:13] Another instance is already running with PID 12345. Exiting.
```

### Очистка stale lock-файла

```
[2025-10-13 22:07:13] Stale lock file found. Removing...
[2025-10-13 22:07:13] Starting concert.ua crawlers...
```

## ⚙️ Дополнительные настройки

### Изменение частоты запуска

```bash
# Каждый час
0 * * * * cd /Users/alumetri/code/concierge/apps/web-crawler && ./run-concert-crawlers.sh >> /Users/alumetri/.crawler-logs/crawler-runner.log 2>&1

# Каждые 6 часов
0 */6 * * * cd /Users/alumetri/code/concierge/apps/web-crawler && ./run-concert-crawlers.sh >> /Users/alumetri/.crawler-logs/crawler-runner.log 2>&1

# Только в рабочие дни каждые 3 часа
0 */3 * * 1-5 cd /Users/alumetri/code/concierge/apps/web-crawler && ./run-concert-crawlers.sh >> /Users/alumetri/.crawler-logs/crawler-runner.log 2>&1
```

### Добавление уведомлений

```bash
# Отправка email при ошибке
0 */3 * * * cd /Users/alumetri/code/concierge/apps/web-crawler && ./run-concert-crawlers.sh >> /Users/alumetri/.crawler-logs/crawler-runner.log 2>&1 || echo "Crawler failed" | mail -s "Crawler Error" your-email@example.com
```

## 🔍 Отладка cron

### Проверка переменных окружения

```bash
# Добавить в crontab для отладки
* * * * * env > /tmp/cron-env.log
```

### Проверка путей

```bash
# Добавить в crontab для отладки
* * * * * which node >> /tmp/cron-paths.log
```

## 📚 Полезные ссылки

- [Cron Wikipedia](https://en.wikipedia.org/wiki/Cron)
- [Crontab Guru](https://crontab.guru/) - онлайн редактор cron выражений
- [Apple Cron Documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)

## 🆘 Поддержка

При возникновении проблем:

1. Проверьте логи в `~/.crawler-logs/`
2. Убедитесь что все пути корректны
3. Проверьте права на выполнение файлов
4. Убедитесь что Node.js и зависимости установлены

---

**Удачного краулинга! 🕷️**
