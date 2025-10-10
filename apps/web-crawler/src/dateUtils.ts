import { DateTime } from 'luxon';

const UA_MONTHS: Record<string, number> = {
  січня: 1,
  лютого: 2,
  березня: 3,
  квітня: 4,
  травня: 5,
  червня: 6,
  липня: 7,
  серпня: 8,
  вересня: 9,
  жовтня: 10,
  листопада: 11,
  грудня: 12,
  'січ.': 1,
  'лют.': 2,
  'бер.': 3,
  'квіт.': 4,
  'трав.': 5,
  'черв.': 6,
  'лип.': 7,
  'серп.': 8,
  'вер.': 9,
  'жовт.': 10,
  'лист.': 11,
  'груд.': 12,
};

function sanitize(input: string): string {
  return input
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Parse Ukrainian/RU-like event date strings to ISO UTC string.
 * Heuristics:
 * - Picks the start date/time when a range is provided
 * - When year is missing, uses the current year in Europe/Kyiv timezone
 * - When time is missing, uses 00:00 local (Europe/Kyiv)
 */
export function parseDateTimeUaToUtcIso(rawInput: string): string | undefined {
  const input = sanitize(rawInput);
  const zone = 'Europe/Kyiv';
  const now = DateTime.now().setZone(zone);

  // 1) dd month yyyy [, dow] [HH:MM] [- HH:MM]
  {
    const m = input.match(
      /^(\d{1,2})\s+([а-яіїєґ.]+)\s+(\d{4})(?:,?\s*[^\d]*)?(?:\s+(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?)?/i
    );
    if (m) {
      const day = Number(m[1]);
      const monName = m[2];
      const year = Number(m[3]);
      const hour = m[4] ? Number(m[4]) : 0;
      const minute = m[5] ? Number(m[5]) : 0;
      const endHour = m[6] ? Number(m[6]) : undefined;
      const endMinute = m[7] ? Number(m[7]) : undefined;
      const month = UA_MONTHS[monName] ?? UA_MONTHS[monName.replace(/\.$/, '')];
      if (month) {
        const dt = DateTime.fromObject(
          { year, month, day, hour, minute },
          { zone }
        );
        if (dt.isValid) return dt.toUTC().toISO();
      }
    }
  }

  // 2) dd month [, dow] HH:MM (no year)
  {
    const m = input.match(
      /^(\d{1,2})\s+([а-яіїєґ.]+)(?:,?\s*[^\d]*)?\s+(\d{1,2}):(\d{2})/i
    );
    if (m) {
      const day = Number(m[1]);
      const monName = m[2];
      const hour = Number(m[3]);
      const minute = Number(m[4]);
      const month = UA_MONTHS[monName] ?? UA_MONTHS[monName.replace(/\.$/, '')];
      if (month) {
        const year = now.year;
        const dt = DateTime.fromObject(
          { year, month, day, hour, minute },
          { zone }
        );
        if (dt.isValid) return dt.toUTC().toISO();
      }
    }
  }

  // 3) dd.mm - dd.mm (range in same year, pick start date at 00:00)
  {
    const m = input.match(/^(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = now.year;
      const dt = DateTime.fromObject(
        { year, month, day, hour: 0, minute: 0 },
        { zone }
      );
      if (dt.isValid) return dt.toUTC().toISO();
    }
  }

  // 4) dd.mm.yyyy [HH:MM]? general fallback
  {
    const m = input.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/
    );
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = Number(m[3]);
      const hour = m[4] ? Number(m[4]) : 0;
      const minute = m[5] ? Number(m[5]) : 0;
      const dt = DateTime.fromObject(
        { year, month, day, hour, minute },
        { zone }
      );
      if (dt.isValid) return dt.toUTC().toISO();
    }
  }

  return undefined;
}

export function parseDateRangeUaToUtcIso(rawInput: string): {
  from?: string;
  to?: string;
} {
  const input = sanitize(rawInput);
  const zone = 'Europe/Kyiv';
  const now = DateTime.now().setZone(zone);

  // Format: dd month yyyy, dow HH:MM - HH:MM
  {
    const m = input.match(
      /^(\d{1,2})\s+([а-яіїєґ.]+)\s+(\d{4})(?:,?\s*[^\d]*)?\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i
    );
    if (m) {
      const day = Number(m[1]);
      const monName = m[2];
      const year = Number(m[3]);
      const sh = Number(m[4]);
      const sm = Number(m[5]);
      const eh = Number(m[6]);
      const em = Number(m[7]);
      const month = UA_MONTHS[monName] ?? UA_MONTHS[monName.replace(/\.$/, '')];
      if (month) {
        const start = DateTime.fromObject(
          { year, month, day, hour: sh, minute: sm },
          { zone }
        );
        const end = DateTime.fromObject(
          { year, month, day, hour: eh, minute: em },
          { zone }
        );
        return {
          from: start.isValid
            ? (start.toUTC().toISO() ?? undefined)
            : undefined,
          to: end.isValid ? (end.toUTC().toISO() ?? undefined) : undefined,
        };
      }
    }
  }

  // Format: dd.mm - dd.mm (no times). Interpret as UTC midnight for both dates.
  {
    const m = input.match(
      /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*-\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/
    );
    if (m) {
      const d1 = Number(m[1]);
      const m1 = Number(m[2]);
      const y1 = m[3] ? Number(m[3]) : now.year;
      const d2 = Number(m[4]);
      const m2 = Number(m[5]);
      const y2 = m[6] ? Number(m[6]) : now.year;
      const startUtc = DateTime.utc(y1, m1, d1, 0, 0, 0).toISO();
      const endUtc = DateTime.utc(y2, m2, d2, 0, 0, 0).toISO();
      return { from: startUtc ?? undefined, to: endUtc ?? undefined };
    }
  }

  // Fallbacks: use start-only parser
  const one = parseDateTimeUaToUtcIso(rawInput);
  return { from: one, to: undefined };
}
