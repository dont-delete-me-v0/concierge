import { Injectable, Logger } from '@nestjs/common';
import { Telegram } from 'telegraf';

interface SendMessageOptions {
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly telegram: Telegram | null = null;
  private readonly chatId: string;

  constructor() {
    // Use TELEGRAM_TRACKER_TOKEN for crawler notifications
    const token = process.env.TELEGRAM_TRACKER_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    if (!token) {
      this.logger.warn('TELEGRAM_TRACKER_TOKEN is not set');
    }
    if (!this.chatId) {
      this.logger.warn('TELEGRAM_CHAT_ID is not set');
    }
    this.telegram = token ? new Telegram(token) : null;
  }

  async sendMessage(
    text: string,
    opts: SendMessageOptions = {}
  ): Promise<{ ok: boolean; message_id?: number; error?: unknown }> {
    if (!this.telegram || !this.chatId) {
      return { ok: false, error: 'Telegram not configured' };
    }
    try {
      const msg = await this.telegram.sendMessage(this.chatId, text, {
        parse_mode: opts.parse_mode,
        // Telegraf v4 uses link_preview_options instead of disable_web_page_preview
        link_preview_options: opts.disable_web_page_preview
          ? { is_disabled: true }
          : undefined,
      } as any);
      return { ok: true, message_id: (msg as any)?.message_id };
    } catch (err) {
      this.logger.error('Telegram sendMessage error', err as Error);
      return { ok: false, error: err };
    }
  }
}
