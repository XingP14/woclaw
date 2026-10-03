// hub/src/config_file.ts
//
// The CONFIG_FILE load/merge step, extracted from hub/src/index.ts (2026-10-04
// 06:03 cron).
//
// Why: this was the last branch of main() that was neither unreachable-by-
// import nor already covered. index.ts ends with a top-level `main().catch(...)`
// that boots the whole hub (binds a WS server, opens SQLite, starts the
// scheduler), so anything module-private there cannot be imported by a test
// without a real side effect on load. The consequence was the same class
// already fixed three times on this repo (env_helpers.ts, default_config.ts,
// ui_static.ts): the CONFIG_FILE behaviour could only be asserted as source
// text over index.ts, and every such assertion is satisfiable by text that
// never runs.
//
// Concretely, before this extraction nothing observed that:
//   - a config file that is a JSON *scalar* (`"5"`, `null`, `[]`) does not
//     produce a malformed config, and in particular `null` is a no-op spread;
//   - an array-valued file DOES spread its indices onto the config, producing
//     keys like `"0"` that no Config interface ever mentions;
//   - a file that omits `authToken` leaves the base value in place, and a file
//     that sets `authToken: null` overwrites it with a real null that later
//     passes an `if (config.authToken)` truthiness test as "unauthenticated";
//   - malformed JSON and a missing file BOTH reach the same catch, i.e. the
//     failure modes are indistinguishable at this layer.
//
// None of that is observable from a grep over index.ts, and the last two are
// the ones an operator would want a test to pin.
//
// The fix is the same shape as ui_static.ts: move the body verbatim, export
// it, have index.ts import it. Behaviour is byte-identical, including the
// intent that a read/parse failure is NOT handled here — index.ts keeps the
// try/catch and the process.exit(1), because exiting the process is precisely
// the part that must not be reachable from a test.

import { readFileSync } from 'fs';
import type { Config } from './types.js';

/**
 * Read a JSON config file and merge it over `base`.
 *
 * Kept byte-identical to the pre-extraction spread
 * `{ ...config, ...fileConfig }` in main(), including its two sharp edges,
 * which are called out in tests so a future "cleanup" does not silently change
 * behaviour:
 *
 *   - a scalar or `null` JSON file spreads to nothing, leaving `base` intact;
 *   - an array file spreads its indices as string keys.
 *
 * Throws whatever `readFileSync` / `JSON.parse` throw (ENOENT, SyntaxError).
 * The caller is responsible for reporting and exiting.
 */
export function loadConfigFile(configPath: string, base: Config): Config {
  const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  return { ...base, ...fileConfig };
}
