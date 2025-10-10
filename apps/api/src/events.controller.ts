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
  description?: string;
  category_id?: string | null;
  venue_id?: string | null;
  date_time?: string | null; // ISO UTC (legacy)
  date_time_from?: string | null; // ISO UTC
  date_time_to?: string | null; // ISO UTC
  price_from?: number | null;
  source_url?: string | null;
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
    return this.events.upsertEvent(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Omit<EventDto, 'id'>) {
    return this.events.upsertEvent({ id, ...dto });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.events.remove(id);
  }
}
