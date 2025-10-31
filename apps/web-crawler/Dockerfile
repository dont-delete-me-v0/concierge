# Build stage
FROM node:18-slim AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web-crawler/package*.json ./apps/web-crawler/
COPY packages ./packages/

# Copy Prisma schema (needed for database package)
COPY prisma ./prisma

# Install dependencies
RUN npm ci --workspace=apps/web-crawler

# Generate Prisma client (needed for database package)
RUN npx prisma generate

# Copy source files
COPY apps/web-crawler ./apps/web-crawler
COPY eslint.config.js .prettierrc.js ./

# Build packages/database first (required for web-crawler)
RUN npm run build --workspace=@concierge/database

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
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/node_modules ./node_modules

# Fix @concierge/database resolution (AFTER copying node_modules)
RUN rm -rf /app/node_modules/@concierge/database && \
    mkdir -p /app/node_modules/@concierge && \
    ln -s /app/packages/database /app/node_modules/@concierge/database

# Copy web-crawler specific files
COPY apps/web-crawler/crawl-configs ./apps/web-crawler/crawl-configs

# Install Playwright browsers (with Debian this works reliably)
RUN cd /app && npx playwright install chromium --with-deps

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/node_modules/.bin"

# Set working directory to web-crawler
WORKDIR /app/apps/web-crawler

# Run scheduler on container start
CMD ["node", "dist/scheduler.js"]