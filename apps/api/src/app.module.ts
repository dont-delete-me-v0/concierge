import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RabbitConsumer } from './rabbitmq.consumer';

@Module({
  imports: [],
  controllers: [AppController, EventsController],
  providers: [AppService, DatabaseService, EventsService, RabbitConsumer],
})
export class AppModule {}
