import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

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

        CREATE TABLE IF NOT EXISTS public.users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE NOT NULL,
          name TEXT,
          phone TEXT,
          email TEXT,
          subscription_type TEXT DEFAULT 'free' NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS public.favorites (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          UNIQUE(user_id, event_id)
        );

        CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users (telegram_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites (user_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_event_id ON public.favorites (event_id);

        CREATE TABLE IF NOT EXISTS public.user_preferences (
          id SERIAL PRIMARY KEY,
          user_id INTEGER UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          category_ids TEXT[],
          district_ids TEXT[],
          price_min NUMERIC(12,2),
          price_max NUMERIC(12,2),
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences (user_id);

        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON public.user_preferences;
        CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE
        ON public.user_preferences FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `
      )
      .catch(() => {
        // Swallow at startup; subsequent queries will surface errors if any
      });
  }

  onModuleDestroy(): Promise<void> {
    return this.pool ? this.pool.end() : Promise.resolve();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }> {
    return this.pool.query<T>(text, params as any);
  }
}
