# AI-Powered Instagram Scraper for Concierge

This application uses AI to extract event data from Instagram posts fetched via Apify's Instagram scraper and publishes the extracted events to RabbitMQ for processing by the Concierge API.

## Overview

The Instagram scraper:
1. Fetches posts from specified Instagram accounts, hashtags, or locations using Apify
2. **Uses AI (OpenAI, Claude, or Ollama) to intelligently extract event information**
3. Validates and filters events based on AI confidence scores
4. Publishes high-quality events to RabbitMQ in the same format as the web-crawler
5. Supports scheduled runs via cron expression

## Configuration

### Required: AI Provider Configuration

The scraper **requires AI** to extract event information from Instagram posts. Choose one of the following providers:

#### Option 1: Groq (Recommended - Fast & Free!) ⚡
```bash
AI_PROVIDER=groq
AI_API_KEY=gsk-xxxxx                        # Your Groq API key (free!)
AI_MODEL=llama-3.3-70b-versatile           # REQUIRED for batch processing
MIN_AI_CONFIDENCE=0.7                       # Minimum confidence score (0-1)
```
**IMPORTANT:** Use `llama-3.3-70b-versatile` for batch processing. Other models have lower token limits:
- `llama-3.3-70b-versatile` - ✅ Best for batch (higher TPM limit)
- `qwen/qwen3-32b` - ❌ Too low TPM limit (6000), causes 413 errors
- `llama-3.1-8b-instant` - ❌ Lower quality for event extraction
- `mixtral-8x7b-32768` - ⚠️ May work but not tested with chunking

