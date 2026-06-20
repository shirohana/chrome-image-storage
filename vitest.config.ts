import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  // Solid needs its dev/browser build in tests for reactivity to work.
  resolve: { conditions: ['development', 'browser'] },
  test: {
    globals: true,
    environment: 'node', // Pure functions don't need jsdom; DOM tests opt into happy-dom per-file
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
