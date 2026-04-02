import { defineConfig } from '/opt/openclaw/app/node_modules/vitest/dist/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
