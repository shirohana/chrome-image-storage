import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
      },
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Prevent missing await - warn for now, will fix gradually
      // This catches bugs like the rating filter issue we just fixed
      '@typescript-eslint/no-floating-promises': 'warn',

      // Warn on inconsistent return of awaited values
      '@typescript-eslint/return-await': 'warn',

      // Warn on async functions that don't await anything
      '@typescript-eslint/require-await': 'warn',

      // Allow unused vars with underscore prefix
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // Downgrade regex escape warnings
      'no-useless-escape': 'warn',
    },
  },
];
