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

# Install bash and Chromium with all required dependencies
RUN apk add --no-cache \
  bash \
  curl \
  chromium \
  nss \
  freetype \
  freetype-dev \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  font-noto-emoji

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

# Give execution rights to the script
RUN chmod +x /app/apps/web-crawler/run-concert-crawlers.sh

# Tell Playwright to use system Chromium instead of downloading its own
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/node_modules/.bin"

# Keep container running (will be called by system cron)
CMD ["tail", "-f", "/dev/null"]