**Why Groq:**
- ⚡ **Fast inference** - processes 50 posts in ~2.5 minutes with batch chunking
- 🆓 **Free tier** - 30 requests/minute, 12000 TPM limit
- 📦 **Efficient batch processing** - 10 posts per chunk with llama-3.3-70b-versatile
- 🎯 **Excellent quality** - Llama 3.3 70B performance for event extraction
- 💪 **Higher token limit** - llama-3.3-70b has 12000 TPM (vs qwen's 6000 TPM)
- 🔑 **Get API key**: https://console.groq.com/

#### Option 2: OpenAI (Paid, High Quality)
```bash
AI_PROVIDER=openai
AI_API_KEY=sk-proj-xxxxx              # Your OpenAI API key
AI_MODEL=gpt-4o-mini                  # Options: gpt-4o, gpt-4o-mini, gpt-3.5-turbo
MIN_AI_CONFIDENCE=0.7
```

#### Option 3: Claude/Anthropic (Paid, Alternative)
```bash
AI_PROVIDER=claude
AI_API_KEY=sk-ant-xxxxx               # Your Anthropic API key
AI_MODEL=claude-3-haiku-20240307     # Options: claude-3-opus, claude-3-sonnet, claude-3-haiku
MIN_AI_CONFIDENCE=0.7
```

#### Option 4: Ollama (Free, Local)
```bash
AI_PROVIDER=ollama
# No API key needed for local Ollama
AI_MODEL=llama3.2                     # Options: llama3.2, mistral, mixtral
MIN_AI_CONFIDENCE=0.7
# Note: Requires Ollama running locally on http://localhost:11434
```

### Other Required Configuration

```bash
# Apify Configuration
APIFY_TOKEN=your_apify_token_here     # Required: Apify API token
APIFY_ACTOR_ID=shu8hvrXbJbY3Eb9W     # Instagram scraper actor ID

# Instagram Sources (at least one required)
INSTAGRAM_ACCOUNTS=concert_ua,kyivmusicevents,atlas37  # Accounts to scrape

# Hashtags (optional) - scrapes from instagram.com/explore/tags/{hashtag}
# Use without # symbol, just the tag name
# INSTAGRAM_HASHTAGS=kyivconcerts,ukraineevents,концерткиїв

# Location IDs (optional) - Instagram location IDs
# INSTAGRAM_LOCATIONS=183918115737714

# RabbitMQ Configuration
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
RABBITMQ_QUEUE=events
```

### Optional Configuration

```bash
# Results Configuration
RESULTS_LIMIT=200                     # Max posts to fetch per account
SAVE_OUTPUT=false                      # Save raw posts and events to JSON
OUTPUT_FILE=instagram-posts.json      # Output file name

# Scheduler
SCRAPER_CRON=0 */3 * * *              # Cron expression (default: every 3 hours)

# RabbitMQ Batching
PUBLISHER_BATCH_SIZE=50               # Events per batch
PUBLISHER_BATCH_INTERVAL_MS=200       # Batch flush interval

# Telegram Notifications (optional)
TELEGRAM_TRACKER_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## AI-Powered Event Extraction

The scraper uses AI to intelligently analyze Instagram posts and extract structured data for the PostgreSQL database.

### How It Works

1. **Schema-Aware Extraction**: AI understands the exact database schema and extracts data in the correct format
2. **Event Detection**: Distinguishes between event announcements, past event reviews, and general promotional content
3. **Structured Data Extraction**:
   - **Title** (REQUIRED): Event name or artist/performer name
   - **Description**: Clean description without emojis/hashtags
   - **Category**: One of 6 predefined categories (Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап)
   - **Venue**: Venue name only (e.g., "Atlas", not full address)
   - **Date/Time**: Ukrainian format parsed to UTC ISO
   - **Price**: Minimum price as a number in UAH
4. **Confidence Scoring**: Each extraction includes a confidence level (0-1)
5. **Quality Filtering**: Only events above the minimum confidence threshold are published

### Database Schema

AI extracts data according to the PostgreSQL schema:
- See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for complete schema documentation
- Categories: Концерт, Театр, Виставка, Фестиваль, Вечірка, Стендап
- Venues are fuzzy-matched by the API (creates new if not found)
- Dates are parsed from Ukrainian format to UTC ISO strings

### AI Processing Features
- **Schema-aware prompts**: AI knows exact database structure
- **Smart date parsing**: Understands various Ukrainian date formats
- **Context awareness**: Identifies future events vs. past event reviews
- **Clean descriptions**: Removes emojis, hashtags, promotional text
- **Category classification**: Intelligent categorization into 6 types
- **Multi-language support**: Works with Ukrainian, Russian, and English
- **Batch processing**: Processes all posts in one API call (Groq)

## Development

### Install dependencies
```bash
npm install
```

### Build the application
```bash
npm run build --workspace=@concierge/instagram-scraper
```

### Run once (development)
```bash
npm run dev --workspace=@concierge/instagram-scraper
```

### Run scheduler (development)
```bash
npm run scheduler --workspace=@concierge/instagram-scraper
```

## Docker

### Development (with hot-reload)
```bash
# Start all services in development mode
make docker-dev-up

# Or just infrastructure + run locally
make dev-infra
make dev-instagram
```

### Production
```bash
# Build and start all services
make docker-build
make docker-up

# View Instagram scraper logs
make instagram-logs
```

## Usage with Makefile

```bash
# Run Instagram scraper once
make instagram-run

# Start scheduler
make instagram-scheduler

# View logs (Docker)
make instagram-logs

# Build
make instagram-build
```

## Instagram Sources Configuration

### Using Hashtags
The scraper fetches posts from Instagram hashtag pages using `explore/tags/{hashtag}` URLs.

```bash
# Examples of hashtag configuration:
INSTAGRAM_HASHTAGS=kyivconcerts,ukraineevents,концерткиїв

# The scraper converts hashtags to URLs:
# - kyivconcerts → https://www.instagram.com/explore/tags/kyivconcerts
# - ukraineevents → https://www.instagram.com/explore/tags/ukraineevents
# - концерткиїв → https://www.instagram.com/explore/tags/концерткиїв
```

**Tips for hashtags:**
- Don't include the # symbol, just the tag name (e.g., `kyivevents` not `#kyivevents`)
- Use comma-separated list for multiple tags
- Supports both English and Ukrainian hashtags
- Each hashtag will fetch up to RESULTS_LIMIT posts (default: 200)
- Popular Ukrainian event hashtags: `концерткиїв`, `афішакиїв`, `кудапітикиїв`, `kyivevents`

### Using Accounts
```bash
INSTAGRAM_ACCOUNTS=concert_ua,kyivmusicevents,atlas37
```

### Combined Sources
You can use multiple sources simultaneously:
```bash
INSTAGRAM_ACCOUNTS=concert_ua,atlas37
INSTAGRAM_HASHTAGS=kyivconcerts,концерткиїв
# This will make separate requests:
# 1. Fetch posts from accounts (concert_ua, atlas37)
# 2. Fetch posts from hashtags (kyivconcerts, концерткиїв)
# 3. Combine all results for AI processing
```

**Note:** The scraper makes separate API calls to Apify for each source type (accounts, hashtags, locations) to ensure compatibility. All fetched posts are then combined and processed together by AI.

## Data Flow

1. **Apify** → Fetches Instagram posts from configured accounts/hashtags/locations
2. **AI Extractor** → Sends each post to AI for intelligent event extraction
3. **Validation** → Filters events by confidence score and data quality
4. **RabbitMQ Publisher** → Sends validated events to queue
5. **API Consumer** → Processes events and stores in PostgreSQL

## Architecture Notes

This scraper uses a **pure AI approach** for maximum reliability:

### Batch Processing with Chunking (llama-3.3-70b-versatile)
- **Optimized chunking**: Splits posts into chunks of 10 for efficient batch processing
- **Model optimized**: Designed for llama-3.3-70b-versatile (12000 TPM limit)
- **Processing time**: ~2.5 minutes for 50 posts (5 chunks × 30s delay + processing time)
- **Token efficient**: Each chunk ~5256 tokens, 2 chunks per minute = 10512 tokens < 12000 TPM limit
- **Rate limiting**: 30-second delay between chunks to stay under TPM limit
- **Error resilient**: If one chunk fails, continues with next chunk
- **Fallback support**: Falls back to single-post processing if all chunks fail

### AI-First Approach
- **No regex patterns**: All extraction is done by AI understanding context
- **No hybrid mode**: The code only fetches data and sends it to AI as requested
- **AI makes all decisions**: Whether something is an event, what category it belongs to, etc.
- **Confidence-based filtering**: Only high-confidence events are published

### Benefits
- Better understanding of context and nuance
- Ability to handle varied post formats
- Intelligent categorization
- Reduced false positives
- **Much faster with batch mode**

## Event Format

Events are published to RabbitMQ in the following format:
```json
{
  "id": "sha256_hash",
  "title": "Victoria NIRO",
  "description": "Post caption...",
  "category_name": "Концерт",
  "venue_name": "Origin Stage",
  "date_time": "2025-12-10T17:00:00Z",
  "date_time_from": null,
  "date_time_to": null,
  "price_from": 500,
  "source_url": "https://www.instagram.com/p/..."
}
```

## Monitoring

- Telegram notifications are sent on scraper start/completion/failure
- Progress tracking includes number of posts fetched and events extracted
- Health checks monitor the scheduler process

## Troubleshooting

### No events extracted
- **Check AI provider configuration**: Ensure AI_PROVIDER and AI_API_KEY are set correctly
- **Verify AI service is accessible**:
  - OpenAI/Claude: Check API key validity and rate limits
  - Ollama: Ensure it's running locally (`curl http://localhost:11434/api/tags`)
- **Review confidence threshold**: Lower MIN_AI_CONFIDENCE if too many events are filtered
- **Check AI responses**: Enable SAVE_OUTPUT=true to inspect AI extraction results

### Apify Token Errors

**Error**: `User was not found or authentication token is not valid`

**Solution**:
1. Получите токен на [Apify Console](https://console.apify.com/account/integrations)
2. Добавьте в `.env`:
   ```bash
   APIFY_TOKEN=apify_api_ваш_настоящий_токен
   ```
3. Убедитесь, что токен начинается с `apify_api_`

### Claude API Errors

**Error**: `Cannot read properties of undefined (reading '0')`

**Причина**: Неверный API ключ или структура ответа

**Solution**:
1. Проверьте ключ Claude API:
   ```bash
   # Ключ должен начинаться с sk-ant-
   AI_API_KEY=sk-ant-ваш_настоящий_ключ
   ```
2. Получите ключ: https://console.anthropic.com/account/keys
3. Проверьте лимиты API на дашборде Anthropic
4. Убедитесь, что модель доступна: `claude-3-haiku-20240307`

**Альтернатива**: Используйте OpenAI вместо Claude:
```bash
AI_PROVIDER=openai
AI_API_KEY=sk-proj-ваш_openai_ключ
AI_MODEL=gpt-4o-mini
```

### Low extraction quality
- **Try different AI models**:
  - OpenAI: `gpt-4o` for best quality, `gpt-4o-mini` for speed/cost balance
  - Claude: `claude-3-opus` for best quality, `claude-3-haiku` for speed
  - Ollama: `mixtral` or `llama3.2` for better local results
- **Adjust confidence threshold**: Find the right balance for your use case

### AI API errors
- **Rate limiting**: The scraper automatically throttles requests (200ms between posts)
- **API quotas**: Check your API usage limits on provider dashboard
- **Timeout issues**: Some AI providers may be slow; the scraper will retry failed requests

### Apify errors
- Verify APIFY_TOKEN is valid
- Check Apify actor is available and running
- Monitor Apify usage limits

### RabbitMQ connection issues
- Ensure RabbitMQ is running: `docker ps | grep rabbitmq`
- Check connection URL in environment variables
- Verify network connectivity between services