#!/usr/bin/env node
/**
 * woclaw-codex CLI
 * Entry point for npm-installed package.
 * Delegates to the Python install script.
 */

const { spawn } = require("child_process");
const path = require("path");

const action = process.argv[2] || "install";

if (action === "install") {
  console.log("Installing WoClaw Codex CLI hooks...");
  const script = path.join(__dirname, "..", "install.py");
  const child = spawn("python3", [script], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
} else if (action === "uninstall") {
  console.log("Uninstalling WoClaw Codex CLI hooks...");
  const script = path.join(__dirname, "..", "install.py");
  const child = spawn("python3", [script, "--uninstall"], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
} else {
  console.error(`Unknown action: ${action}`);
  console.error("Usage: woclaw-codex [install|uninstall]");
  process.exit(1);
}
