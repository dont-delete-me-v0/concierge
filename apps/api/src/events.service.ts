import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '@concierge/database';
import { Prisma } from '@prisma/client';

export interface CategoryEntity {
  id?: string;
  name: string;
  icon?: string | null;
  parent_id?: string | null;
}

export interface VenueEntity {
  id?: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  website?: string | null;
}

export interface EventEntity {
  id: string; // hash from crawler
  title?: string | null;
  description?: string | null;
  category_id?: string | null;
  venue_id?: string | null;
  date_time?: string | null; // ISO UTC (legacy)
  date_time_from?: string | null; // ISO UTC
  date_time_to?: string | null; // ISO UTC
  price_from?: number | null;
  source_url?: string | null;
}

function computeId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCategory(input: CategoryEntity): Promise<string> {
    const id =
      input.id ?? computeId(`cat|${input.name}|${input.parent_id ?? ''}`);

    await this.prisma.category.upsert({
      where: { id },
      create: {
        id,
        name: input.name,
        icon: input.icon ?? null,
        parentId: input.parent_id ?? null,
      },
      update: {
        name: input.name,
        icon: input.icon ?? null,
        parentId: input.parent_id ?? null,
      },
    });

    return id;
  }

  async upsertVenue(input: VenueEntity): Promise<string> {
    const id =
      input.id ?? computeId(`venue|${input.name}|${input.address ?? ''}`);

    await this.prisma.venue.upsert({
      where: { id },
      create: {
        id,
        name: input.name,
        address: input.address ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
      },
      update: {
        name: input.name,
        address: input.address ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
      },
    });

    return id;
  }

  async upsertEvent(e: EventEntity) {
    const dateTime = e.date_time ? new Date(e.date_time) : null;
    const dateTimeFrom = e.date_time_from ? new Date(e.date_time_from) : null;
    const dateTimeTo = e.date_time_to ? new Date(e.date_time_to) : null;

    return this.prisma.event.upsert({
      where: { id: e.id },
      create: {
        id: e.id,
        title: e.title ?? null,
        description: e.description ?? null,
        categoryId: e.category_id ?? null,
        venueId: e.venue_id ?? null,
        dateTime: dateTimeFrom ?? dateTime,
        dateTimeFrom,
        dateTimeTo,
        priceFrom: e.price_from ? new Prisma.Decimal(e.price_from) : null,
        sourceUrl: e.source_url ?? null,
      },
      update: {
        title: e.title ?? null,
        description: e.description ?? null,
        categoryId: e.category_id ?? null,
        venueId: e.venue_id ?? null,
        dateTime: dateTimeFrom ?? dateTime,
        dateTimeFrom,
        dateTimeTo,
        priceFrom: e.price_from ? new Prisma.Decimal(e.price_from) : null,
        sourceUrl: e.source_url ?? null,
      },
    });
  }

  async upsertMany(events: EventEntity[]): Promise<void> {
    if (events.length === 0) return;

    // Deduplicate by id within the batch
    const uniqueById = new Map<string, EventEntity>();
    for (const e of events) {
      if (!e?.id) continue;
      uniqueById.set(e.id, e);
    }
    const uniq = Array.from(uniqueById.values());

    // Use transaction for bulk upsert
    await this.prisma.$transaction(
      uniq.map((e) => {
        const dateTime = e.date_time ? new Date(e.date_time) : null;
        const dateTimeFrom = e.date_time_from ? new Date(e.date_time_from) : null;
        const dateTimeTo = e.date_time_to ? new Date(e.date_time_to) : null;

        return this.prisma.event.upsert({
          where: { id: e.id },
          create: {
            id: e.id,
            title: e.title ?? null,
            description: e.description ?? null,
            categoryId: e.category_id ?? null,
            venueId: e.venue_id ?? null,
            dateTime: dateTimeFrom ?? dateTime,
            dateTimeFrom,
            dateTimeTo,
            priceFrom: e.price_from ? new Prisma.Decimal(e.price_from) : null,
            sourceUrl: e.source_url ?? null,
          },
          update: {
            title: e.title ?? null,
            description: e.description ?? null,
            categoryId: e.category_id ?? null,
            venueId: e.venue_id ?? null,
            dateTime: dateTimeFrom ?? dateTime,
            dateTimeFrom,
            dateTimeTo,
            priceFrom: e.price_from ? new Prisma.Decimal(e.price_from) : null,
            sourceUrl: e.source_url ?? null,
          },
        });
      })
    );
  }

  async findAll() {
    return this.prisma.event.findMany({
      orderBy: [
        { dateTime: { sort: 'asc', nulls: 'last' } },
        { id: 'desc' },
      ],
    });
  }

  async findOne(id: string) {
    return this.prisma.event.findUnique({
      where: { id },
    });
  }

  async remove(id: string) {
    await this.prisma.event.delete({
      where: { id },
    });
    return { id };
  }

  async listCategories(): Promise<CategoryEntity[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      parent_id: c.parentId,
    }));
  }

  async findVenueIdByFuzzy(text: string): Promise<string | null> {
    if (!text || text.trim().length === 0) return null;

    const fromChars = 'АВЕКМНОРСТХУавекмнорстху';
    const toChars = 'ABEKMHOPCTXYabekmhopctxy';

    const sql = Prisma.sql`
      WITH q AS (
        SELECT LOWER(translate(regexp_replace(${text}, '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars})) AS qnorm
      )
      SELECT v.id, v.name,
             LENGTH(v.name) AS score
      FROM venues v, q
      WHERE
        (
          LOWER(translate(regexp_replace(v.name, '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars})) LIKE '%' || q.qnorm || '%'
          OR LOWER(translate(regexp_replace(COALESCE(v.address, ''), '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars})) LIKE '%' || q.qnorm || '%'
        )
      ORDER BY score DESC
      LIMIT 1
    `;

    const result = await this.prisma.$queryRaw<Array<{ id: string }>>(sql);
    return result?.[0]?.id ?? null;
  }

  async searchPaginated(input: {
    q?: string;
    categoryIds?: string[];
    venueName?: string;
    dateFrom?: string;
    dateTo?: string;
    priceFrom?: number;
    priceTo?: number;
    limit: number;
    offset: number;
  }): Promise<{ items: EventEntity[]; total: number }> {
    console.log('[EventsService] searchPaginated input:', input);

    const where: Prisma.EventWhereInput = {};

    // Text search
    if (input.q && input.q.trim().length > 0) {
      const searchText = `%${input.q.trim()}%`;
      where.OR = [
        { title: { contains: input.q.trim(), mode: 'insensitive' } },
        { description: { contains: input.q.trim(), mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (input.categoryIds && input.categoryIds.length > 0) {
      where.categoryId = { in: input.categoryIds };
    }

    // Venue search with fuzzy matching
    if (input.venueName && input.venueName.trim().length > 0) {
      // For complex venue matching, we'll use raw SQL in a subquery
      const fromChars = 'АВЕКМНОРСТХУавекмнорстху';
      const toChars = 'ABEKMHOPCTXYabekmhopctxy';

      const venueIds = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT v.id
        FROM venues v
        WHERE
          LOWER(translate(regexp_replace(v.name, '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars}))
          ILIKE '%' || LOWER(translate(regexp_replace(${input.venueName.trim()}, '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars})) || '%'
          OR LOWER(translate(regexp_replace(COALESCE(v.address, ''), '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars}))
          ILIKE '%' || LOWER(translate(regexp_replace(${input.venueName.trim()}, '[\\s\\-_,.()]+', ' ', 'g'), ${fromChars}, ${toChars})) || '%'
      `;

      if (venueIds.length > 0) {
        where.venueId = { in: venueIds.map(v => v.id) };
      } else {
        // No matching venues, return empty result
        where.venueId = { in: [] };
      }
    }

    // Date filters
    if (input.dateFrom) {
      if (input.dateFrom.includes('T')) {
        let normalizedDate = input.dateFrom;
        if (normalizedDate.match(/T\d{2}:\d{2}$/)) {
          normalizedDate += ':00';
        }
        console.log('[EventsService] Normalized dateFrom:', normalizedDate);
        where.OR = [
          { dateTimeFrom: { gte: new Date(normalizedDate) } },
          { AND: [{ dateTimeFrom: null }, { dateTime: { gte: new Date(normalizedDate) } }] },
        ];
      } else {
        // Date only comparison - using raw SQL for DATE() function
        const dateFromFilter = new Date(input.dateFrom);
        where.OR = [
          { dateTimeFrom: { gte: dateFromFilter } },
          { AND: [{ dateTimeFrom: null }, { dateTime: { gte: dateFromFilter } }] },
        ];
      }
    }

    if (input.dateTo) {
      if (input.dateTo.includes('T')) {
        let normalizedDate = input.dateTo;
        if (normalizedDate.match(/T\d{2}:\d{2}$/)) {
          normalizedDate += ':00';
        }
        console.log('[EventsService] Normalized dateTo:', normalizedDate);
        const existingOr = where.OR || [];
        where.AND = [
          ...(Array.isArray(existingOr) && existingOr.length > 0 ? [{ OR: existingOr }] : []),
          {
            OR: [
              { dateTimeFrom: { lt: new Date(normalizedDate) } },
              { AND: [{ dateTimeFrom: null }, { dateTime: { lt: new Date(normalizedDate) } }] },
            ],
          },
        ];
        delete where.OR;
      } else {
        const dateToFilter = new Date(input.dateTo);
        const existingOr = where.OR || [];
        where.AND = [
          ...(Array.isArray(existingOr) && existingOr.length > 0 ? [{ OR: existingOr }] : []),
          {
            OR: [
              { dateTimeFrom: { lte: dateToFilter } },
              { AND: [{ dateTimeFrom: null }, { dateTime: { lte: dateToFilter } }] },
            ],
          },
        ];
        delete where.OR;
      }
    }

    // Price filters
    if (input.priceFrom !== undefined && input.priceTo !== undefined) {
      where.priceFrom = {
        gte: new Prisma.Decimal(input.priceFrom),
        lte: new Prisma.Decimal(input.priceTo)
      };
    } else if (input.priceFrom !== undefined) {
      where.priceFrom = {
        gte: new Prisma.Decimal(input.priceFrom)
      };
    } else if (input.priceTo !== undefined) {
      where.priceFrom = {
        lte: new Prisma.Decimal(input.priceTo)
      };
    }

    console.log('[EventsService] Prisma where:', JSON.stringify(where, null, 2));

    // Get total count
    const total = await this.prisma.event.count({ where });
    console.log('[EventsService] total:', total);

    // Get items
    const items = await this.prisma.event.findMany({
      where,
      orderBy: [
        { dateTimeFrom: { sort: 'asc', nulls: 'last' } },
        { dateTime: { sort: 'asc', nulls: 'last' } },
        { id: 'desc' },
      ],
      take: input.limit,
      skip: input.offset,
    });

    console.log('[EventsService] returned', items.length, 'items');

    // Convert to EventEntity format
    const eventEntities: EventEntity[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      category_id: item.categoryId,
      venue_id: item.venueId,
      date_time: item.dateTime?.toISOString() ?? null,
      date_time_from: item.dateTimeFrom?.toISOString() ?? null,
      date_time_to: item.dateTimeTo?.toISOString() ?? null,
      price_from: item.priceFrom ? Number(item.priceFrom) : null,
      source_url: item.sourceUrl,
    }));

    return { items: eventEntities, total };
  }
}
