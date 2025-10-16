import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from '@concierge/database';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RabbitConsumer } from './rabbitmq.consumer';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [],
  controllers: [AppController, EventsController, TelegramController],
  providers: [
    AppService,
    PrismaService,
    EventsService,
    RabbitConsumer,
    TelegramService,
  ],
})
export class AppModule {}
