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
    // Deduplicate by id within the batch to avoid ON CONFLICT UPDATE affecting same row twice
    const uniqueById = new Map<string, EventEntity>();
    for (const e of events) {
      if (!e?.id) continue;
      uniqueById.set(e.id, e);
    }
    const uniq = Array.from(uniqueById.values());

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
    for (let i = 0; i < uniq.length; i++) {
      const e = uniq[i];
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
        date_time = COALESCE(EXCLUDED.date_time, EXCLUDED.date_time_from),
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

  async findVenueIdByFuzzy(text: string): Promise<string | null> {
    if (!text || text.trim().length === 0) return null;
    const fromChars = 'АВЕКМНОРСТХУавекмнорстху';
    const toChars = 'ABEKMHOPCTXYabekmhopctxy';
    const sql = `
      WITH q AS (
        SELECT LOWER(translate(regexp_replace($1, '[\\s\\-_,.()]+', ' ', 'g'), '${fromChars}', '${toChars}')) AS qnorm
      )
      SELECT v.id, v.name,
             LENGTH(v.name) AS score
      FROM public.venues v, q
      WHERE
        (
          LOWER(translate(regexp_replace(v.name, '[\\s\\-_,.()]+', ' ', 'g'), '${fromChars}', '${toChars}')) LIKE '%' || q.qnorm || '%'
          OR LOWER(translate(regexp_replace(COALESCE(v.address, ''), '[\\s\\-_,.()]+', ' ', 'g'), '${fromChars}', '${toChars}')) LIKE '%' || q.qnorm || '%'
        )
      ORDER BY score DESC
      LIMIT 1
    `;
    const { rows } = await this.db.query<{ id: string }>(sql, [text]);
    return (rows?.[0]?.id ?? null) as string | null;
  }

  async searchPaginated(input: {
    q?: string;
    categoryIds?: string[];
    venueName?: string;
    dateFrom?: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
    dateTo?: string; // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
    priceFrom?: number;
    priceTo?: number;
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
    if (input.categoryIds && input.categoryIds.length > 0) {
      // Поддержка множественных категорий через ANY
      params.push(input.categoryIds);
      where.push(`category_id = ANY($${params.length})`);
    }
    if (input.venueName && input.venueName.trim().length > 0) {
      // Robust match: case-insensitive, normalize Cyrillic/Latin lookalikes, and ignore punctuation
      const raw = input.venueName.trim();
      params.push(raw);
      const p1 = `$${params.length}`;
      // same param reused
      const fromChars = 'АВЕКМНОРСТХУавекмнорстху';
      const toChars = 'ABEKMHOPCTXYabekmhopctxy';
      const normExpr = (col: string) =>
        `LOWER(translate(regexp_replace(${col}, '[\\s\\-_,.()]+', ' ', 'g'), '${fromChars}', '${toChars}'))`;
      const normParam = `LOWER(translate(regexp_replace(${p1}, '[\\s\\-_,.()]+', ' ', 'g'), '${fromChars}', '${toChars}'))`;
      where.push(
        `(
          ${normExpr('v.name')} ILIKE '%' || ${normParam} || '%' OR
          ${normExpr("COALESCE(v.address, '')")} ILIKE '%' || ${normParam} || '%'
        )`
      );
    }
    if (input.dateFrom) {
      // Check if it's a full datetime or just date
      if (input.dateFrom.includes('T')) {
        // Full datetime: normalize format and compare with timestamp
        let normalizedDate = input.dateFrom;
        // Add seconds if not present (HH:mm -> HH:mm:00)
        if (normalizedDate.match(/T\d{2}:\d{2}$/)) {
          normalizedDate += ':00';
        }
        console.log('[EventsService] Normalized dateFrom:', normalizedDate);
        where.push(
          `COALESCE(date_time_from, date_time) >= $${
            params.push(normalizedDate) && params.length
          }::timestamp`
        );
      } else {
        // Date only: compare by date to avoid timezone mismatches
        where.push(
          `DATE(COALESCE(date_time_from, date_time, date_time_to)) >= $${
            params.push(input.dateFrom) && params.length
          }::date`
        );
      }
    }
    if (input.dateTo) {
      if (input.dateTo.includes('T')) {
        // Full datetime: normalize format and compare with timestamp
        let normalizedDate = input.dateTo;
        // Add seconds if not present (HH:mm -> HH:mm:00)
        if (normalizedDate.match(/T\d{2}:\d{2}$/)) {
          normalizedDate += ':00';
        }
        console.log('[EventsService] Normalized dateTo:', normalizedDate);
        where.push(
          `COALESCE(date_time_from, date_time) < $${
            params.push(normalizedDate) && params.length
          }::timestamp`
        );
      } else {
        // Date only: compare by date to avoid timezone mismatches
        where.push(
          `DATE(COALESCE(date_time_from, date_time, date_time_to)) <= $${
            params.push(input.dateTo) && params.length
          }::date`
        );
      }
    }
    if (input.priceFrom !== undefined) {
      add('price_from >= $X', input.priceFrom);
    }
    if (input.priceTo !== undefined) {
      add('price_from <= $X', input.priceTo);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql =
      'ORDER BY COALESCE(date_time_from, date_time) NULLS LAST, id DESC';

    console.log('[EventsService] whereSql:', whereSql);
    console.log('[EventsService] params:', params);

    // total
    const totalSql = `SELECT COUNT(*)::int AS cnt FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id ${whereSql.replaceAll('category_id', 'e.category_id').replaceAll('COALESCE(date_time_from, date_time)', 'COALESCE(e.date_time_from, e.date_time)')}`;
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
      SELECT e.* FROM public.events e
      LEFT JOIN public.venues v ON v.id = e.venue_id
      ${whereSql.replaceAll('category_id', 'e.category_id').replaceAll('COALESCE(date_time_from, date_time)', 'COALESCE(e.date_time_from, e.date_time)')}
      ${orderSql.replace('COALESCE(date_time_from, date_time)', 'COALESCE(e.date_time_from, e.date_time)')}
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
