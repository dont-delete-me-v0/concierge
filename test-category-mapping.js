// Test category mapping for concert.ua categories
const { normalizeCategory, STANDARD_CATEGORIES } = require('./packages/database/dist/categories');

const concertUaCategories = [
  'concerts',
  'dance',
  'electronic',
  'excursions',
  'festivals',
  'humor',
  'kids',
  'new-year',
  'other',
  'sport',
  'theater',
  'tvorchii-vechir'
];

console.log('Testing category mapping for concert.ua:\n');
console.log('='.repeat(50));

concertUaCategories.forEach(category => {
  const normalized = normalizeCategory(category);
  console.log(`${category.padEnd(20)} → ${normalized}`);
});

console.log('\n' + '='.repeat(50));
console.log('\nAll standard categories:');
Object.values(STANDARD_CATEGORIES).forEach(cat => {
  console.log(`  • ${cat}`);
});

console.log('\n' + '='.repeat(50));
console.log('\nNew categories that will be created in DB:');
const newCategories = [
  'Театр',
  'Танці',
  'Електронна музика',
  'Новий рік',
  'Творчий вечір'
];

newCategories.forEach(cat => {
  console.log(`  • ${cat}`);
});