import * as amqp from 'amqplib';
import { once } from 'node:events';

export interface RabbitPublisherOptions {
  batchSize?: number;
  batchIntervalMs?: number;
  maxRetries?: number;
  reconnectDelayMs?: number;
}

interface PendingMessage {
  body: Buffer;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class RabbitPublisher {
  private readonly url: string;
  private readonly queueName: string;
  private readonly options: Required<RabbitPublisherOptions>;

  private connection: any | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private isClosing = false;

  private batch: PendingMessage[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    url = process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672',
    queueName = process.env.RABBITMQ_QUEUE || 'events',
    options: RabbitPublisherOptions = {}
  ) {
    this.url = url;
    this.queueName = queueName;
    this.options = {
      batchSize:
        options.batchSize ?? Number(process.env.PUBLISHER_BATCH_SIZE || 50),
      batchIntervalMs:
        options.batchIntervalMs ??
        Number(process.env.PUBLISHER_BATCH_INTERVAL_MS || 200),
      maxRetries:
        options.maxRetries ?? Number(process.env.PUBLISHER_MAX_RETRIES || 3),
      reconnectDelayMs:
        options.reconnectDelayMs ??
        Number(process.env.PUBLISHER_RECONNECT_DELAY_MS || 1000),
    };
  }

  async publish(message: Record<string, unknown>): Promise<void> {
    const body = Buffer.from(JSON.stringify(message));
    return new Promise<void>((resolve, reject) => {
      this.batch.push({ body, resolve, reject });
      if (this.batch.length >= this.options.batchSize) {
        void this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.flush();
        }, this.options.batchIntervalMs);
      }
    });
  }

  async publishMany(messages: Record<string, unknown>[]): Promise<void> {
    console.log(`📤 Publishing ${messages.length} messages to RabbitMQ...`);
    await Promise.all(messages.map(m => this.publish(m)));
    console.log(`✅ Published ${messages.length} messages successfully`);
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.batch.length > 0) {
      try {
        await this.flush();
      } catch {
        // drop pending on close
      }
    }
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
    } catch {
      // ignore
    } finally {
      this.channel = null;
      this.connection = null;
      console.log('🔌 [RabbitMQ] Publisher closed');
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const batch = this.batch;
    this.batch = [];

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const ch = await this.ensureChannel();

        for (const item of batch) {
          const ok = ch.sendToQueue(this.queueName, item.body, {
            persistent: true,
            contentType: 'application/json',
          });
          if (!ok) {
            console.warn('⏳ [RabbitMQ] Backpressure, waiting for drain...');
            await once(ch as any, 'drain');
          }
        }

        await ch.waitForConfirms();
        for (const m of batch) m.resolve();
        console.log(
          `✅ [RabbitMQ] Batch of ${batch.length} messages confirmed`
        );
        return;
      } catch (err) {
        if (attempt === this.options.maxRetries) {
          for (const m of batch) m.reject(err);
          throw err;
        }
        console.warn(
          `⚠️ [RabbitMQ] Flush failed (attempt ${attempt + 1}/${
            this.options.maxRetries + 1
          }), retrying...`,
          err
        );
        await this.reconnectWithDelay(attempt);
      }
    }
  }

  private async ensureChannel(): Promise<amqp.ConfirmChannel> {
    if (this.isClosing) throw new Error('Publisher is closing');
    if (this.channel) return this.channel;

    if (!this.connection) {
      console.log(`🔌 [RabbitMQ] Connecting to ${this.url}...`);
      this.connection = await amqp.connect(this.url);
      this.connection.on('error', (err: unknown) => {
        console.error('❌ [RabbitMQ] Connection error', err);
      });
      this.connection.on('close', () => {
        console.warn('⚠️ [RabbitMQ] Connection closed');
        this.connection = null;
        this.channel = null;
      });
    }

    const ch = await this.connection!.createConfirmChannel();
    await ch.assertQueue(this.queueName, { durable: true });
    ch.on('error', (err: unknown) => {
      console.error('❌ [RabbitMQ] Channel error', err);
    });
    ch.on('close', () => {
      console.warn('⚠️ [RabbitMQ] Channel closed');
      this.channel = null;
    });
    this.channel = ch;
    console.log(
      `✅ [RabbitMQ] Connected. Queue: ${this.queueName}, Batch: ${this.options.batchSize}`
    );
    return ch;
  }

  private async reconnectWithDelay(attempt: number): Promise<void> {
    const delay = this.options.reconnectDelayMs * (attempt + 1);
    await new Promise(r => setTimeout(r, delay));
    try {
      if (this.connection) await this.connection.close();
    } catch {
      // ignore
    }
    this.connection = null;
    this.channel = null;
  }
}