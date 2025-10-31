export function parsePriceRange(text: string | undefined): { from?: number; to?: number } {
  if (!text) return {};

  // Clean text: remove currency symbols and extra whitespace
  const cleaned = text
    .replace(/\u00A0/g, ' ')
    .replace(/[₴грн.]+/gi, '') // remove currency symbols
    .trim();

  // Try to match "від X" pattern (Ukrainian "from X")
  const fromMatch = cleaned.match(/від\s+(\d+(?:[.,]\d+)?)/i);
  if (fromMatch) {
    const from = Number(fromMatch[1].replace(/,/g, '.'));
    if (Number.isFinite(from) && from > 0) {
      return { from };
    }
  }

  // Try to match price range: "95-170", "110 - 180", etc.
  const rangeMatch = cleaned.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1].replace(/,/g, '.'));
    const to = Number(rangeMatch[2].replace(/,/g, '.'));
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
      return { from, to };
    }
  }

  // Single price: extract all numbers and use min/max
  const nums = cleaned
    .replace(/[^0-9.,\s-]+/g, ' ')
    .split(/\s+/)
    .map(p => p.replace(/,/g, '.'))
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0);

  if (nums.length === 0) return {};
  if (nums.length === 1) return { from: nums[0] };

  return { from: Math.min(...nums), to: Math.max(...nums) };
}

export function parsePriceFrom(text: string | undefined): number | undefined {
  return parsePriceRange(text).from;
}
