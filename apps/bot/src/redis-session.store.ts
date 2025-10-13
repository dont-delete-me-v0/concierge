import { Redis } from 'ioredis';

export interface SessionStore<T> {
  get: (name: string) => Promise<T | undefined>;
  set: (name: string, value: T) => Promise<void>;
  delete: (name: string) => Promise<void>;
}

export class RedisSessionStore<T> implements SessionStore<T> {
  private readonly prefix: string;
  private readonly ttl: number; // TTL в секундах

  constructor(
    private readonly client: Redis,
    options: { prefix?: string; ttl?: number } = {}
  ) {
    this.prefix = options.prefix || 'telegraf:session:';
    this.ttl = options.ttl || 86400; // По умолчанию 24 часа
  }

  async get(name: string): Promise<T | undefined> {
    try {
      const key = this.prefix + name;
      const data = await this.client.get(key);

      if (!data) {
        return undefined;
      }

      return JSON.parse(data) as T;
    } catch (error) {
      console.error('[RedisSessionStore] Error getting session:', error);
      return undefined;
    }
  }

  async set(name: string, value: T): Promise<void> {
    try {
      const key = this.prefix + name;
      const data = JSON.stringify(value);

      // Устанавливаем с TTL
      await this.client.setex(key, this.ttl, data);
    } catch (error) {
      console.error('[RedisSessionStore] Error setting session:', error);
    }
  }

  async delete(name: string): Promise<void> {
    try {
      const key = this.prefix + name;
      await this.client.del(key);
    } catch (error) {
      console.error('[RedisSessionStore] Error deleting session:', error);
    }
  }
}
