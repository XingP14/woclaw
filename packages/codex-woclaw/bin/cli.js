#!/usr/bin/env node
/**
 * woclaw-codex CLI
 * Entry point for npm-installed package.
 * Delegates to the Python install script.
 */

const { spawn } = require("child_process");
const path = require("path");
// chain #10: emoji-decoration helpers (9th subpackage consolidation).
const cliLog = require("../../woclaw-hooks/lib/cli_log");
const { hooksStep, hooksErr } = cliLog;

const action = process.argv[2] || "install";

if (action === "install") {
  hooksStep("Installing WoClaw Codex CLI hooks...");
  const script = path.join(__dirname, "..", "install.py");
  const child = spawn("python3", [script], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
} else if (action === "uninstall") {
  hooksStep("Uninstalling WoClaw Codex CLI hooks...");
  const script = path.join(__dirname, "..", "install.py");
  const child = spawn("python3", [script, "--uninstall"], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
} else {
  hooksErr(`Unknown action: ${action}`);
  hooksErr("Usage: woclaw-codex [install|uninstall]");
  process.exit(1);
}
