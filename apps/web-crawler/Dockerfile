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

# Production stage
FROM node:18-alpine

# Install cron and bash
RUN apk add --no-cache dcron bash curl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web-crawler/package*.json ./apps/web-crawler/
COPY packages ./packages/

# Install only production dependencies
RUN npm ci --workspace=apps/web-crawler --omit=dev

# Copy built application from builder
COPY --from=builder /app/apps/web-crawler/dist ./apps/web-crawler/dist
COPY --from=builder /app/apps/web-crawler/crawl-configs ./apps/web-crawler/crawl-configs
COPY --from=builder /app/apps/web-crawler/run-concert-crawlers.sh ./apps/web-crawler/run-concert-crawlers.sh

# Make script executable
RUN chmod +x ./apps/web-crawler/run-concert-crawlers.sh

# Create log directory
RUN mkdir -p /var/log/crawler

# Copy crontab file
COPY apps/web-crawler/crontab.docker /etc/crontabs/root

# Create non-root user for running crawlers
RUN addgroup -g 1001 -S nodejs && \
  adduser -S crawler -u 1001 -G nodejs && \
  chown -R crawler:nodejs /app /var/log/crawler

# Create startup script
RUN echo '#!/bin/sh' > /start.sh && \
  echo 'echo "Starting cron daemon..."' >> /start.sh && \
  echo 'crond -f -l 2' >> /start.sh && \
  chmod +x /start.sh

# Healthcheck - check if cron is running
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep crond || exit 1

CMD ["/start.sh"]

