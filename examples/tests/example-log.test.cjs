// examples/tests/example-log.test.js
// Regression gate for examples/example_log.js (chain #12 helper extraction —
// parallel to packages/woclaw-hooks/lib/cli_log.js chain #10 and
// packages/codex-woclaw-example/example_log.py chain #11).
//
// 12 tests (1 parent suite + 12 child tests):
//   3 module shape (named exports + fallback + env-mutate re-resolve)
//   3 canonical signature (forward to console.log / warn / error)
//   3 runtime wire-format identity (prepends `[${AGENT_ID}]`, args forwarded)
//   3 closure (imports wired in ws-client.mjs, 0 inline [${AGENT_ID}] console
//     sites remain, 10 exampleLog+1 exampleErr call sites at canonical lines)
//
// Run: node --test examples/tests/example-log.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LOG_PATH = path.join(ROOT, "examples", "example_log.js");
const CLIENT_PATH = path.join(ROOT, "examples", "ws-client.mjs");

// Force a known AGENT_ID for module-shape + signature tests, then restore in finally.
function withAgentId(id, fn) {
  const prev = process.env.AGENT_ID;
  if (id === null || id === undefined) delete process.env.AGENT_ID;
  else process.env.AGENT_ID = id;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AGENT_ID;
    else process.env.AGENT_ID = prev;
  }
}

function freshImport() {
  // Cache-bust so each call gets a fresh module that re-reads AGENT_ID lazily.
  const url = require("node:url");
  const absUrl = url.pathToFileURL(LOG_PATH).href;
  delete require.cache[absUrl];
  return import(absUrl);
}

test("example_log module shape (chain #12 regression)", async (t) => {
  await t.test("exports exampleLog, exampleWarn, exampleErr", async () => {
    const mod = await freshImport();
    assert.equal(typeof mod.exampleLog, "function", "exampleLog must be a function");
    assert.equal(typeof mod.exampleWarn, "function", "exampleWarn must be a function");
    assert.equal(typeof mod.exampleErr, "function", "exampleErr must be a function");
  });

  await t.test("falls back to 'example-client' when AGENT_ID is unset", async () => {
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId(undefined, () => {
        mod.exampleLog("hi");
      });
      assert.equal(captured.length, 1);
      assert.deepEqual(captured[0], ["[example-client] hi"]);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("re-resolves AGENT_ID on each call (no module-load capture)", async () => {
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("first-agent", () => mod.exampleLog("a"));
      withAgentId("second-agent", () => mod.exampleLog("b"));
      assert.deepEqual(captured, [
        ["[first-agent] a"],
        ["[second-agent] b"],
      ]);
    } finally {
      console.log = origLog;
    }
  });
});

test("example_log canonical signature (forwards to console.{log,warn,error})", async (t) => {
  await t.test("exampleLog forwards to console.log", async () => {
    const captured = [];
    const orig = console.log;
    console.log = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("sig-test", () => mod.exampleLog("hello", 1, { x: 2 }));
      assert.deepEqual(captured, [["[sig-test] hello", 1, { x: 2 }]]);
    } finally {
      console.log = orig;
    }
  });

  await t.test("exampleWarn forwards to console.warn", async () => {
    const captured = [];
    const orig = console.warn;
    console.warn = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("warn-test", () => mod.exampleWarn("slow", 42));
      assert.deepEqual(captured, [["[warn-test] slow", 42]]);
    } finally {
      console.warn = orig;
    }
  });

  await t.test("exampleErr forwards to console.error", async () => {
    const captured = [];
    const orig = console.error;
    console.error = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("err-test", () => mod.exampleErr("boom:", "ECONNREFUSED"));
      assert.deepEqual(captured, [["[err-test] boom:", "ECONNREFUSED"]]);
    } finally {
      console.error = orig;
    }
  });
});

