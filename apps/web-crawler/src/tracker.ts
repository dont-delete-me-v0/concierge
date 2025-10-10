type TrackKind = 'critical_error' | 'parsing_progress' | 'parsing_result_edit';

interface TrackResponse {
  ok: boolean;
  message_id?: number;
  error?: unknown;
}

const isEnabled = (): boolean => {
  const raw = process.env.TELEGRAM_TRACKING;
  if (raw == null || raw === '') return true; // default: enabled
  const v = String(raw).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
};

const apiBase = (): string =>
  String(process.env.API_BASE_URL || 'http://localhost:3000');

async function postTrack(payload: {
  kind: TrackKind;
  text: string;
  messageId?: number;
}): Promise<TrackResponse> {
  if (!isEnabled()) return { ok: true };
  try {
    const res = await fetch(`${apiBase()}/telegram/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: payload.kind,
        text: payload.text,
        messageId: payload.messageId,
      }),
    });
    const data = (await res.json()) as TrackResponse;
    return data;
  } catch (err) {
    // swallow tracking errors
    return { ok: false, error: err };
  }
}

export async function trackProgressStart(text: string): Promise<number | null> {
  const resp = await postTrack({ kind: 'parsing_progress', text });
  return resp.ok && typeof resp.message_id === 'number'
    ? resp.message_id
    : null;
}

export async function trackProgressEdit(
  messageId: number | null,
  text: string
): Promise<void> {
  if (!messageId) return;
  await postTrack({ kind: 'parsing_result_edit', text, messageId });
}

export async function trackCriticalError(text: string): Promise<void> {
  await postTrack({ kind: 'critical_error', text });
}
