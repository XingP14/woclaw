// Per-tick coverage probe for a SINGLE file. Same shape and same reason as
// llm-benchmark's jest.probe.config.js.
//
// Why it exists: measuring one file's dark branches means narrowing the coverage
// scope, which still writes into the repo's own coverage/ directory. Any test
// that reads coverage/coverage-summary.json off disk then picks up the probe's
// numbers on the next real run. That self-contamination was actually observed in
// llm-benchmark on 2026-10-02 03:03, where the probe's write caused four
// unrelated failures in tests/verify-coverage-thresholds-script.test.ts.
//
// So this config pins reportsDirectory at _tmp/scratch/coverage-probe and never
// touches coverage/. Use it as:
//
//   npx vitest run --config vitest.probe.config.js --coverage
//
// HARNESS RULE: a run printing `Tests: 0 total` is a HARD HARNESS ERROR, never a
// result. A suite that fails to compile exits with zero failed tests, so a
// failure-only count reads it as a clean green.
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [path.resolve(root, 'plugin/test/**/*.test.ts')],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  coverage: {
    enabled: true,
    provider: 'v8',
    reporter: ['json', 'text'],
    // Scope is the file under probe only, so the denominator is that file and
    // not the whole workspace. EDIT THIS LINE to re-point the probe.
    include: ['plugin/src/channel.ts'],
    exclude: ['**/*.d.ts', '**/*.js'],
    // v8 coverage writes to the CLI --coverage.reportsDirectory, not to the
    // config's coverage object, so the pin has to happen on the command line.
    // Any test that reads coverage/coverage-summary.json off disk then picks up
    // the probe's numbers on the next real run, which is self-contamination.
    // Invoke as:
    //   npx vitest run --config vitest.probe.config.js --coverage \
    //     --coverage.reportsDirectory=_tmp/scratch/coverage-probe
    reportsDirectory: path.resolve(root, '_tmp/scratch/coverage-probe'),
  },
  resolve: {
    alias: {
      '@hub': path.resolve(root, 'hub/src'),
      '@plugin': path.resolve(root, 'plugin/src'),
    },
  },
});
