import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Pure functions don't need jsdom
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/viewer/index.ts', // Skip UI glue code for now
        'src/background/**', // Skip Chrome extension APIs
        'src/content/**',
      ],
    },
  },
});
