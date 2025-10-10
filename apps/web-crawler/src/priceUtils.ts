export function parsePriceFrom(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/\u00A0/g, ' ')
    .replace(/[a-zA-Zа-яА-ЯіїєґІЇЄҐ]+/g, ' ')
    .replace(/[^0-9.,-]+/g, ' ')
    .trim();
  // try to find the lowest number in the string (price from)
  const nums = cleaned
    .split(/\s+/)
    .map(p => p.replace(/,/g, '.'))
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));
  if (nums.length === 0) return undefined;
  return Math.min(...nums);
}
