# Simple working Dockerfile for API
FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies
RUN npm ci

# Generate Prisma client
RUN cd /app && npx prisma generate

# Build database package and API
RUN npm run build --workspace=@concierge/database
RUN npm run build --workspace=apps/api

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]