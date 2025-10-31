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
  DANCE: 'Танці',
  ELECTRONIC: 'Електронна музика',
  NEW_YEAR: 'Новий рік',
  CREATIVE_EVENING: 'Творчий вечір',
  CINEMA: 'Кіно',
  CIRCUS: 'Цирк',
  MUSEUM: 'Музей',
  BUSINESS: 'Бізнес',
  CLUBS: 'Клуби',
  PHILHARMONIC: 'Філармонія',
  PLANETARIUM: 'Планетарій',
  ZOO: 'Зоопарк',
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
  'dance': STANDARD_CATEGORIES.DANCE,
  'dances': STANDARD_CATEGORIES.DANCE,
  'electronic': STANDARD_CATEGORIES.ELECTRONIC,
  'electro': STANDARD_CATEGORIES.ELECTRONIC,
  'excursions': STANDARD_CATEGORIES.EXCURSION,
  'excursion': STANDARD_CATEGORIES.EXCURSION,
  'tour': STANDARD_CATEGORIES.EXCURSION,
  'tours': STANDARD_CATEGORIES.EXCURSION,
  'humor': STANDARD_CATEGORIES.STANDUP,
  'standup': STANDARD_CATEGORIES.STANDUP,
  'stand-up': STANDARD_CATEGORIES.STANDUP,
  'kids': STANDARD_CATEGORIES.KIDS,
  'children': STANDARD_CATEGORIES.KIDS,
  'new-year': STANDARD_CATEGORIES.NEW_YEAR,
  'newyear': STANDARD_CATEGORIES.NEW_YEAR,
  'new year': STANDARD_CATEGORIES.NEW_YEAR,
  'ny': STANDARD_CATEGORIES.NEW_YEAR,
  'other': STANDARD_CATEGORIES.OTHER,
  'tvorchii-vechir': STANDARD_CATEGORIES.CREATIVE_EVENING,
  'creative-evening': STANDARD_CATEGORIES.CREATIVE_EVENING,
  'творчий вечір': STANDARD_CATEGORIES.CREATIVE_EVENING,
  'festivals': STANDARD_CATEGORIES.FESTIVAL,
  'festival': STANDARD_CATEGORIES.FESTIVAL,
  'sport': STANDARD_CATEGORIES.SPORT,
  'sports': STANDARD_CATEGORIES.SPORT,
  'party': STANDARD_CATEGORIES.PARTY,
  'exhibition': STANDARD_CATEGORIES.EXHIBITION,
  'cinema': STANDARD_CATEGORIES.CINEMA,
  'kinopokaz': STANDARD_CATEGORIES.CINEMA,
  'kino': STANDARD_CATEGORIES.CINEMA,
  'movie': STANDARD_CATEGORIES.CINEMA,
  'movies': STANDARD_CATEGORIES.CINEMA,
  'circus': STANDARD_CATEGORIES.CIRCUS,
  'цирк': STANDARD_CATEGORIES.CIRCUS,
  'museum': STANDARD_CATEGORIES.MUSEUM,
  'museums': STANDARD_CATEGORIES.MUSEUM,
  'музей': STANDARD_CATEGORIES.MUSEUM,
  'business': STANDARD_CATEGORIES.BUSINESS,
  'бізнес': STANDARD_CATEGORIES.BUSINESS,
  'clubs': STANDARD_CATEGORIES.CLUBS,
  'club': STANDARD_CATEGORIES.CLUBS,
  'клуби': STANDARD_CATEGORIES.CLUBS,
  'клуб': STANDARD_CATEGORIES.CLUBS,
  'philharmonic': STANDARD_CATEGORIES.PHILHARMONIC,
  'filarmony': STANDARD_CATEGORIES.PHILHARMONIC,
  'філармонія': STANDARD_CATEGORIES.PHILHARMONIC,
  'planetarium': STANDARD_CATEGORIES.PLANETARIUM,
  'планетарій': STANDARD_CATEGORIES.PLANETARIUM,
  'zoo': STANDARD_CATEGORIES.ZOO,
  'зоопарк': STANDARD_CATEGORIES.ZOO,
  'atlas': STANDARD_CATEGORIES.OTHER,
  'kmb': STANDARD_CATEGORIES.OTHER,
  'kyiv-modern-ballet': STANDARD_CATEGORIES.OTHER,

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
  'Танці': STANDARD_CATEGORIES.DANCE,
  'Електронна музика': STANDARD_CATEGORIES.ELECTRONIC,
  'Новий рік': STANDARD_CATEGORIES.NEW_YEAR,
  'Творчий вечір': STANDARD_CATEGORIES.CREATIVE_EVENING,
  'Кіно': STANDARD_CATEGORIES.CINEMA,
  'Цирк': STANDARD_CATEGORIES.CIRCUS,
  'Музей': STANDARD_CATEGORIES.MUSEUM,
  'Бізнес': STANDARD_CATEGORIES.BUSINESS,
  'Клуби': STANDARD_CATEGORIES.CLUBS,
  'Філармонія': STANDARD_CATEGORIES.PHILHARMONIC,
  'Планетарій': STANDARD_CATEGORIES.PLANETARIUM,
  'Зоопарк': STANDARD_CATEGORIES.ZOO,
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