import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['hub/test/**/*.test.ts', 'plugin/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['hub/src/**/*.ts', 'plugin/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.js'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@hub': path.resolve(__dirname, './hub/src'),
      '@plugin': path.resolve(__dirname, './plugin/src'),
    },
  },
});
