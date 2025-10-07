import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface EventEntity {
  id: string;
  title?: string;
  price?: string;
  link?: string;
  eventId?: string;
  dateTime?: string;
  venue?: string;
}

@Injectable()
export class EventsService {
  constructor(private readonly db: DatabaseService) {}

  async upsert(e: EventEntity) {
    const sql = `
      INSERT INTO public.events (id, title, price, link, "eventId", "dateTime", venue)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        price = EXCLUDED.price,
        link = EXCLUDED.link,
        "eventId" = EXCLUDED."eventId",
        "dateTime" = EXCLUDED."dateTime",
        venue = EXCLUDED.venue
      RETURNING *
    `;
    const params = [
      e.id,
      e.title ?? null,
      e.price ?? null,
      e.link ?? null,
      e.eventId ?? null,
      e.dateTime ?? null,
      e.venue ?? null,
    ];
    const { rows } = await this.db.query(sql, params);
    return rows[0];
  }

  async findAll() {
    const { rows } = await this.db.query(
      'SELECT * FROM public.events ORDER BY id DESC'
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

  async upsertMany(events: EventEntity[]): Promise<void> {
    if (events.length === 0) return;
    // Build VALUES tuples and parameter array
    const cols = [
      'id',
      'title',
      'price',
      'link',
      'eventId',
      'dateTime',
      'venue',
    ];
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const base = i * cols.length;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
      );
      params.push(
        e.id,
        e.title ?? null,
        e.price ?? null,
        e.link ?? null,
        e.eventId ?? null,
        e.dateTime ?? null,
        e.venue ?? null
      );
    }
    const sql = `
      INSERT INTO public.events (id, title, price, link, "eventId", "dateTime", venue)
      VALUES ${valuesSql.join(',')}
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        price = EXCLUDED.price,
        link = EXCLUDED.link,
        "eventId" = EXCLUDED."eventId",
        "dateTime" = EXCLUDED."dateTime",
        venue = EXCLUDED.venue
    `;
    await this.db.query(sql, params);
  }
}
