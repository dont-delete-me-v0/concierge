import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit(): void {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'concierge',
      max: 10,
    });
    // Ensure schema exists when DB volume was already initialized and init scripts didn't run
    void this.pool
      .query(
        `
        CREATE TABLE IF NOT EXISTS public.categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          parent_id TEXT REFERENCES public.categories(id)
        );

        CREATE TABLE IF NOT EXISTS public.venues (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT,
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          phone TEXT,
          website TEXT
        );

        CREATE TABLE IF NOT EXISTS public.events (
          id TEXT PRIMARY KEY,
          title TEXT,
          description TEXT,
          category_id TEXT REFERENCES public.categories(id),
          venue_id TEXT REFERENCES public.venues(id),
          date_time TIMESTAMPTZ,
          date_time_from TIMESTAMPTZ,
          date_time_to TIMESTAMPTZ,
          price_from NUMERIC(12,2),
          source_url TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_category ON public.events (category_id);
        CREATE INDEX IF NOT EXISTS idx_events_venue ON public.events (venue_id);
        CREATE INDEX IF NOT EXISTS idx_events_date_time ON public.events (date_time);
        CREATE INDEX IF NOT EXISTS idx_events_date_time_from ON public.events (date_time_from);
        CREATE INDEX IF NOT EXISTS idx_events_date_time_to ON public.events (date_time_to);
      `
      )
      .catch(() => {
        // Swallow at startup; subsequent queries will surface errors if any
      });
  }

  onModuleDestroy(): Promise<void> {
    return this.pool ? this.pool.end() : Promise.resolve();
  }

  async query<T = unknown>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }> {
    return this.pool.query<T>(text, params as any);
  }
}
