import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { EventsService } from './events.service';

@Injectable()
export class RabbitConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitConsumer.name);
  private connection: unknown | null = null; // avoid type conflicts
  private channel: amqp.Channel | null = null;
  private queueName = process.env.RABBITMQ_QUEUE || 'events';
  private url =
    process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672';
  private buffer: amqp.ConsumeMessage[] = [];
  private flushFn: (() => Promise<void>) | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private metrics = {
    totalProcessed: 0,
    totalBatches: 0,
    totalErrors: 0,
    startTime: Date.now(),
  };

  constructor(private readonly events: EventsService) {}

  async onModuleInit(): Promise<void> {
    try {
      this.logger.log(`🔌 Connecting to RabbitMQ at ${this.url}`);
      const conn = (await amqp.connect(this.url)) as any;
      this.connection = conn as unknown;
      const ch = await (conn as any).createChannel();
      this.channel = ch;
      await ch.assertQueue(this.queueName, { durable: true });
      const prefetch = Number(process.env.RABBITMQ_PREFETCH || 100);
      await ch.prefetch(prefetch);
      this.logger.log(
        `✅ Connected. Queue: ${this.queueName}, Prefetch: ${prefetch}`
      );
      this.startBufferedConsumer(ch);
      this.logger.log(
        `🚀 Consumer started (buffered mode) - ready to process events`
      );
    } catch (err) {
      this.logger.error('❌ Failed to init RabbitMQ consumer', err as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Flush pending buffered messages before shutdown
    if (this.buffer.length > 0 && this.flushFn) {
      this.logger.log(
        `🛑 Graceful shutdown: flushing ${this.buffer.length} pending messages`
      );
      try {
        await this.flushFn();
      } catch (err) {
        this.logger.error('❌ Failed to flush on shutdown', err as Error);
      }
    }

    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await (this.connection as any).close();
    } catch {
      // ignore
    } finally {
      this.channel = null;
      this.connection = null;
      this.logger.log('🔌 Consumer closed');
    }
  }

  private async handleMessage(msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      if (
        !payload ||
        typeof payload.id !== 'string' ||
        payload.id.length === 0
      ) {
        this.logger.warn('Skipping message without valid id');
        this.channel.ack(msg);
        return;
      }
      this.logger.debug(`Processing message id=${payload.id}`);
      let venueId: string | null = payload.venue_id ?? null;
      const venueName: string | undefined = payload.venue_name ?? payload.venue;
      if (
        !venueId &&
        typeof venueName === 'string' &&
        venueName.trim().length
      ) {
        venueId = await this.events
          .upsertVenue({ name: venueName.trim() })
          .catch(() => null);
      }

      let categoryId: string | null = payload.category_id ?? null;
      const categoryName: string | undefined =
        payload.category_name ?? payload.category;
      if (
        !categoryId &&
        typeof categoryName === 'string' &&
        categoryName.trim().length
      ) {
        categoryId = await this.events
          .upsertCategory({ name: categoryName.trim() })
          .catch(() => null);
      }

      await this.events.upsertEvent({
        id: payload.id,
        title: payload.title ?? null,
        description: payload.description ?? null,
        category_id: categoryId,
        venue_id: venueId,
        date_time: payload.date_time ?? null,
        date_time_from: payload.date_time_from ?? null,
        date_time_to: payload.date_time_to ?? null,
        price_from: payload.price_from ?? null,
        source_url: payload.source_url ?? payload.link ?? null,
      });
      this.channel.ack(msg);
      this.logger.debug(`Acked message id=${payload.id}`);
    } catch (err) {
      this.logger.error('Failed to process message', err as Error);
      this.channel.nack(msg, false, false); // discard bad message
    }
  }

  private startBufferedConsumer(ch: amqp.Channel): void {
    const maxBatch = Number(process.env.CONSUMER_BATCH_SIZE || 100);
    const flushInterval = Number(process.env.CONSUMER_FLUSH_MS || 200);
    const maxBufferSize = maxBatch * 3; // overflow protection

    this.logger.log(
      `📦 Buffer config: max=${maxBatch}, flush=${flushInterval}ms, maxBuffer=${maxBufferSize}`
    );

    const flush = async () => {
      if (this.buffer.length === 0) return;
      // Clear any scheduled flush to avoid race conditions
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      const batch = this.buffer.splice(0, this.buffer.length);
      try {
        this.logger.log(`🔄 Processing batch of ${batch.length} events...`);
        const events = batch.map(m => JSON.parse(m.content.toString()));
        const valid = events.filter(
          (p: any) => p && typeof p.id === 'string' && p.id.length > 0
        );
        this.logger.log(`✅ Valid events: ${valid.length}/${events.length}`);

        // Resolve categories and venues first, then upsert events
        const resolved = [] as Array<{
          id: string;
          title: string | null;
          description: string | null;
          category_id: string | null;
          venue_id: string | null;
          date_time: string | null;
          date_time_from: string | null;
          date_time_to: string | null;
          price_from: number | null;
          source_url: string | null;
        }>;
        for (const p of valid) {
          let venueId: string | null = p.venue_id ?? null;
          const venueName: string | undefined = p.venue_name ?? p.venue;
          if (
            !venueId &&
            typeof venueName === 'string' &&
            venueName.trim().length
          ) {
            venueId = await this.events
              .upsertVenue({ name: venueName.trim() })
              .catch(() => null);
          }

          let categoryId: string | null = p.category_id ?? null;
          const categoryName: string | undefined =
            p.category_name ?? p.category;
          if (
            !categoryId &&
            typeof categoryName === 'string' &&
            categoryName.trim().length
          ) {
            categoryId = await this.events
              .upsertCategory({ name: categoryName.trim() })
              .catch(() => null);
          }

          resolved.push({
            id: p.id,
            title: p.title ?? null,
            description: p.description ?? null,
            category_id: categoryId,
            venue_id: venueId,
            date_time: p.date_time ?? null,
            date_time_from: p.date_time_from ?? null,
            date_time_to: p.date_time_to ?? null,
            price_from: p.price_from ?? null,
            source_url: p.source_url ?? p.link ?? null,
          });
        }

        await this.events.upsertMany(resolved);
        for (const m of batch) ch.ack(m);
        this.metrics.totalProcessed += batch.length;
        this.metrics.totalBatches++;
        this.logger.log(
          `✅ Batch processed: ${batch.length} events saved to DB`
        );
        if (this.metrics.totalBatches % 10 === 0) {
          const uptime = (Date.now() - this.metrics.startTime) / 1000;
          const rate = this.metrics.totalProcessed / (uptime || 1);
          this.logger.log(
            `📊 Stats: ${this.metrics.totalProcessed} events in ${this.metrics.totalBatches} batches (${rate.toFixed(0)} events/s)`
          );
        }
      } catch (err) {
        this.metrics.totalErrors++;
        this.logger.error('❌ Batch processing failed', err as Error);
        for (const m of batch) ch.nack(m, false, false);
      }
    };

    this.flushFn = flush;

    const schedule = () => {
      if (this.flushTimer) return;
      this.flushTimer = setTimeout(async () => {
        this.flushTimer = null;
        await flush();
      }, flushInterval);
    };

    ch.consume(
      this.queueName,
      msg => {
        if (!msg) return;

        // Overflow protection
        if (this.buffer.length >= maxBufferSize) {
          this.logger.warn(
            `⚠️ Buffer overflow! Forcing flush at ${this.buffer.length} messages`
          );
          void flush();
        }

        this.buffer.push(msg);
        if (this.buffer.length >= maxBatch) void flush();
        else schedule();
      },
      { noAck: false }
    );
  }
}
