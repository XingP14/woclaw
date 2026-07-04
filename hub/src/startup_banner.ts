// hub/src/startup_banner.ts
//
// File-local helpers for hub startup-time console output. Before this
// round, hub/src/index.ts contained 17 inline `console.log(`...`)` call
// sites for the startup banner — 11-line ASCII art header + 12-line
// Configuration dump + 4-line Endpoints banner — plus a 1-site Web UI URL
// line inside the uiServer.listen callback. Two latent risks:
//
//   (1) drift — every new config field required adding a parallel
//       console.log(`  Field: ${value}`) line; easy to forget the 2-space
//       indent or the trailing blank-line separator, and the banner
//       layout silently shifted across crons.
//
//   (2) uniformity — the dump logic + the endpoints banner + the ASCII
//       art header all lived inline in main(), interleaved with hub
//       bootstrap code. A reader scanning for "where does the banner
//       print?" had to grep 17 console.log sites in main() instead of
//       reading 3 helper bodies.
//
// rFIX: extract 3 module-local helpers (printStartupHeader /
// printConfigDump / printEndpointsBanner) here so main() imports them
// and the banner formatting is centralised. Each helper routes its
// output through console.log directly (banner output is not a [WoClaw]-
// prefixed runtime log — it is pre-boot display, so the bare
// console.log is the canonical choice and parallels hubLog's
// console.log routing). The 17 inline console.log sites collapse to 3
// helper calls + 1 sites-conditional Web UI line in the listen callback
// (or 0 lines if the static dir does not exist).
//
// Wire format is byte-identical to pre-refactor inline sites — each
// helper emits exactly the same `console.log(LINE)` shape the inline
// sites used, in the same order.

import { join } from 'path';
import type { Config } from './types.js';

/**
 * Print the ASCII-art `W O C L A W` banner that opens the hub startup
 * sequence. Output is byte-identical to the pre-refactor 12-line console.log
 * block at hub/src/index.ts main() L112-L122 (the art + blank line +
 * "OpenClaw Multi-Agent Communication Hub" subtitle).
 */
export function printStartupHeader(): void {
  console.log(`
  ██████╗ ███████╗██╗   ██╗    ██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗
  ██╔══██╗██╔════╝██║   ██║    ██║     ██║████╗  ██║██║   ██║╚██╗██╔╝
  ██║  ██║█████╗  ██║   ██║    ██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝ 
  ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██║     ██║██║╚██╗██║██║   ██║ ██╔██╗ 
  ██████╔╝███████╗ ╚████╔╝     ███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗
  ╚═════╝ ╚══════╝  ╚═══╝      ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝
  
  OpenClaw Multi-Agent Communication Hub
  `);
}

/**
 * Print the 12-line Configuration dump that follows `hubLog("Configuration:")`.
 * Each line is a `console.log(`  Label: ${value}`)` call — preserving the
 * 2-space indent + the `:` separator + the trailing blank line that was
 * inline at hub/src/index.ts main() L137-L152.
 *
 * Storage sub-block is conditional:
 *   - sqlite → emit "SQLite Path: ..." line
 *   - mysql  → emit "MySQL Host: ..." + "MySQL Database: ..." lines
 *   - other / undefined → emit neither sub-line
 * (matches the pre-refactor if/else if branching; output is byte-identical
 * for any given config.)
 *
 * Auth token is truncated to first 8 chars + `...` to avoid leaking the full
 * secret into the banner (security-sensitive; preserved verbatim).
 */
export function printConfigDump(config: Config): void {
  console.log(`  WebSocket Port: ${config.port}`);
  console.log(`  REST Port: ${config.restPort}`);
  console.log(`  Host: ${config.host}`);
  console.log(`  Data Dir: ${config.dataDir}`);
  console.log(`  Storage: ${config.storage?.type || 'sqlite'}`);
  if (config.storage?.type === 'sqlite') {
    console.log(`  SQLite Path: ${config.storage.sqlitePath || join(config.dataDir, 'woclaw.sqlite')}`);
  } else if (config.storage?.type === 'mysql' && config.storage.mysql) {
    console.log(`  MySQL Host: ${config.storage.mysql.host}:${config.storage.mysql.port || 3306}`);
    console.log(`  MySQL Database: ${config.storage.mysql.database}`);
  }
  console.log(`  Auth Token: ${config.authToken.substring(0, 8)}...`);
  console.log(`  TLS: ${config.tlsKey ? 'enabled (wss:// + https://)' : 'disabled (ws:// + http://)'}`);
  console.log('');
}

/**
 * Print the 4-line Endpoints banner that follows `hubLog("Endpoints:")`.
 * Each line is a `console.log(`  Label: ${url}`)` call — preserving the
 * 2-space indent + the trailing blank line that was inline at
 * hub/src/index.ts main() L201-L207.
 *
 * Optional `uiPort` argument adds a `Web UI: ...` line at the top of the
 * banner (matches the inline `console.log(`  Web UI:    ${url}`)` site
 * inside the uiServer.listen callback — but lifted out so the helper
 * owns the URL format and the 4-space-padded label shape).
 *
 * If `uiPort` is omitted, the Web UI line is not emitted (preserves the
 * pre-refactor gating where the Web UI URL only printed when the static
 * public/ dir existed).
 */
export function printEndpointsBanner(config: Config, uiPort?: number): void {
  const wsProto = config.tlsKey ? 'wss' : 'ws';
  const restProto = config.tlsKey ? 'https' : 'http';
  if (uiPort !== undefined) {
    console.log(`  Web UI:    ${restProto}://${config.host}:${uiPort}`);
  }
  console.log(`  WebSocket: ${wsProto}://${config.host}:${config.port}`);
  console.log(`  REST API:  ${restProto}://${config.host}:${config.restPort}`);
  console.log(`  Graph:     ${restProto}://${config.host}:${config.restPort}/graph/{nodes,edges,stats}`);
  console.log('');
}
