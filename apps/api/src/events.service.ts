import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { DatabaseService } from './database.service';

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
  constructor(private readonly db: DatabaseService) {}

  async upsertCategory(input: CategoryEntity): Promise<string> {
    const id =
      input.id ?? computeId(`cat|${input.name}|${input.parent_id ?? ''}`);
    await this.db.query(
      `
      INSERT INTO public.categories (id, name, icon, parent_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        icon = EXCLUDED.icon,
        parent_id = EXCLUDED.parent_id
    `,
      [id, input.name, input.icon ?? null, input.parent_id ?? null]
    );
    return id;
  }

  async upsertVenue(input: VenueEntity): Promise<string> {
    const id =
      input.id ?? computeId(`venue|${input.name}|${input.address ?? ''}`);
    await this.db.query(
      `
      INSERT INTO public.venues (id, name, address, lat, lng, phone, website)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website
    `,
      [
        id,
        input.name,
        input.address ?? null,
        input.lat ?? null,
        input.lng ?? null,
        input.phone ?? null,
        input.website ?? null,
      ]
    );
    return id;
  }

  async upsertEvent(e: EventEntity) {
    const sql = `
      INSERT INTO public.events (id, title, description, category_id, venue_id, date_time, date_time_from, date_time_to, price_from, source_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category_id = EXCLUDED.category_id,
        venue_id = EXCLUDED.venue_id,
        date_time = COALESCE(EXCLUDED.date_time, EXCLUDED.date_time_from),
        date_time_from = EXCLUDED.date_time_from,
        date_time_to = EXCLUDED.date_time_to,
        price_from = EXCLUDED.price_from,
        source_url = EXCLUDED.source_url
      RETURNING *
    `;
    const params = [
      e.id,
      e.title ?? null,
      e.description ?? null,
      e.category_id ?? null,
      e.venue_id ?? null,
      e.date_time ? new Date(e.date_time) : null,
      e.date_time_from ? new Date(e.date_time_from) : null,
      e.date_time_to ? new Date(e.date_time_to) : null,
      e.price_from ?? null,
      e.source_url ?? null,
    ];
    const { rows } = await this.db.query(sql, params);
    return rows[0];
  }

  async upsertMany(events: EventEntity[]): Promise<void> {
    if (events.length === 0) return;
    const cols = [
      'id',
      'title',
      'description',
      'category_id',
      'venue_id',
      'date_time',
      'date_time_from',
      'date_time_to',
      'price_from',
      'source_url',
    ];
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const base = i * cols.length;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
      );
      params.push(
        e.id,
        e.title ?? null,
        e.description ?? null,
        e.category_id ?? null,
        e.venue_id ?? null,
        e.date_time ? new Date(e.date_time) : null,
        e.date_time_from ? new Date(e.date_time_from) : null,
        e.date_time_to ? new Date(e.date_time_to) : null,
        e.price_from ?? null,
        e.source_url ?? null
      );
    }
    const sql = `
      INSERT INTO public.events (id, title, description, category_id, venue_id, date_time, date_time_from, date_time_to, price_from, source_url)
      VALUES ${valuesSql.join(',')}
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category_id = EXCLUDED.category_id,
        venue_id = EXCLUDED.venue_id,
        date_time = EXCLUDED.date_time,
        date_time_from = EXCLUDED.date_time_from,
        date_time_to = EXCLUDED.date_time_to,
        price_from = EXCLUDED.price_from,
        source_url = EXCLUDED.source_url
    `;
    await this.db.query(sql, params);
  }

  async findAll() {
    const { rows } = await this.db.query(
      'SELECT * FROM public.events ORDER BY date_time NULLS LAST, id DESC'
    );
    return rows;
  }

  async findOne(id: string) {
    const { rows } = await this.db.query(
      'SELECT * FROM public.events WHERE id = $1',
      [id]
    );
    return rows[0] ?? null;
  }

  async remove(id: string) {
    await this.db.query('DELETE FROM public.events WHERE id = $1', [id]);
    return { id };
  }

  async listCategories(): Promise<CategoryEntity[]> {
    const { rows } = await this.db.query(
      'SELECT id, name, icon, parent_id FROM public.categories ORDER BY name'
    );
    return rows as CategoryEntity[];
  }

  async searchPaginated(input: {
    q?: string;
    categoryId?: string;
    dateFrom?: string; // ISO YYYY-MM-DD
    dateTo?: string; // ISO YYYY-MM-DD
    limit: number;
    offset: number;
  }): Promise<{ items: EventEntity[]; total: number }> {
    console.log('[EventsService] searchPaginated input:', input);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace('$X', `$${params.length}`));
    };

    if (input.q && input.q.trim().length > 0) {
      const like = `%${input.q.trim()}%`;
      // add two params for title and description separately
      params.push(like);
      const p1 = `$${params.length}`;
      params.push(like);
      const p2 = `$${params.length}`;
      where.push(`(title ILIKE ${p1} OR description ILIKE ${p2})`);
    }
    if (input.categoryId) {
      add('category_id = $X', input.categoryId);
    }
    if (input.dateFrom) {
      // Compare by date-only to avoid timezone mismatches
      where.push(
        `DATE(COALESCE(date_time_from, date_time, date_time_to)) >= $${
          params.push(input.dateFrom) && params.length
        }::date`
      );
    }
    if (input.dateTo) {
      where.push(
        `DATE(COALESCE(date_time_from, date_time, date_time_to)) <= $${
          params.push(input.dateTo) && params.length
        }::date`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql =
      'ORDER BY COALESCE(date_time_from, date_time) NULLS LAST, id DESC';

    console.log('[EventsService] whereSql:', whereSql);
    console.log('[EventsService] params:', params);

    // total
    const totalSql = `SELECT COUNT(*)::int AS cnt FROM public.events ${whereSql}`;
    console.log('[EventsService] totalSql:', totalSql);
    const totalRes = await this.db.query(totalSql, params);
    const totalRow = (totalRes.rows?.[0] ?? { cnt: 0 }) as { cnt: number };
    const total = Number(totalRow.cnt ?? 0);
    console.log('[EventsService] total:', total);

    // items
    const itemsParams = params.slice();
    itemsParams.push(input.limit);
    itemsParams.push(input.offset);
    const itemsSql = `
      SELECT * FROM public.events
      ${whereSql}
      ${orderSql}
      LIMIT $${itemsParams.length - 1}
      OFFSET $${itemsParams.length}
    `;
    console.log('[EventsService] itemsSql:', itemsSql);
    console.log('[EventsService] itemsParams:', itemsParams);
    const itemsRes = await this.db.query(itemsSql, itemsParams);
    console.log('[EventsService] returned', itemsRes.rows.length, 'items');
    return { items: itemsRes.rows as EventEntity[], total };
  }
}
