import { createClient, RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function initRedis(): Promise<RedisClientType> {
  if (client) return client;
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = createClient({ url });
  client.on('error', err => console.error('Redis error', err));
  await client.connect();
  return client;
}

export async function wasSeen(prefix: string, hash: string): Promise<boolean> {
  const c = await initRedis();
  const key = `${prefix}:hashes`;
  const res = await c.sIsMember(key, hash);
  return Boolean(res);
}

export async function markSeen(
  prefix: string,
  hashes: string[]
): Promise<void> {
  if (hashes.length === 0) return;
  const c = await initRedis();
  const key = `${prefix}:hashes`;
  await c.sAdd(key, hashes);
}

export async function updateMeta(
  prefix: string,
  totalItems: number
): Promise<void> {
  const c = await initRedis();
  const key = `${prefix}:meta`;
  await c.hSet(key, {
    lastUpdate: new Date().toISOString(),
    totalItems: String(totalItems),
  });
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      // ignore
    } finally {
      client = null;
    }
  }
}
