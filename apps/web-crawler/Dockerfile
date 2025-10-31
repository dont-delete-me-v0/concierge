# Simple working Dockerfile for Web Crawler
FROM node:18-slim

# Install dependencies for Playwright and build tools
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

# Copy everything
COPY . .

# Install all dependencies
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium

# Generate Prisma client
RUN cd /app && npx prisma generate

# Build database package and web-crawler
RUN npm run build --workspace=@concierge/database
RUN npm run build --workspace=apps/web-crawler

WORKDIR /app/apps/web-crawler

CMD ["node", "dist/scheduler.js"]