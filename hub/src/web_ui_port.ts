// hub/src/web_ui_port.ts
//
// R514 — the Web UI port must be DERIVED from the environment.
//
// THE DEFECT (measured, not suspected).
//
// `hub/src/index.ts` hardcoded the Web UI's port:
//
//     const uiPort = 8084;
//
// while TWO test suites already set a `WEB_UI_PORT` environment variable on
// the hub they boot, expecting the hub to honour it:
//
//     test/r487_config_auth_token_type_crash.test.ts:183
//         WEB_UI_PORT: String(restPort + 1),
//     test/r488_rotation_durability.test.ts:381
//         WEB_UI_PORT: String(args.restPort + 2),
//
// The knob was INERT: the variable was set by the callers and read by nobody.
// Measured on this tree (2026-10-28 03:0x CST), booting the REAL entrypoint
// with `WEB_UI_PORT=29150`:
//
//     [WoClaw] Endpoints:
//       Web UI:    http://127.0.0.1:8084        <-- NOT 29150
//     $ ss -ltn | grep -E ':29150|:8084'
//     LISTEN 0 511  *:8084  *:*                 <-- bound 8084 anyway
//
// WHY IT MATTERS BEYOND THE TEST SUITE.
//
// A fixed port is a SHARED RESOURCE: every hub on a host contends for 8084,
// so the failure lands on whoever boots SECOND, and it lands on a suite that
// does not own the subject. Measured here: `r487`'s negative control asserts
// the boot banner contains no `EADDRINUSE`; with another hub already holding
// 8084, `r487` goes RED with
//
//     "Web UI server failed to bind port 8084: EADDRINUSE ..."
//
// — a red arm whose subject is the config-file crash, not the port. The
// collision is a property of the HOST, so it is also invisible on a CI
// runner (one hub per runner) and only appears locally.
//
// THE CONTRACT.
//
//   missing / empty          -> the documented default, 8084
//   a decimal integer 1..65535 -> that port
//   anything else            -> the documented default, 8084, and the
//                                caller WARNS (a malformed knob must not
//                                crash the hub, and must not silently
//                                become a random port)
//
// The resolution is a PURE function so it can be measured without booting a
// hub — the same extraction discipline `env_helpers.ts` established for the
// env parsers (see the header of that file for why a copy in a test is a
// defect).

/** The documented default Web UI port. */
export const DEFAULT_WEB_UI_PORT = 8084;

/** The smallest port number a TCP listener may bind. */
const MIN_PORT = 1;

/** The largest port number a TCP listener may bind. */
const MAX_PORT = 65535;

export interface WebUiPortResolution {
  /** The port the Web UI server should listen on. */
  port: number;
  /**
   * True when the environment named a value that could not be used and the
   * default was substituted. The caller warns on this; it must never be
   * silent, because a silently-substituted port is the same class of defect
   * as an unread knob.
   */
  invalid: boolean;
}

/**
 * Resolve the Web UI port from a raw environment value.
 *
 * @param raw - the raw `WEB_UI_PORT` value, or undefined when unset.
 * @returns the port to bind and whether the supplied value was unusable.
 */
export function resolveWebUiPort(raw: string | undefined): WebUiPortResolution {
  if (raw === undefined || raw === '') {
    return { port: DEFAULT_WEB_UI_PORT, invalid: false };
  }

  // A strict integer check, NOT `parseInt`: `parseInt('8084x', 10)` yields
  // 8084, so a value with a trailing garbage suffix would be silently
  // ACCEPTED as 8084 — which is the "a misspelled key is silent" shape
  // R512 measured in the config file. The whole string must be the
  // decimal number.
  if (!/^\d+$/.test(raw)) {
    return { port: DEFAULT_WEB_UI_PORT, invalid: true };
  }

  const parsed = parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return { port: DEFAULT_WEB_UI_PORT, invalid: true };
  }

  return { port: parsed, invalid: false };
}
