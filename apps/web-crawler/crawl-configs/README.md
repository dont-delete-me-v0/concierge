# 🗂️ Crawler Configurations

Эта папка содержит конфигурационные файлы для различных web-crawler'ов.

## 📁 Структура

```
crawl-configs/
├── concert.ua/
│   └── kyiv/
│       ├── business/config.json         # Бізнес події
│       ├── concerts/config.json         # Концерти
│       ├── dance/config.json            # Танці
│       ├── electronic/config.json       # Електронна музика
│       ├── excursions/config.json       # Екскурсії
│       ├── festivals/config.json        # Фестивалі
│       ├── humor/config.json            # Гумор/Stand-up
│       ├── kids/config.json             # Дитячі події
│       ├── new-year/config.json         # Новорічні події
│       ├── other/config.json            # Інше
│       ├── sport/config.json            # Спорт
│       ├── theater/config.json          # Театр
│       └── tvorchii-vechir/config.json  # Творчі вечори
└── README.md                             # Цей файл
```

## 🔧 Формат конфигурации

Каждый конфиг содержит:

- `url` - URL для парсинга
- `source_base_url` - Базовый URL источника
- `category_name` - Название категории
- `state_prefix` - Префикс для Redis state
- `headless` - Режим браузера (true/false)
- `retries` - Количество попыток при ошибке
- `proxyFile` - Путь к файлу с прокси (опционально)
- `proxyRotation` - Стратегия ротации прокси: `random` | `sequential`
- `retryOnStatusCodes` - HTTP коды для retry (по умолчанию: [429, 503, 403])
- `userAgents` - Список User-Agent для ротации
- `userAgentRotation` - Стратегия ротации UA: `random` | `sequential`
- `pagination` - Настройки пагинации
- `selectors` - CSS селекторы для извлечения данных
- `incremental` - Настройки инкрементального парсинга
- `details` - Настройки извлечения детальной информации

## 🚀 Использование

### Запуск отдельного конфига:

```bash
node dist/index.js crawl-configs/concert.ua/kyiv/concerts/config.json
```

### Запуск всех конфигов последовательно:

```bash
./run-concert-crawlers.sh
```

### Запуск всех конфигов из папки:

```bash
node dist/index.js crawl-configs/concert.ua/kyiv/
```

## ➕ Добавление новой категории

1. Создайте папку для категории в `crawl-configs/concert.ua/kyiv/`
2. Создайте `config.json` в новой папке
3. Используйте существующие конфиги как шаблон
4. Обновите поля:
   - `url` - URL категории
   - `category_name` - название категории
   - `state_prefix` - уникальный префикс для Redis
5. Протестируйте конфиг
6. Скрипт `run-concert-crawlers.sh` автоматически подхватит новый конфиг

## 📝 Примеры

### Запуск только концертов:

```bash
node dist/index.js crawl-configs/concert.ua/kyiv/concerts/config.json
```

### Запуск только театра:

```bash
node dist/index.js crawl-configs/concert.ua/kyiv/theater/config.json
```

### Запуск только детских событий:

```bash
node dist/index.js crawl-configs/concert.ua/kyiv/kids/config.json
```

## 📊 Логи

Каждая категория имеет свой лог файл в `~/.crawler-logs/`:

- `business.log` - бізнес події
- `concerts.log` - концерти
- `dance.log` - танці
- `electronic.log` - електронна музика
- ... и т.д.

Общий лог скрипта: `~/.crawler-logs/crawler-runner.log`
