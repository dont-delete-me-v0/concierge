import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { BotUpdate } from './bot.update.js';
import { DatabaseService } from './database.service.js';
import { EventsApiService } from './events-api.service.js';
import { RedisSessionStore } from './redis-session.store.js';
import { UserService } from './user.service.js';

// Создаем Redis клиент
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: times => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Логирование подключения к Redis
redis.on('connect', () => {
  console.log('[Redis] Connected to Redis server');
});

redis.on('error', err => {
  console.error('[Redis] Connection error:', err);
});

redis.on('ready', () => {
  console.log('[Redis] Ready to accept commands');
});

// Создаем session store
const sessionStore = new RedisSessionStore(redis, {
  prefix: 'bot:session:',
  ttl: 86400, // 24 часа
});

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      middlewares: [
        session({
          store: sessionStore,
          getSessionKey: ctx => {
            // Используем chat.id и user.id для уникальности сессии
            return ctx.chat && ctx.from
              ? `${ctx.chat.id}:${ctx.from.id}`
              : undefined;
          },
        }),
      ],
    }),
  ],
  providers: [BotUpdate, EventsApiService, DatabaseService, UserService],
})
export class BotModule {}
