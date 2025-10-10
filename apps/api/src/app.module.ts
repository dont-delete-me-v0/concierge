import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
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
    DatabaseService,
    EventsService,
    RabbitConsumer,
    TelegramService,
  ],
})
export class AppModule {}
