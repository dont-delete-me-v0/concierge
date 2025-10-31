import { Markup } from 'telegraf';
import type { EventItem } from './events-api.service';

export function mainKeyboard() {
  return Markup.keyboard([
    ['🔍 Поиск'],
    ['⚡️ Что сегодня?', '🎯 Подборка для меня'],
    ['⭐️ Избранное', '👤 Профиль'],
  ]).resize();
}

export function formatEventCard(e: EventItem): string {
  const title = e.title ?? 'Без названия';
  const desc = buildSafeDescription(e.description);
  const dateLine = formatDateRange(
    e.date_time_from ?? e.date_time,
    e.date_time_to
  );

  // Format price range
  let price = '—';
  if (e.price_from != null && e.price_to != null && e.price_from !== e.price_to) {
    price = `${e.price_from}-${e.price_to} грн`;
  } else if (e.price_from != null) {
    price = `від ${e.price_from} грн`;
  }

  const url = resolveEventUrl(e.source_url);
  return [
    `<b>${escapeHtml(title)}</b>`,
    dateLine ? `📅 ${dateLine}` : '',
    `💸 ${price}`,
    desc,
    url ? `🔗 <a href="${escapeHtml(url)}">Источник</a>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Kiev',
  });
}

function formatDateOnly(d: Date): string {
  return d.toLocaleDateString('ru-RU', { dateStyle: 'medium' });
}

function formatTimeOnly(d: Date): string {
  return d.toLocaleTimeString('ru-RU', {
    timeStyle: 'short',
    timeZone: 'Europe/Kiev',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateRange(
  fromIso?: string | null,
  toIso?: string | null
): string {
  if (!fromIso && !toIso) return '';
  try {
    if (fromIso && toIso) {
      const from = new Date(fromIso);
      const to = new Date(toIso);
      if (isNaN(from.getTime()) && isNaN(to.getTime())) return '';
      if (isNaN(from.getTime())) return formatDate(toIso);
      if (isNaN(to.getTime())) return formatDate(fromIso);
      if (isSameDay(from, to)) {
        return `${formatDateOnly(from)}, ${formatTimeOnly(from)}–${formatTimeOnly(to)}`;
      }
      return `${formatDate(fromIso)} — ${formatDate(toIso)}`;
    }
    const one = new Date((fromIso ?? toIso) as string);
    if (isNaN(one.getTime())) return '';
    return formatDate((fromIso ?? toIso) as string);
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolveEventUrl(raw?: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = process.env.SOURCE_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL(raw, base);
    return url.toString();
  } catch {
    return null;
  }
}

function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSafeDescription(raw?: string | null): string {
  if (!raw) return '';
  const plain = stripTags(raw);
  if (!plain) return '';
  return escapeHtml(truncate(plain, 300));
}
