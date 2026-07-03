// hub/src/db_log.ts
//
// File-local helpers for ClawDB (storage layer) console output that all
// share the canonical `[ClawDB] ` prefix. Mirrors the hub logger pattern
// (hub/src/hub_log.ts hubLog/hubWarn/hubError, 07-03 02:03 commit 3a2bdc4),
// the scheduler logger pattern (hub/src/scheduler_log.ts schedLog/schedWarn/
// schedError, 07-03 06:23 commit 17d2060), and the federation logger
// pattern (hub/src/federation.ts fedLog/fedWarn/fedError, 07-03 01:33
// commit 32501fb) but for the storage-scoped `[ClawDB]` prefix used across
// hub/src/db.ts.
//
// Why: before this round the codebase contained 2 inline
// `console.error('[ClawDB] ...')` call sites in db.ts (legacy JSON store
// import paths, L540 SQLite + L1087 MySQL), each duplicating the prefix
// literal. Two latent risks:
//   (1) drift — a future site could change or omit the prefix and stay silent
//   (2) uniformity — `console.error('[ClawDB] Failed to import legacy JSON
//       store:', errorMessage(e))` mixes template-string + helper patterns
//       in a way that's hard to grep + lint across 2 sites
//
// rFIX: extract 3 module-local helpers (dbLog / dbWarn / dbError) here so
// db.ts can import them; each prepends `[ClawDB] ` so call sites pass only
// the message body. The 3 underlying console.* calls are confined to the
// helper bodies. Both sites route through the helpers; behavior is
// byte-identical (the wire format preserved because each helper emits
// exactly the same `console.<level>(`[ClawDB] ${msg}`, ...args)` shape the
// inline sites used).

/** Log an informational message prefixed with `[ClawDB]`. */
export function dbLog(msg: string, ...args: unknown[]): void {
  console.log(`[ClawDB] ${msg}`, ...args);
}

/** Log a warning message prefixed with `[ClawDB]`. */
export function dbWarn(msg: string, ...args: unknown[]): void {
  console.warn(`[ClawDB] ${msg}`, ...args);
}

/** Log an error message prefixed with `[ClawDB]`. */
export function dbError(msg: string, ...args: unknown[]): void {
  console.error(`[ClawDB] ${msg}`, ...args);
}
