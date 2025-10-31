# Simple working Dockerfile for Bot
FROM node:18-alpine

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies
RUN npm ci

# Generate Prisma client
RUN cd /app && npx prisma generate

# Build database package and Bot
RUN npm run build --workspace=@concierge/database
RUN npm run build --workspace=apps/bot

EXPOSE 3001

CMD ["node", "apps/bot/dist/main.js"]