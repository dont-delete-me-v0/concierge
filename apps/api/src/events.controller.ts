import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
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

  @Get('search')
  search(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string | string[],
    @Query('venueName') venueName?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('priceFrom') priceFromStr?: string,
    @Query('priceTo') priceToStr?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string
  ) {
    const limit = Math.min(50, Math.max(1, Number(limitStr ?? 10)));
    const offset = Math.max(0, Number(offsetStr ?? 0));
    const priceFrom = priceFromStr ? Number(priceFromStr) : undefined;
    const priceTo = priceToStr ? Number(priceToStr) : undefined;

    // Нормализуем categoryId - может быть строка или массив
    const categoryIds = categoryId
      ? Array.isArray(categoryId)
        ? categoryId
        : [categoryId]
      : undefined;

    console.log('[EventsController] /search received:', {
      q,
      categoryId: categoryIds,
      venueName,
      dateFrom,
      dateTo,
      priceFrom,
      priceTo,
      limit,
      offset,
    });
    const result = this.events.searchPaginated({
      q,
      categoryIds,
      venueName,
      dateFrom,
      dateTo,
      priceFrom,
      priceTo,
      limit,
      offset,
    });
    return result;
  }

  @Get('categories/all')
  listCategories() {
    return this.events.listCategories();
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
