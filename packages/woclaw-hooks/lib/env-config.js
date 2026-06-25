// packages/woclaw-hooks/lib/env-config.js
//
// Robust .env-style key=value parser + writer, extracted from install.js.
//
// Why extracted: install.js originally inlined a 1-regex parser that
//   1) included inline `# comment` text in unquoted values
//      (e.g. WOCLAW_HUB_URL=http://x # prod → "http://x # prod")
//   2) failed on lines with whitespace around `=` (no match → silent skip)
//   3) failed on lines with leading whitespace (no match → silent skip)
// Both bugs were surfaced by the 03:03 cron tick on 2026-06-26 and
// fixed here so future env edits are predictable.
//
// Behaviour is 100% compatible with the prior canonical save format:
//   KEY="VALUE"     (default; matches what saveConfig() writes)
//   KEY=VALUE       (unquoted; allowed)
//   KEY=VALUE # ... (trailing # comment is stripped when not inside quotes)
//   # leading comment lines are ignored
//   blank lines are ignored
//   surrounding whitespace around KEY and VALUE is trimmed
//   values may contain '=' (regex splits on the FIRST '=' only)
//   quoted values preserve internal whitespace, '#', and '=' literally
//
// No external dependencies; uses only Node builtins so the lib can be
// required by install.js (CJS) and by the integration test (vitest ESM
// or CJS via require()).

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Default fallback config used when no env file exists.
 * Mirrors DEFAULT_CONFIG in install.js.
 */
const DEFAULT_CONFIG = Object.freeze({
  WOCLAW_HUB_URL: 'http://vm153:8083',
  WOCLAW_TOKEN: 'WoClaw2026',
  WOCLAW_PROJECT_KEY: 'project:context',
});

/**
 * Parse the textual content of an env file into a plain object.
 * Exported for direct unit testing (no fs needed).
 *
 * @param {string} content  raw .env file content
 * @returns {Object<string,string>}
 */
function parseEnvContent(content) {
  const out = {};
  if (typeof content !== 'string' || !content) return out;
  for (let rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    // Split on the FIRST '=' so values may contain '='.
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    // Trim leading whitespace on the value side so `KEY = "V"` (space
    // around '=') is parsed the same as `KEY="V"`.
    let value = line.slice(eq + 1).trimStart();

    // If value starts with a quote, find the matching close quote and
    // take everything literally (preserves '#', '=', spaces).
    // If no close quote is found, fall through to the unquoted branch
    // (handles the lenient saveConfig-style `KEY="VALUE"` form too).
    if (value.startsWith('"')) {
      const closeIdx = value.indexOf('"', 1);
      if (closeIdx !== -1) {
        value = value.slice(1, closeIdx);
      } else {
        // Mismatched quote: take everything after the opening quote,
        // strip a possible trailing inline comment, trim.
        value = value.slice(1);
        const hash = value.indexOf(' #');
        if (hash !== -1) value = value.slice(0, hash);
        value = value.trim();
      }
    } else {
      // Unquoted: trim and strip an inline " # comment" tail if present.
      value = value.trim();
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load config from an env file, merged on top of .
 * Missing file → returns a copy of .
 * Defaults to DEFAULT_CONFIG; pass an env-override-aware config to
 * preserve process.env precedence in callers like install.js.
 *
 * @param {string} envFile  absolute path to the .env file
 * @param {Object<string,string>} [defaults=DEFAULT_CONFIG]  base config to merge onto
 * @returns {Object<string,string>}
 */
function loadExistingConfig(envFile, defaults = DEFAULT_CONFIG) {
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    const parsed = parseEnvContent(content);
    return { ...defaults, ...parsed };
  }
  return { ...defaults };
}

/**
 * Serialise a config object to canonical .env format
 * (KEY="VALUE" per line, single trailing newline).
 *
 * @param {Object<string,string>} config
 * @returns {string}
 */
function serialiseConfig(config) {
  return (
    Object.entries(config)
      .map(([k, v]) => `${k}="${v}"`)
      .join('\n') + '\n'
  );
}

/**
 * Write a config object to the given env file path, creating parent
 * directories as needed. Mirrors saveConfig() in install.js but takes
 * the target path as an argument so it's directly unit-testable.
 *
 * @param {string} envFile  absolute path
 * @param {Object<string,string>} config
 */
function saveConfig(envFile, config) {
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, serialiseConfig(config));
}

module.exports = {
  DEFAULT_CONFIG,
  parseEnvContent,
  loadExistingConfig,
  serialiseConfig,
  saveConfig,
};
