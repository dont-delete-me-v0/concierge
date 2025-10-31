# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace package files
COPY package*.json ./
COPY apps/instagram-scraper/package*.json ./apps/instagram-scraper/
COPY packages/database/package*.json ./packages/database/

# Copy Prisma schema
COPY prisma ./prisma

# Install dependencies
RUN npm ci --workspace=apps/instagram-scraper

# Copy source files
COPY apps/instagram-scraper ./apps/instagram-scraper
COPY packages/database ./packages/database

# Generate Prisma client
RUN npx prisma generate

# Build packages/database first (required for instagram-scraper)
RUN npm run build --workspace=@concierge/database

# Build the application
WORKDIR /app
RUN npm run build --workspace=apps/instagram-scraper

# Production stage
FROM node:22-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy workspace package files
COPY package*.json ./
COPY apps/instagram-scraper/package*.json ./apps/instagram-scraper/
COPY packages/database/package*.json ./packages/database/

# Copy Prisma schema (needed for runtime)
COPY prisma ./prisma

# Copy packages (needed for @concierge/database)
COPY packages/database ./packages/database

# Install production dependencies only
RUN npm ci --workspace=apps/instagram-scraper --production

# Generate Prisma client in production image
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/apps/instagram-scraper/dist ./apps/instagram-scraper/dist

WORKDIR /app/apps/instagram-scraper

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command runs the scheduler
CMD ["node", "dist/scheduler.js"]