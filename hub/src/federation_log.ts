// hub/src/federation_log.ts
//
// Module-local helpers for FederationManager (and any cross-file caller that
// wants the same `[WoClaw Federation] ` prefix) console output. Parallels the
// hub logger pattern (hub/src/hub_log.ts hubLog/hubWarn/hubError, 07-03 02:03
// commit 3a2bdc4), the scheduler logger pattern (hub/src/scheduler_log.ts
// schedLog/schedWarn/schedError, 07-03 06:23 commit 17d2060), and the db
// logger pattern (hub/src/db_log.ts dbLog/dbWarn/dbError, 07-03 22:03 commit
// ac984c8). The federation prefix was previously file-local to
// hub/src/federation.ts (16 sites inside one file), but two inline sites in
// hub/src/ws_server.ts (L65 + L74) also duplicated the `[WoClaw Federation] `
// literal — those couldn't import the file-local helpers and so rolled their
// own prefix, drifting outside the chain. Lifting the helpers into a
// dedicated module makes them reusable from any caller.
//
// Why: before this round the codebase contained 16 + 2 = 18 inline
// `console.[log|warn|error]('[WoClaw Federation] ...')` call sites split
// across federation.ts (16) and ws_server.ts (2), each duplicating the
// `[WoClaw Federation] ` prefix literal. Two latent risks:
//   (1) drift — a future site could change or omit the prefix and stay silent
//   (2) uniformity — `console.log('[WoClaw Federation] Received federated
//       memory ...')` mixes template-string + literal-prefix patterns in a
//       way that's hard to grep + lint across both files
//
// rFIX: extract 3 module-local helpers (fedLog / fedWarn / fedError) here so
// federation.ts and ws_server.ts can both import them; each prepends
// `[WoClaw Federation] ` so call sites pass only the message body. The 3
// underlying console.* calls are confined to the helper bodies. All 18 sites
// (16 federation.ts + 2 ws_server.ts) route through the helpers; behavior is
// byte-identical (each helper emits exactly the same
// `console.<level>(`[WoClaw Federation] ${msg}`, ...args)` shape the inline
// sites used, so downstream log parsers / grep / stdout capture work without
// any change).

/** Log an informational message prefixed with `[WoClaw Federation]`. */
export function fedLog(msg: string, ...args: unknown[]): void {
  console.log(`[WoClaw Federation] ${msg}`, ...args);
}

/** Log a warning message prefixed with `[WoClaw Federation]`. */
export function fedWarn(msg: string, ...args: unknown[]): void {
  console.warn(`[WoClaw Federation] ${msg}`, ...args);
}

/** Log an error message prefixed with `[WoClaw Federation]`. */
export function fedError(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw Federation] ${msg}`, ...args);
}
