// Local vitest config for the hub workspace. Re-exports the repo-root
// config so `npm test` (run with working-directory: hub/) finds a
// config it can load — the root config's `import 'vitest/config'`
// resolves from hub/node_modules, which lacks vitest.
//
// See .github/workflows/ci.yml matrix "Hub" job for the working-directory
// that triggers this lookup. The OpenClaw-plugin and Hub matrix jobs
// both cd into their subdir before running `npm test`, so without this
// shim the test command fails with "Cannot find module 'vitest/config'".
import rootConfig from '../vitest.config';
export default rootConfig;
