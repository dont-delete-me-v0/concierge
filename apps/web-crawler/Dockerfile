# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web-crawler/package*.json ./apps/web-crawler/
COPY packages ./packages/

# Install dependencies
RUN npm ci --workspace=apps/web-crawler

# Copy source files
COPY apps/web-crawler ./apps/web-crawler
COPY eslint.config.js .prettierrc.js ./

# Build the application
RUN npm run build --workspace=apps/web-crawler

# Production stage - используем образ с Playwright
FROM mcr.microsoft.com/playwright:v1.55.1-focal

# Install cron and bash
RUN apt-get update && apt-get install -y cron bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web-crawler/package*.json ./apps/web-crawler/
COPY packages ./packages/

# Copy built application
COPY --from=builder /app/apps/web-crawler/dist ./apps/web-crawler/dist
COPY --from=builder /app/node_modules ./node_modules

# Copy web-crawler specific files
COPY apps/web-crawler/crawl-configs ./apps/web-crawler/crawl-configs
COPY apps/web-crawler/run-concert-crawlers.sh ./apps/web-crawler/run-concert-crawlers.sh
COPY apps/web-crawler/crontab.docker /etc/crontabs/root

# Ensure cron.log exists and is writable
RUN mkdir -p /var/log/crawler && touch /var/log/crawler/cron.log && chmod 644 /var/log/crawler/cron.log

# Give execution rights to the script
RUN chmod +x /apps/web-crawler/run-concert-crawlers.sh

# Set environment variables for cron
ENV NODE_ENV=production
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/node_modules/.bin"

# Run cron daemon
CMD ["crond", "-f", "-l", "2"]