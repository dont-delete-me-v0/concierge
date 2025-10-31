# Simple working Dockerfile for Instagram Scraper
FROM node:22-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies
RUN npm ci

# Generate Prisma client
RUN cd /app && npx prisma generate

# Build database package and instagram-scraper
RUN npm run build --workspace=@concierge/database
RUN npm run build --workspace=apps/instagram-scraper

WORKDIR /app/apps/instagram-scraper

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/scheduler.js"]