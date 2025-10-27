import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TRACKER_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot: TelegramBot | null = null;

if (TELEGRAM_TOKEN && CHAT_ID) {
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
  console.log('📱 Telegram tracker initialized');
}

export async function trackProgress(
  message: string,
  data?: Record<string, unknown>
): Promise<number | null> {
  if (!bot || !CHAT_ID) return null;

  try {
    const text = data
      ? `${message}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      : message;

    const result = await bot.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
      disable_notification: true,
    });

    return result.message_id;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return null;
  }
}

export async function trackProgressStart(
  message: string,
  data?: Record<string, unknown>
): Promise<number | null> {
  return trackProgress(`🚀 ${message}`, data);
}

export async function trackProgressEdit(
  messageId: number | null,
  message: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  if (!bot || !CHAT_ID || !messageId) return false;

  try {
    const text = data
      ? `${message}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      : message;

    await bot.editMessageText(text, {
      chat_id: CHAT_ID,
      message_id: messageId,
      parse_mode: 'Markdown',
    });

    return true;
  } catch (error) {
    console.error('Failed to edit Telegram message:', error);
    return false;
  }
}

export async function trackCriticalError(
  error: Error,
  context?: Record<string, unknown>
): Promise<void> {
  if (!bot || !CHAT_ID) return;

  try {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      ...context,
    };

    const text = `❌ **Critical Error**\n\`\`\`json\n${JSON.stringify(
      errorInfo,
      null,
      2
    )}\n\`\`\``;

    await bot.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
    });
  } catch (sendError) {
    console.error('Failed to send error to Telegram:', sendError);
  }
}