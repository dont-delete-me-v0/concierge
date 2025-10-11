import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { BotUpdate } from './bot.update.js';
import { EventsApiService } from './events-api.service.js';

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      middlewares: [session()],
    }),
  ],
  providers: [BotUpdate, EventsApiService],
})
export class BotModule {}