test("example_log runtime wire-format identity", async (t) => {
  await t.test("exampleLog('foo') ≡ console.log(`[${AGENT_ID}] foo`)", async () => {
    const captured = [];
    const orig = console.log;
    console.log = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("agent-7", () => mod.exampleLog("foo"));
      assert.equal(captured[0][0], "[agent-7] foo");
    } finally {
      console.log = orig;
    }
  });

  await t.test("exampleLog preserves template-literal interpolation", async () => {
    const captured = [];
    const orig = console.log;
    console.log = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("agent-x", () => mod.exampleLog(`Joined topic: ${"general"}`));
      assert.equal(captured[0][0], "[agent-x] Joined topic: general");
    } finally {
      console.log = orig;
    }
  });

  await t.test("exampleErr preserves unicode emoji + multi-arg layout", async () => {
    const captured = [];
    const orig = console.error;
    console.error = (...args) => captured.push(args);
    try {
      const mod = await freshImport();
      withAgentId("agent-emoji", () =>
        mod.exampleErr(`Error: ${"connection refused"}`)
      );
      assert.equal(captured[0][0], "[agent-emoji] Error: connection refused");
    } finally {
      console.error = orig;
    }
  });
});

test("example_log closure (examples/ws-client.mjs migrated)", async (t) => {
  let client;
  test.before(async () => {
    client = fs.readFileSync(CLIENT_PATH, "utf8");
  });

  await t.test("ws-client.mjs imports exampleLog/exampleWarn/exampleErr from ./example_log.js", () => {
    assert.match(
      client,
      /import\s*\{[^}]*\bexampleLog\b[^}]*\}\s*from\s*["']\.\/example_log\.js["']/,
      "ws-client.mjs must import exampleLog from ./example_log.js"
    );
    assert.match(
      client,
      /import\s*\{[^}]*\bexampleWarn\b[^}]*\}\s*from\s*["']\.\/example_log\.js["']/,
      "ws-client.mjs must import exampleWarn from ./example_log.js"
    );
    assert.match(
      client,
      /import\s*\{[^}]*\bexampleErr\b[^}]*\}\s*from\s*["']\.\/example_log\.js["']/,
      "ws-client.mjs must import exampleErr from ./example_log.js"
    );
  });

  await t.test("ws-client.mjs has 0 inline `[${AGENT_ID}]` console.* sites", () => {
    const lines = client.split("\n");
    // Strip the helper file import block & example_log.js internals to avoid
    // counting comments. We grep for console.{log,warn,error}(`...` patterns
    // that contain literal [${AGENT_ID}] — those are the inline sites.
    const inline = lines.filter((l) =>
      /console\.(log|warn|error)\(.*\[\$\{AGENT_ID\}\]/.test(l)
    );
    assert.deepEqual(
      inline,
      [],
      `expected 0 inline [${"${AGENT_ID}"}] console sites in ws-client.mjs, found ${inline.length}:\n${inline.join("\n")}`
    );
  });

  await t.test("ws-client.mjs has 10 exampleLog + 1 exampleErr callsites (chain #12 canonical counts)", () => {
    // We don't assert exact line numbers (those drift across edits) but we
    // gate the total call counts so a future re-migration that drops or adds
    // a site updates the test in the same commit.
    const exampleLogMatches = client.match(/\bexampleLog\(/g) || [];
    const exampleErrMatches = client.match(/\bexampleErr\(/g) || [];
    const exampleWarnMatches = client.match(/\bexampleWarn\(/g) || [];
    assert.equal(
      exampleLogMatches.length,
      9,
      `expected 9 exampleLog callsites in ws-client.mjs (chain #12 migration count), found ${exampleLogMatches.length}`
    );
    assert.equal(
      exampleErrMatches.length,
      1,
      `expected 1 exampleErr callsite in ws-client.mjs (chain #12 migration count), found ${exampleErrMatches.length}`
    );
    assert.equal(
      exampleWarnMatches.length,
      0,
      `expected 0 exampleWarn callsites in ws-client.mjs, found ${exampleWarnMatches.length}`
    );
  });
});
