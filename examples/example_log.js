// examples/example_log.js
// Tiny logger helper that prepends `[${AGENT_ID}]` to every line — closes the
// inline-literal `[${AGENT_ID}] ...` duplication that previously lived at 11
// sites inside examples/ws-client.mjs. Wire-format is byte-identical to the
// pre-refactor inline sites:
//
//   exampleLog("Connected to WoClaw Hub")
//     ≡ console.log(`[${AGENT_ID}] Connected to WoClaw Hub`)
//
// Usage:
//   import { exampleLog, exampleWarn, exampleErr } from "./example_log.js";
//   exampleLog("Connected to WoClaw Hub");          // → console.log
//   exampleWarn("rate-limited, backing off");      // → console.warn
//   exampleErr("connection refused:", err.message); // → console.error
//
// AGENT_ID is resolved from process.env at call time (not module-load time)
// so tests that mutate process.env.AGENT_ID between cases observe the new
// value without re-importing the module. Matches the ws-client.mjs top-level
// fallback (`process.env.AGENT_ID || "example-client"`).
//
// Chain context: parallels packages/woclaw-hooks/lib/cli_log.js (chain #10)
// and packages/codex-woclaw-example/example_log.py (chain #11) — same
// helper-extraction-by-prefix pattern, examples becomes the 10th subpackage
// consolidated.

function resolveAgentId() {
  return process.env.AGENT_ID || "example-client";
}

export function exampleLog(msg, ...args) {
  console.log(`[${resolveAgentId()}] ${msg}`, ...args);
}

export function exampleWarn(msg, ...args) {
  console.warn(`[${resolveAgentId()}] ${msg}`, ...args);
}

export function exampleErr(msg, ...args) {
  console.error(`[${resolveAgentId()}] ${msg}`, ...args);
}
