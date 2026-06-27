// Local vitest config for the OpenClaw plugin workspace. See
// ../hub/vitest.config.ts for the rationale — same shape, same purpose:
// allow `npm test` from working-directory: plugin/ to discover a config
// whose `vitest/config` import can resolve (plugin/node_modules also
// lacks vitest, so the repo-root config alone is unresolvable from here).
import rootConfig from '../vitest.config';
export default rootConfig;
