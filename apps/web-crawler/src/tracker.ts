import axios from 'axios';

type TrackKind =
  | 'critical_error'
  | 'parsing_progress'
  | 'parsing_result_edit'
  | 'scheduler_status'
  | 'job_started'
  | 'job_completed';

interface TrackResponse {
  ok: boolean;
  message_id?: number;
  error?: unknown;
}

interface LogContext {
  configName?: string;
  timestamp?: string;
  duration?: number;
  itemsCount?: number;
  newItems?: number;
  updatedItems?: number;
  errorDetails?: string;
}

const isEnabled = (): boolean => {
  const raw = process.env.TELEGRAM_TRACKING;
  if (raw == null || raw === '') return true; // default: enabled
  const v = String(raw).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
};

const apiBase = (): string =>
  String(process.env.API_BASE_URL || 'http://localhost:3000');

function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('uk-UA', {
    timeZone: 'Europe/Kiev',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}г ${minutes % 60}хв ${seconds % 60}с`;
  } else if (minutes > 0) {
    return `${minutes}хв ${seconds % 60}с`;
  } else {
    return `${seconds}с`;
  }
}

function buildMessage(text: string, context?: LogContext): string {
  let message = text;

  if (context) {
    if (context.configName) {
      message += `\n📋 Конфіг: ${context.configName}`;
    }
    if (context.timestamp) {
      message += `\n🕐 Час: ${context.timestamp}`;
    }
    if (context.duration !== undefined) {
      message += `\n⏱️ Тривалість: ${formatDuration(context.duration)}`;
    }
    if (context.itemsCount !== undefined) {
      message += `\n📊 Всього елементів: ${context.itemsCount}`;
    }
    if (context.newItems !== undefined) {
      message += `\n🆕 Нових: ${context.newItems}`;
    }
    if (context.updatedItems !== undefined && context.updatedItems > 0) {
      message += `\n♻️ Оновлених: ${context.updatedItems}`;
    }
    if (context.errorDetails) {
      message += `\n❌ Помилка: ${context.errorDetails}`;
    }
  }

  return message;
}

async function postTrack(payload: {
  kind: TrackKind;
  text: string;
  messageId?: number;
  context?: LogContext;
}): Promise<TrackResponse> {
  if (!isEnabled()) {
    console.log(
      '[Tracker] Telegram tracking disabled (TELEGRAM_TRACKING=false)'
    );
    return { ok: true };
  }

  const message = buildMessage(payload.text, payload.context);

  // Always log to console
  console.log(`[Tracker] ${payload.kind}: ${message}`);

  try {
    const res = await axios.post(
      `${apiBase()}/telegram/track`,
      {
        kind: payload.kind,
        text: message,
        messageId: payload.messageId,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000, // 10 second timeout
      }
    );

    const data = res.data as TrackResponse;

    if (!data.ok) {
      console.warn(
        '[Tracker] Notification sent but not delivered:',
        data.error
      );
    }

    return data;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check if it's an axios error with response
    if (axios.isAxiosError(err)) {
      if (err.response) {
        console.warn(
          `[Tracker] API returned error (HTTP ${err.response.status}):`,
          err.response.data
        );
        return { ok: false, error: err.response.data };
      } else if (err.code === 'ECONNREFUSED') {
        console.warn('[Tracker] Cannot connect to API server at:', apiBase());
        console.warn('[Tracker] Make sure API is running');
      } else if (err.code === 'ETIMEDOUT') {
        console.warn('[Tracker] Request timeout - API is not responding');
      } else {
        console.warn('[Tracker] Network error:', errorMessage);
      }
    } else {
      console.warn('[Tracker] Unexpected error:', errorMessage);
    }

    console.warn('[Tracker] To disable tracking: TELEGRAM_TRACKING=false');
    return { ok: false, error: err };
  }
}

export async function trackProgressStart(
  text: string,
  context?: LogContext & { url?: string }
): Promise<number | null> {
  // Add URL to the text if provided
  const fullText = context?.url ? `${text}\n🌐 URL: ${context.url}` : text;

  const resp = await postTrack({
    kind: 'parsing_progress',
    text: fullText,
    context: {
      ...context,
      timestamp: formatTimestamp(),
    },
  });
  return resp.ok && typeof resp.message_id === 'number'
    ? resp.message_id
    : null;
}

export async function trackProgressEdit(
  messageId: number | null,
  text: string,
  context?: LogContext
): Promise<void> {
  // Ignore messageId, always send new message
  await postTrack({
    kind: 'job_completed',
    text,
    context: {
      ...context,
      timestamp: formatTimestamp(),
    },
  });
}

export async function trackCriticalError(
  text: string,
  context?: LogContext
): Promise<void> {
  await postTrack({
    kind: 'critical_error',
    text,
    context: {
      ...context,
      timestamp: formatTimestamp(),
    },
  });
}

export async function trackSchedulerStatus(
  text: string,
  context?: LogContext
): Promise<void> {
  await postTrack({
    kind: 'scheduler_status',
    text,
    context: {
      ...context,
      timestamp: formatTimestamp(),
    },
  });
}

export async function trackJobStarted(
  configName: string,
  url?: string
): Promise<number | null> {
  const resp = await postTrack({
    kind: 'job_started',
    text: url
      ? `🚀 Запущено парсинг завдання\n🌐 URL: ${url}`
      : '🚀 Запущено парсинг завдання',
    context: {
      configName,
      timestamp: formatTimestamp(),
    },
  });
  return resp.ok && typeof resp.message_id === 'number'
    ? resp.message_id
    : null;
}

export async function trackJobCompleted(
  messageId: number | null,
  configName: string,
  success: boolean,
  stats?: {
    duration: number;
    itemsCount: number;
    newItems: number;
    updatedItems?: number;
    errorDetails?: string;
  }
): Promise<void> {
  const text = success
    ? '✅ Завдання успішно виконано'
    : '❌ Завдання завершилось з помилкою';

  // Always send a new message, ignore messageId
  await postTrack({
    kind: 'job_completed',
    text,
    context: {
      configName,
      timestamp: formatTimestamp(),
      ...stats,
    },
  });
}
