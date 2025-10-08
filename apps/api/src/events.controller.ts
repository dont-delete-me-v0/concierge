import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { EventsService } from './events.service.js';

export interface EventDto {
  id: string; // hash
  title?: string;
  price?: string;
  link?: string;
  eventId?: string;
  dateTime?: string;
  venue?: string;
  description?: string;
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  findAll() {
    return this.events.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Post()
  create(@Body() dto: EventDto) {
    return this.events.upsert(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Omit<EventDto, 'id'>) {
    return this.events.upsert({ id, ...dto });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.events.remove(id);
  }
}
