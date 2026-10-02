// Local vitest config for the OpenClaw plugin workspace. See
// ../hub/vitest.config.ts for the original rationale — same purpose: allow
// `npm test` from working-directory: plugin/ to discover a config whose
// `vitest/config` import can resolve (plugin/node_modules also lacks vitest,
// so the repo-root config alone is unresolvable from here).
//
// One deliberate difference from the hub shim, added 2026-10-02 22:03:
// `include` is narrowed to this workspace's own suites instead of
// re-exporting the root config verbatim.
//
// Why the shim alone was not enough. The root config's include globs are
// ABSOLUTE paths rooted at the repo root, so re-exporting it means `npm test`
// from plugin/ collects all 89 repo-wide suites rather than the plugin's 4.
// That is not merely wasteful: some hub suites resolve fixtures by path
// RELATIVE TO CWD, so running them from plugin/ silently changes their
// result. agent_stream_exit_reachability.test.ts is the concrete case — its
// forwardingSites() helper scans hub/src/agent_stream.ts, finds nothing when
// the CWD is plugin/, returns 0 sites, and fails an assertion that is
// meaningful only from the repo root. A test that changes verdict based on the
// directory it was launched from is a latent bug in the suite, but the fix
// here is scope, not a rewrite of someone else's test.
//
// What this replaces. plugin/package.json#scripts.test used to be the literal
// command `vitest run test/channel.test.ts` — a hand-written path to ONE
// suite, and that suite was a no-op (it asserted on its own `ws` mock and on
// vi.clearAllMocks(), importing zero production code; substituting
// `export const channelInstance = null` for plugin/src/channel.ts left it 2/2
// green). So the plugin's whole `npm test`, and the "OpenClaw plugin" CI job
// that runs exactly this script, was verifying nothing. It was also a FILTER
// rather than a scope, which is why deleting the dead file turned CI red —
// "No test files found, exiting with code 1" — and how the problem surfaced.
//
// The plugin's real coverage is not reduced: the root `npm test` still runs
// these same suites through the root config, and
// integration-test/subpackage-pack-files-parity.test.ts independently pins the
// exact set of files the plugin ships in its npm tarball.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
