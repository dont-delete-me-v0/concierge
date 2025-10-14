# Build stage
FROM node:18-slim AS builder
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
FROM node:18-slim

# Install dependencies for Playwright
RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libwayland-client0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils \
  libu2f-udev \
  libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

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

# Install Playwright browsers (with Debian this works reliably)
RUN cd /app && npx playwright install chromium --with-deps

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/node_modules/.bin"

# Keep container running (will be called by system cron)
CMD ["tail", "-f", "/dev/null"]