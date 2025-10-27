# Instagram Scraper - Quick Start Guide

## 🚀 Fastest Setup (5 minutes)

### Step 1: Choose Your AI Provider

#### Option A: OpenAI (Recommended for production)
```bash
# Copy the OpenAI example config
cp .env.example.openai .env

# Edit .env and add your keys:
# - AI_API_KEY=sk-proj-your_actual_key
# - APIFY_TOKEN=your_actual_apify_token
```

#### Option B: Ollama (Free, runs locally)
```bash
# Install Ollama first
# Mac: brew install ollama
# Linux: curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama and pull model
ollama serve  # In one terminal
ollama pull llama3.2  # In another terminal

# Copy the Ollama example config
cp .env.example.ollama .env

# Edit .env and add your Apify token:
# - APIFY_TOKEN=your_actual_apify_token
```

### Step 2: Install Dependencies
```bash
# From the repository root
npm install
```

### Step 3: Start Infrastructure
```bash
# Start RabbitMQ and other services
make dev-infra
```

### Step 4: Run the Scraper
```bash
# Single run (test mode)
npm run dev --workspace=@concierge/instagram-scraper

# Or with scheduler (runs every 3 hours)
npm run scheduler --workspace=@concierge/instagram-scraper
```

## 📊 What Happens Next?

1. **Fetching**: Scraper connects to Apify and fetches Instagram posts
2. **AI Analysis**: Each post is sent to your chosen AI for analysis
3. **Event Detection**: AI determines if the post is an event announcement
4. **Data Extraction**: AI extracts title, venue, date, price, category
5. **Quality Filter**: Only high-confidence events (>70%) are kept
6. **Publishing**: Events are sent to RabbitMQ for the API to process

## 🔍 Monitoring

Check the console output for:
```
📱 Fetching Instagram posts from Apify...
✅ Fetched 50 Instagram posts
🤖 Processing 50 posts with AI...
🔍 Analyzing post from @concert_ua...
✅ Event extracted: "Victoria NIRO" (confidence: 0.85)
📤 Publishing 12 events to RabbitMQ...
✅ AI-powered Instagram scraper completed successfully
```

If `SAVE_OUTPUT=true`, check the generated files:
- `instagram-posts.json` - Raw Instagram data
- `instagram-posts-events.json` - Extracted events

## 🎯 Customization

### Add More Instagram Accounts
Edit `.env`:
```bash
INSTAGRAM_ACCOUNTS=concert_ua,kyivmusicevents,atlas37,your_new_account
```

### Adjust Quality Threshold
```bash
MIN_AI_CONFIDENCE=0.8  # Stricter (fewer but higher quality events)
MIN_AI_CONFIDENCE=0.5  # Looser (more events, may include false positives)
```

### Change AI Model
```bash
# OpenAI
AI_MODEL=gpt-4o        # Best quality (expensive)
AI_MODEL=gpt-4o-mini   # Good balance (recommended)

# Ollama
AI_MODEL=mixtral       # Better quality (slower)
AI_MODEL=llama3.2      # Faster (default)
```

## 🐳 Docker Mode

For production deployment:
```bash
# Build the Docker image
docker build -t instagram-scraper apps/instagram-scraper/

# Run with Docker Compose
docker-compose up instagram-scraper
```

## ❓ Troubleshooting

### "No events extracted"
- Check AI is working: Look for "🤖 Using AI provider: openai" in logs
- Lower confidence: Set `MIN_AI_CONFIDENCE=0.5`
- Check posts: Some accounts may not have event announcements

### "AI API error"
- Verify API key is correct
- Check API limits/quotas on provider dashboard
- For Ollama: Ensure it's running (`curl http://localhost:11434`)

### "Connection refused"
- RabbitMQ not running: Run `make dev-infra`
- Wrong URL: Check `RABBITMQ_URL` in .env

## 📚 More Information

- [Full README](README.md) - Detailed documentation
- [AI Provider Docs](https://platform.openai.com/docs) - OpenAI API reference
- [Apify Docs](https://docs.apify.com/) - Instagram scraper details