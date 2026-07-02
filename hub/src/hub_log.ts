// hub/src/hub_log.ts
//
// File-local helpers for hub-internal console output that all share the
// canonical `[WoClaw] ` prefix. Mirrors the federation logger pattern
// (federation.ts fedLog/fedWarn/fedError, see 07-03 01:33 commit 32501fb)
// but for the top-level `[WoClaw]` prefix used across rest_server.ts /
// ws_server.ts / index.ts / session_archive.ts / memory.ts.
//
// Why: before this round the codebase contained 28 inline
// `console.[log|warn|error]('[WoClaw] ...')` call sites, each duplicating
// the prefix literal. Two latent risks:
//   (1) drift — a future site could change or omit the prefix and stay silent
//   (2) uniformity — `console.error('[WoClaw] REST error:',
//       errorMessage(e))` mixes template-string and helper patterns in a way
//       that's hard to grep + lint
//
// rFIX: extract 3 module-local helpers (hubLog / hubWarn / hubError) here so
// rest_server.ts / ws_server.ts / index.ts / session_archive.ts / memory.ts
// can import them; each prepends `[WoClaw] ` so call sites pass only the
// message body. The 3 underlying console.* calls are confined to the helper
// bodies. All 28 sites route through the helpers; behavior is byte-identical
// (the wire format preserved because each helper emits exactly the same
// `console.<level>(`[WoClaw] ${msg}`, ...args)` shape the inline sites used).

/** Log an informational message prefixed with `[WoClaw]`. */
export function hubLog(msg: string, ...args: unknown[]): void {
  console.log(`[WoClaw] ${msg}`, ...args);
}

/** Log a warning message prefixed with `[WoClaw]`. */
export function hubWarn(msg: string, ...args: unknown[]): void {
  console.warn(`[WoClaw] ${msg}`, ...args);
}

/** Log an error message prefixed with `[WoClaw]`. */
export function hubError(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}
