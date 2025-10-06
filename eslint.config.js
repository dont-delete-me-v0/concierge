import eslintConfig from './packages/eslint-config/eslint.config.js';

export default [
  ...eslintConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.turbo/**',
      '*.log',
      '.env*',
      'coverage/**',
      '.nyc_output/**',
    ],
  },
];
