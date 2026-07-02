// hub/src/scheduler_log.ts
//
// File-local helpers for ForgettingScheduler console output that all share
// the canonical `[ForgettingScheduler] ` prefix. Mirrors the hub logger
// pattern (hub/src/hub_log.ts hubLog/hubWarn/hubError, 07-03 02:03 cron)
// and the federation logger pattern (hub/src/federation.ts fedLog/fedWarn/
// fedError, 07-03 01:33 commit 32501fb) but for the scheduler-scoped
// `[ForgettingScheduler]` prefix used across hub/src/scheduler.ts.
//
// Why: before this round the codebase contained 15 inline
// `console.[log|warn|error]('[ForgettingScheduler] ...')` call sites in
// scheduler.ts (start/stop/runDailyExtractionScan/runWeeklyEviction), each
// duplicating the prefix literal. Two latent risks:
//   (1) drift — a future site could change or omit the prefix and stay silent
//   (2) uniformity — `console.log('[ForgettingScheduler] Queued session X')`
//       mixes template-string + literal-prefix patterns in a way that's
//       hard to grep + lint across the 15 sites
//
// rFIX: extract 3 module-local helpers (schedLog / schedWarn / schedError)
// here so scheduler.ts can import them; each prepends `[ForgettingScheduler] `
// so call sites pass only the message body. The 3 underlying console.* calls
// are confined to the helper bodies. All 15 sites route through the helpers;
// behavior is byte-identical (each helper emits exactly the same
// `console.<level>(`[ForgettingScheduler] ${msg}`, ...args)` shape the inline
// sites used, so downstream log parsers / grep / stdout capture work without
// any change).

/** Log an informational message prefixed with `[ForgettingScheduler]`. */
export function schedLog(msg: string, ...args: unknown[]): void {
  console.log(`[ForgettingScheduler] ${msg}`, ...args);
}

/** Log a warning message prefixed with `[ForgettingScheduler]`. */
export function schedWarn(msg: string, ...args: unknown[]): void {
  console.warn(`[ForgettingScheduler] ${msg}`, ...args);
}

/** Log an error message prefixed with `[ForgettingScheduler]`. */
export function schedError(msg: string, ...args: unknown[]): void {
  console.error(`[ForgettingScheduler] ${msg}`, ...args);
}
