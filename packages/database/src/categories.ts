/**
 * Unified category mapping for all event sources
 * Maps various category names to standardized Ukrainian categories
 */

export const STANDARD_CATEGORIES = {
  // Основные категории (украинские)
  CONCERT: 'Концерт',
  THEATER: 'Театр',
  EXHIBITION: 'Виставка',
  FESTIVAL: 'Фестиваль',
  PARTY: 'Вечірка',
  STANDUP: 'Стендап',
  KIDS: 'Дитяче',
  SPORT: 'Спорт',
  EXCURSION: 'Екскурсія',
  OTHER: 'Інше',
} as const;

export type StandardCategory = typeof STANDARD_CATEGORIES[keyof typeof STANDARD_CATEGORIES];

/**
 * Maps English categories (from web-crawler) to Ukrainian standard categories
 */
export const CATEGORY_MAPPING: Record<string, StandardCategory> = {
  // English to Ukrainian mapping
  'concerts': STANDARD_CATEGORIES.CONCERT,
  'concert': STANDARD_CATEGORIES.CONCERT,
  'theater': STANDARD_CATEGORIES.THEATER,
  'theatre': STANDARD_CATEGORIES.THEATER,
  'dance': STANDARD_CATEGORIES.PARTY,
  'electronic': STANDARD_CATEGORIES.PARTY,
  'excursions': STANDARD_CATEGORIES.EXCURSION,
  'excursion': STANDARD_CATEGORIES.EXCURSION,
  'humor': STANDARD_CATEGORIES.STANDUP,
  'standup': STANDARD_CATEGORIES.STANDUP,
  'stand-up': STANDARD_CATEGORIES.STANDUP,
  'kids': STANDARD_CATEGORIES.KIDS,
  'children': STANDARD_CATEGORIES.KIDS,
  'new-year': STANDARD_CATEGORIES.FESTIVAL,
  'newyear': STANDARD_CATEGORIES.FESTIVAL,
  'other': STANDARD_CATEGORIES.OTHER,
  'tvorchii-vechir': STANDARD_CATEGORIES.OTHER,
  'creative-evening': STANDARD_CATEGORIES.OTHER,
  'festivals': STANDARD_CATEGORIES.FESTIVAL,
  'festival': STANDARD_CATEGORIES.FESTIVAL,
  'sport': STANDARD_CATEGORIES.SPORT,
  'sports': STANDARD_CATEGORIES.SPORT,
  'party': STANDARD_CATEGORIES.PARTY,
  'exhibition': STANDARD_CATEGORIES.EXHIBITION,

  // Already Ukrainian - pass through
  'Концерт': STANDARD_CATEGORIES.CONCERT,
  'Театр': STANDARD_CATEGORIES.THEATER,
  'Виставка': STANDARD_CATEGORIES.EXHIBITION,
  'Фестиваль': STANDARD_CATEGORIES.FESTIVAL,
  'Вечірка': STANDARD_CATEGORIES.PARTY,
  'Стендап': STANDARD_CATEGORIES.STANDUP,
  'Дитяче': STANDARD_CATEGORIES.KIDS,
  'Спорт': STANDARD_CATEGORIES.SPORT,
  'Екскурсія': STANDARD_CATEGORIES.EXCURSION,
  'Інше': STANDARD_CATEGORIES.OTHER,
};

/**
 * Normalize category name to standard Ukrainian category
 */
export function normalizeCategory(category: string | null | undefined): StandardCategory {
  if (!category) {
    return STANDARD_CATEGORIES.OTHER;
  }

  // Try exact match first
  const normalized = CATEGORY_MAPPING[category];
  if (normalized) {
    return normalized;
  }

  // Try lowercase match
  const lowerCategory = category.toLowerCase();
  const lowerNormalized = CATEGORY_MAPPING[lowerCategory];
  if (lowerNormalized) {
    return lowerNormalized;
  }

  // Try to find partial match
  for (const [key, value] of Object.entries(CATEGORY_MAPPING)) {
    if (lowerCategory.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerCategory)) {
      return value;
    }
  }

  // Default to OTHER
  return STANDARD_CATEGORIES.OTHER;
}

/**
 * Get all unique standard categories
 */
export function getAllCategories(): StandardCategory[] {
  return Object.values(STANDARD_CATEGORIES);
}