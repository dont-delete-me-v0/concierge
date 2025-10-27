import { DateTime } from 'luxon';

// Ukrainian month names
const MONTHS_UA: Record<string, number> = {
  'січня': 1, 'січень': 1,
  'лютого': 2, 'лютий': 2,
  'березня': 3, 'березень': 3,
  'квітня': 4, 'квітень': 4,
  'травня': 5, 'травень': 5,
  'червня': 6, 'червень': 6,
  'липня': 7, 'липень': 7,
  'серпня': 8, 'серпень': 8,
  'вересня': 9, 'вересень': 9,
  'жовтня': 10, 'жовтень': 10,
  'листопада': 11, 'листопад': 11,
  'грудня': 12, 'грудень': 12,
};

/**
 * Parse Ukrainian date/time strings to UTC ISO format.
 * Handles formats like:
 * - "10 грудня, 19:00"
 * - "10.12.2025"
 * - "10 грудня 2025, 19:00"
 * - "10/12/2025"
 */
export function parseDateTimeUaToUtcIso(input: string | undefined): string | undefined {
  if (!input || typeof input !== 'string') return undefined;

  const str = input.trim();
  if (!str) return undefined;

  const now = DateTime.now().setZone('Europe/Kyiv');
  let dt: DateTime | null = null;

  // Try parsing "DD month YYYY, HH:MM" format
  const fullDateTimeMatch = str.match(/(\d{1,2})\s+(\S+)\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (fullDateTimeMatch) {
    const [, day, monthName, year, hour, minute] = fullDateTimeMatch;
    const month = MONTHS_UA[monthName.toLowerCase()];
    if (month) {
      dt = DateTime.fromObject(
        {
          year: parseInt(year, 10),
          month,
          day: parseInt(day, 10),
          hour: hour ? parseInt(hour, 10) : 0,
          minute: minute ? parseInt(minute, 10) : 0,
        },
        { zone: 'Europe/Kyiv' }
      );
    }
  }

  // Try parsing "DD month, HH:MM" format (without year)
  if (!dt) {
    const shortDateTimeMatch = str.match(/(\d{1,2})\s+(\S+)(?:,?\s*(\d{1,2}):(\d{2}))?/);
    if (shortDateTimeMatch) {
      const [, day, monthName, hour, minute] = shortDateTimeMatch;
      const month = MONTHS_UA[monthName.toLowerCase()];
      if (month) {
        // Use current year or next year if date has passed
        let year = now.year;
        const testDate = DateTime.fromObject(
          {
            year,
            month,
            day: parseInt(day, 10),
            hour: hour ? parseInt(hour, 10) : 0,
            minute: minute ? parseInt(minute, 10) : 0,
          },
          { zone: 'Europe/Kyiv' }
        );

        if (testDate < now) {
          year = now.year + 1;
        }

        dt = DateTime.fromObject(
          {
            year,
            month,
            day: parseInt(day, 10),
            hour: hour ? parseInt(hour, 10) : 0,
            minute: minute ? parseInt(minute, 10) : 0,
          },
          { zone: 'Europe/Kyiv' }
        );
      }
    }
  }

  // Try parsing "DD.MM.YYYY HH:MM" format
  if (!dt) {
    const dotDateMatch = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (dotDateMatch) {
      const [, day, month, yearStr, hour, minute] = dotDateMatch;
      const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
      dt = DateTime.fromObject(
        {
          year,
          month: parseInt(month, 10),
          day: parseInt(day, 10),
          hour: hour ? parseInt(hour, 10) : 0,
          minute: minute ? parseInt(minute, 10) : 0,
        },
        { zone: 'Europe/Kyiv' }
      );
    }
  }

  // Try parsing "DD/MM/YYYY" format
  if (!dt) {
    const slashDateMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashDateMatch) {
      const [, day, month, yearStr] = slashDateMatch;
      const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
      dt = DateTime.fromObject(
        {
          year,
          month: parseInt(month, 10),
          day: parseInt(day, 10),
          hour: 0,
          minute: 0,
        },
        { zone: 'Europe/Kyiv' }
      );
    }
  }

  // Try parsing time only "HH:MM"
  if (!dt) {
    const timeOnlyMatch = str.match(/(\d{1,2}):(\d{2})/);
    if (timeOnlyMatch) {
      const [, hour, minute] = timeOnlyMatch;
      dt = now.set({
        hour: parseInt(hour, 10),
        minute: parseInt(minute, 10),
        second: 0,
        millisecond: 0,
      });
    }
  }

  if (!dt || !dt.isValid) {
    return undefined;
  }

  const iso = dt.toUTC().toISO();
  return iso || undefined;
}

/**
 * Parse date range strings like "10-12 грудня", "10.12 - 12.12", or "10 та 11 лютого"
 */
export function parseDateRangeUaToUtcIso(
  input: string | undefined
): { from?: string; to?: string } {
  if (!input || typeof input !== 'string') return {};

  const str = input.trim();
  if (!str) return {};

  // Check for range pattern with Ukrainian conjunction "та" (and): "DD та DD month"
  const taRangeMatch = str.match(/(\d{1,2})\s+(?:та|і)\s+(\d{1,2})\s+(\S+)/i);
  if (taRangeMatch) {
    const [, dayFrom, dayTo, monthName] = taRangeMatch;
    const month = MONTHS_UA[monthName.toLowerCase()];
    if (month) {
      const from = parseDateTimeUaToUtcIso(`${dayFrom} ${monthName}`);
      const to = parseDateTimeUaToUtcIso(`${dayTo} ${monthName}`);
      return { from, to };
    }
  }

  // Check for range pattern "DD-DD month" or "DD.MM - DD.MM"
  const rangeMatch = str.match(/(\d{1,2})(?:\.(\d{1,2}))?[\s-]+(\d{1,2})(?:\.(\d{1,2}))?(?:\s+(\S+))?/);
  if (rangeMatch) {
    const [, dayFrom, monthFrom, dayTo, monthTo, monthName] = rangeMatch;

    if (monthName) {
      // "DD-DD month" format
      const month = MONTHS_UA[monthName.toLowerCase()];
      if (month) {
        const from = parseDateTimeUaToUtcIso(`${dayFrom} ${monthName}`);
        const to = parseDateTimeUaToUtcIso(`${dayTo} ${monthName}`);
        return { from, to };
      }
    } else if (monthFrom && monthTo) {
      // "DD.MM - DD.MM" format
      const now = DateTime.now().setZone('Europe/Kyiv');
      const from = parseDateTimeUaToUtcIso(`${dayFrom}.${monthFrom}.${now.year}`);
      const to = parseDateTimeUaToUtcIso(`${dayTo}.${monthTo}.${now.year}`);
      return { from, to };
    }
  }

  return {};
}