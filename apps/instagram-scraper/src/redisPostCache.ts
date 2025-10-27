import { createClient, RedisClientType } from 'redis';
import { InstagramPost } from './types';

/**
 * Redis cache for Instagram posts
 * Stores post data for reliable URL lookup during event creation
 */
export class RedisPostCache {
  private client: RedisClientType | null = null;
  private readonly prefix = 'instagram:post:';
  private readonly ttl = 60 * 60 * 24; // 24 hours TTL

  async connect(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      this.client = createClient({ url: redisUrl });

      this.client.on('error', (err) => {
        console.error('⚠️ Redis Client Error:', err);
      });

      await this.client.connect();
      console.log(`✅ Redis connected: ${redisUrl}`);
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      console.log('🔌 Redis disconnected');
    }
  }

  /**
   * Store Instagram post in Redis
   */
  async storePost(post: InstagramPost): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const key = this.prefix + post.id;
    const data = JSON.stringify({
      id: post.id,
      shortCode: post.shortCode,
      url: post.url,
      ownerUsername: post.ownerUsername,
      caption: post.caption,
      locationName: post.locationName,
      timestamp: post.timestamp,
    });

    await this.client.setEx(key, this.ttl, data);
  }

  /**
   * Store multiple posts in Redis (batch)
   */
  async storePosts(posts: InstagramPost[]): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    console.log(`📦 Storing ${posts.length} posts in Redis...`);

    // Use pipeline for better performance
    const pipeline = this.client.multi();

    for (const post of posts) {
      const key = this.prefix + post.id;
      const data = JSON.stringify({
        id: post.id,
        shortCode: post.shortCode,
        url: post.url,
        ownerUsername: post.ownerUsername,
        caption: post.caption?.substring(0, 500), // Store first 500 chars
        locationName: post.locationName,
        timestamp: post.timestamp,
      });

      pipeline.setEx(key, this.ttl, data);
    }

    await pipeline.exec();
    console.log(`✅ Stored ${posts.length} posts in Redis`);
  }

  /**
   * Get Instagram post from Redis
   */
  async getPost(postId: string): Promise<InstagramPost | null> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }

    const key = this.prefix + postId;
    const data = await this.client.get(key);

    if (!data) {
      console.warn(`⚠️ Post ${postId} not found in Redis`);
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Get post URL from Redis (convenience method)
   */
  async getPostUrl(postId: string): Promise<string | null> {
    const post = await this.getPost(postId);
    return post?.url || null;
  }
}
