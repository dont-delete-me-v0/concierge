# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/bot/package*.json ./apps/bot/
COPY packages ./packages/

# Copy Prisma schema
COPY prisma ./prisma

# Install dependencies
RUN npm ci --workspace=apps/bot

# Generate Prisma client
RUN npx prisma generate

# Copy source files
COPY apps/bot ./apps/bot
COPY eslint.config.js .prettierrc.js ./

# Build packages/database first (required for bot)
RUN npm run build --workspace=@concierge/database

# Build the application
RUN npm run build --workspace=apps/bot

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/bot/package*.json ./apps/bot/

# Copy Prisma schema
COPY prisma ./prisma

# Copy packages (needed for @concierge/database)
COPY packages/database ./packages/database

# Install only production dependencies
RUN npm ci --workspace=apps/bot --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Create symlink for @concierge/database
RUN mkdir -p /app/node_modules/@concierge && \
    ln -s /app/packages/database /app/node_modules/@concierge/database

# Copy built application from builder
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

# Copy built packages/database from builder
COPY --from=builder /app/packages/database/dist ./packages/database/dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

USER nestjs

EXPOSE 3001

CMD ["node", "apps/bot/dist/main.js"]

