import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [path.resolve(__dirname, 'hub/test/**/*.test.ts'), path.resolve(__dirname, 'plugin/test/**/*.test.ts')],
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
