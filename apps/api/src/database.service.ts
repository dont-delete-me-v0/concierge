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
        CREATE TABLE IF NOT EXISTS public.events (
          id TEXT PRIMARY KEY,
          title TEXT,
          price TEXT,
          link TEXT,
          "eventId" TEXT,
          "dateTime" TEXT,
          venue TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_eventId ON public.events ("eventId");
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
