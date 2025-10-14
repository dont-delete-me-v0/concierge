# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/bot/package*.json ./apps/bot/
COPY packages ./packages/

# Install dependencies
RUN npm ci --workspace=apps/bot

# Copy source files
COPY apps/bot ./apps/bot
COPY eslint.config.js .prettierrc.js ./

# Build the application
RUN npm run build --workspace=apps/bot

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/bot/package*.json ./apps/bot/
COPY packages ./packages/

# Install only production dependencies
RUN npm ci --workspace=apps/bot --omit=dev

# Copy built application from builder
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

USER nestjs

EXPOSE 3001

CMD ["node", "apps/bot/dist/main.js"]

