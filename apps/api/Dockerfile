# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages/

# Install dependencies
RUN npm ci --workspace=apps/api

# Copy source files
COPY apps/api ./apps/api
COPY eslint.config.js .prettierrc.js ./

# Build the application
RUN npm run build --workspace=apps/api

# Production stage
FROM node:18-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages/

# Install only production dependencies
RUN npm ci --workspace=apps/api --omit=dev

# Copy built application from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

USER nestjs

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]

