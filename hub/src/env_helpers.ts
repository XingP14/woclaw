// hub/src/env_helpers.ts
//
// Process-env parsing helpers extracted from hub/src/index.ts (2026-10-04
// 00:03 cron).
//
// Why: parseEnvInt / parseEnvString lived as module-private functions in
// index.ts, which ends with a top-level `main().catch(...)` side effect. That
// made the real symbols un-importable from a test — `import '../src/index.js'`
// boots the whole hub. Both functions were therefore covered by
// hub/test/parse_env_int.test.ts and hub/test/parse_env_string.test.ts, which
// each re-declare a local copy described as "copied verbatim from index.ts so
// the test exercises the actual implementation logic". It does not: it is a
// second implementation. A drift between the copy and the original is invisible
// to every assertion in those files, which only pin the SOURCE TEXT of
// index.ts (call counts, regexes over the literal source) plus the copy's own
// behavior.
//
// The same defect was found and fixed for rest_server.ts parseIntParam on
// 2026-10-03 (hub/test/parse_int_param_runtime.test.ts imports the real
// export). The fix there was possible because the helper was already exported.
// Here it is not, so the fix is extraction: move the bodies verbatim into this
// module, export them, and have index.ts import them.
//
// Behavior is byte-identical. The JSDoc contracts were moved with the bodies.

/**
 * Parse an integer-valued process.env variable.
 *
 * Semantics:
 *   - Missing env var OR empty string ('') → `opts.default` if provided,
 *     else `undefined`.
 *   - Present non-empty env var → `parseInt(value, 10)`. Unparseable values
 *     (e.g. PORT=abc) yield NaN — preserved deliberately, so downstream
 *     port validation catches it rather than silently coercing.
 *
 * @param name - process.env variable name (e.g. 'PORT', 'MYSQL_PORT')
 * @param opts.default - default integer to return when env var is missing/empty.
 *                       Omit (or pass undefined) to return undefined instead.
 * @returns parsed integer, default, or undefined
 */
export function parseEnvInt(name: string, opts: { default?: number } = {}): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return opts.default;
  }
  return parseInt(raw, 10);
}

/**
 * Parse a string-valued process.env variable.
 *
 * Semantics:
 *   - Missing env var OR empty string ('') → `opts.default` if provided,
 *     else `undefined`.
 *   - Present non-empty env var → returned verbatim (no trim, no lowercase,
 *     no parse). Preserves the downstream `.toLowerCase()` at the DB_TYPE call
 *     site, where the canonical sqlite/mysql comparison depends on the
 *     lowercase happening in the caller.
 *
 * @param name - process.env variable name (e.g. 'HOST', 'AUTH_TOKEN')
 * @param opts.default - default string to return when env var is missing/empty.
 *                       Omit (or pass undefined) to return undefined instead.
 * @returns parsed string, default, or undefined
 */
export function parseEnvString(name: string, opts: { default?: string } = {}): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return opts.default;
  }
  return raw;
}
