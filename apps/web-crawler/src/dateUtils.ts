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
      /^(\d{1,2})\s+([а-яіїєґ.]+)\s+(\d{4})(?:,?\s*[^\d]*)?(?:\s+(\d{1,2}):(\d{2}))?/i
    );
    if (m) {
      const day = Number(m[1]);
      const monName = m[2];
      const year = Number(m[3]);
      const hour = m[4] ? Number(m[4]) : 0;
      const minute = m[5] ? Number(m[5]) : 0;
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
