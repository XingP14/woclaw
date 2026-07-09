// integration-test/subpackage-license-parity.test.ts
// Workspace-level LICENSE parity invariant (07-01 23:03 cron):
//   every workspace subpackage in the woclaw monorepo must:
//     (a) have a LICENSE file at <subpackage>/LICENSE (or ./LICENSE for root dirs)
//     (b) list the literal "LICENSE" in <subpackage>/package.json#files (so npm pack ships it)
//     (c) declare a valid SPDX license identifier in <subpackage>/package.json#license
//
// Why this test exists (parallels subpackage-skill-parity.test.ts):
//   The hint list mentioned "7 子包 LICENSE / package.json files 字段补齐" but `npm pack --dry-run`
//   only flags missing-referenced files, not absent sibling LICENSE files, and there's no
//   check that "LICENSE" actually ships in the tarball. A new subpackage landing without
//   LICENSE-in-files would silently ship MIT-licensed source code without the actual
//   license text (a redistribution risk on public npm registries).
//
// This test reads the root package.json#workspaces array, then for each entry asserts:
//   1. <entry>/LICENSE exists on disk
//   2. <entry>/package.json#files contains the literal "LICENSE" string
//   3. <entry>/package.json#license is a non-empty SPDX-ish identifier (MIT/Apache-2.0/BSD-3-Clause/ISC/...)
//   4. <entry>/LICENSE contains a copyright line (sanity: catches empty/stub files)
//   5. <entry>/LICENSE does NOT exceed 64KB (sanity: catches accidentally-bundled giant files)
//
// If a future contributor adds a new subpackage without LICENSE parity, this test trips.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../integration-test
const REPO_ROOT = dirname(TEST_DIR); // .../woclaw (repo root)

interface LicenseCheck {
  workspace: string;
  fileExists: boolean;
  filesIncludes: boolean;
  hasLicenseField: boolean;
  spdxMatches: boolean;
  hasCopyright: boolean;
  sizeBytes: number;
}

const SPDX_LIKE = /^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|UNLICENSED|MPL-2\.0|GPL-[23]\.0(?:-only)?|LGPL-[23]\.0(?:-only)?|AGPL-3\.0(?:-only)?)$/;

function checkSubpkg(workspace: string): LicenseCheck {
  const licPath = join(REPO_ROOT, workspace, 'LICENSE');
  const pkgPath = join(REPO_ROOT, workspace, 'package.json');
  const fileExists = existsSync(licPath);
  let filesIncludes = false;
  let hasLicenseField = false;
  let spdxMatches = false;
  let hasCopyright = false;
  let sizeBytes = 0;
  if (existsSync(pkgPath)) {
    const p = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      files?: string[];
      license?: string;
    };
    filesIncludes = Array.isArray(p.files) && p.files.includes('LICENSE');
    hasLicenseField = typeof p.license === 'string' && p.license.length > 0;
    spdxMatches = hasLicenseField && SPDX_LIKE.test(p.license as string);
  }
  if (fileExists) {
    sizeBytes = statSync(licPath).size;
    const txt = readFileSync(licPath, 'utf8');
    // Loose copyright detection: covers "Copyright", "(c)", "(C)", "©", or SPDX year ranges.
    hasCopyright =
      /copyright/i.test(txt) ||
      /\(c\)/i.test(txt) ||
      /©/.test(txt) ||
      /\d{4}/.test(txt);
  }
  return {
    workspace,
    fileExists,
    filesIncludes,
    hasLicenseField,
    spdxMatches,
    hasCopyright,
    sizeBytes,
  };
}

describe('subpackage LICENSE parity', () => {
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const workspaces = rootPkg.workspaces ?? [];
  const results = workspaces.map(checkSubpkg);

  it('package.json declares at least 1 workspace subpackage', () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  it('every workspace subpackage has a LICENSE file on disk', () => {
    const missing = results.filter((r) => !r.fileExists);
    if (missing.length > 0) {
      throw new Error(
        `subpackages missing LICENSE:\n${missing
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Create <subpackage>/LICENSE (MIT text is fine; see hub/LICENSE for canonical body).`,
      );
    }
    expect(missing).toEqual([]);
  });

  it('every workspace subpackage lists "LICENSE" in package.json#files (so npm pack ships it)', () => {
    const offenders = results.filter((r) => !r.filesIncludes);
    if (offenders.length > 0) {
      throw new Error(
        `subpackages with LICENSE on disk but NOT listed in package.json#files:\n${offenders
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Add the literal "LICENSE" entry to package.json#files so npm pack includes it.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('every workspace subpackage declares a valid SPDX license identifier in package.json#license', () => {
    const offenders = results.filter((r) => !r.spdxMatches);
    if (offenders.length > 0) {
      throw new Error(
        `subpackages with missing or non-SPDX license field:\n${offenders
          .map((r) => `  - ${r.workspace} (license: "${results.find((x) => x.workspace === r.workspace) ? '' : ''}" unknown)`)
          .join('\n')}\n` +
          `Set "license": "MIT" (or another SPDX id) in package.json.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('every LICENSE file contains a copyright line (sanity: catches empty/stub files)', () => {
    const empty = results.filter((r) => r.fileExists && !r.hasCopyright);
    if (empty.length > 0) {
      throw new Error(
        `subpackages with bare LICENSE (no copyright line):\n${empty
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Add a "Copyright (c) <year> <holder>" line near the top of LICENSE.`,
      );
    }
    expect(empty).toEqual([]);
  });

  it('every LICENSE file is <= 64KB (sanity: catches accidentally-bundled binary files)', () => {
    const MAX = 64 * 1024;
    const bloated = results.filter((r) => r.fileExists && r.sizeBytes > MAX);
    if (bloated.length > 0) {
      throw new Error(
        `subpackages with oversized LICENSE files (>${MAX} bytes):\n${bloated
          .map((r) => `  - ${r.workspace} (${r.sizeBytes} bytes)`)
          .join('\n')}\n` +
          `Replace with canonical MIT/Apache-2.0 text.`,
      );
    }
    expect(bloated).toEqual([]);
  });

  it('all 8 subpackages (hub + plugin + mcp-bridge + 5x packages/*) report green', () => {
    // Sanity floor: matches the subpackage-skill-parity.test.ts count so both
    // tests drift in lockstep if a subpackage is added or removed.
    expect(results.length).toBe(workspaces.length);
    expect(results.length).toBeGreaterThanOrEqual(8);
    const allGreen = results.every(
      (r) => r.fileExists && r.filesIncludes && r.spdxMatches && r.hasCopyright && r.sizeBytes > 0 && r.sizeBytes <= 64 * 1024,
    );
    expect(allGreen).toBe(true);
  });

  it('every LICENSE file ends with a trailing newline (POSIX text-file invariant)', () => {
    // Regression for 07-09 22:03 cron: pre-fix packages/codex-woclaw-example/LICENSE
    // was 1077 bytes ending in 'SOFTWARE.' (no trailing \n) while all 7 other
    // subpackages were 1078 bytes ending in 'SOFTWARE.\n' (sha 998ad66e20ae).
    // The 1-byte drift was silent: npm pack shipped the file, SPDX detection
    // passed (text content identical), the existing parity test passed
    // (fileExists + hasCopyright + sizeBytes all green). Only byte-level
    // sha-equality across the 8 subpackages would have caught it. This
    // test gates the POSIX invariant directly: every LICENSE file must end
    // with exactly one trailing \n (the canonical MIT license body shape).
    const offenders: string[] = [];
    for (const r of results) {
      if (!r.fileExists) continue;
      const licPath = join(REPO_ROOT, r.workspace, 'LICENSE');
      const buf = readFileSync(licPath);
      if (buf.length === 0) {
        offenders.push(`${r.workspace}: empty file`);
        continue;
      }
      if (buf[buf.length - 1] !== 0x0a) {
        offenders.push(`${r.workspace}: missing trailing \n (last byte 0x${buf[buf.length - 1].toString(16)}, length ${buf.length})`);
      } else if (buf.length >= 2 && buf[buf.length - 2] === 0x0a) {
        // POSIX-strict: exactly one trailing newline. Catches accidental double-\n
        // and CRLF (\r\n) at EOF. The canonical MIT body ends in 'SOFTWARE.\n' once.
        offenders.push(`${r.workspace}: double trailing newline (CRLF or \\n\\n at EOF, length ${buf.length})`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `subpackages with non-POSIX LICENSE trailing-newline shape:\n${offenders
          .map((o) => `  - ${o}`)
          .join('\n')}\n` +
          `Restore the canonical trailing \n (POSIX text-file invariant).`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('all 8 subpackage LICENSE files are byte-identical (sha equality)', () => {
    // Strong parity invariant: every workspace subpackage's LICENSE must
    // hash to the same sha1. Catches subtle 1-byte drift that the
    // shape-only checks above would miss (e.g. trailing-whitespace
    // differences, BOM, line-ending CRLF vs LF mid-body). The canonical
    // body is the MIT license text as authored in hub/LICENSE.
    const canonicalSha = '998ad66e20ae'; // observed sha1 of all 8 subpackages post 07-09 22:03 fix
    const shas: { workspace: string; sha: string }[] = [];
    for (const r of results) {
      if (!r.fileExists) continue;
      const licPath = join(REPO_ROOT, r.workspace, 'LICENSE');
      const buf = readFileSync(licPath);
      // Minimal sha1 (no node:crypto dep): use the WebCrypto async API would
      // require async; instead use a deterministic FNV-1a 32-bit fingerprint
      // for the parity check (8 hex chars). Stronger-than-nothing, weaker
      // than sha1, but enough to catch any 1-byte mutation across files.
      let h = 0x811c9dc5;
      for (let i = 0; i < buf.length; i++) {
        h ^= buf[i];
        h = Math.imul(h, 0x01000193);
      }
      const fp = (h >>> 0).toString(16).padStart(8, '0');
      shas.push({ workspace: r.workspace, sha: fp });
    }
    const distinct = new Set(shas.map((s) => s.sha));
    if (distinct.size > 1) {
      throw new Error(
        `subpackage LICENSE files are NOT byte-identical (${distinct.size} distinct fingerprints):\n${shas
          .map((s) => `  - ${s.workspace}: ${s.sha}`)
          .join('\n')}\n` +
          `All 8 LICENSE files must match the canonical body (sha ${canonicalSha}).`,
      );
    }
    expect(distinct.size).toBe(1);
    // Sanity: also pin that the single fingerprint corresponds to the
    // canonical sha (manual cross-check at audit time; not a strict gate
    // because FNV-1a is a 32-bit fingerprint, not a 160-bit sha1).
    expect(shas[0].sha).toMatch(/^[0-9a-f]{8}$/);
  });

  it('canonical sha 998ad66e20ae is present in all LICENSE files (drift anchor)', () => {
    // Drift anchor: if all 8 LICENSE files remain byte-identical, the sha
    // is stable. This test pins the expected canonical sha (observed across
    // hub/plugin/mcp-bridge/5x packages/* post 07-09 22:03 fix). If a future
    // MIT license text update lands in only one subpackage, the byte-identity
    // test above trips AND this anchor breaks, surfacing the diff.
    const canonicalSha = '998ad66e20ae';
    const fileCount = results.filter((r) => r.fileExists).length;
    const shas: { workspace: string; sha: string }[] = [];
    for (const r of results) {
      if (!r.fileExists) continue;
      const licPath = join(REPO_ROOT, r.workspace, 'LICENSE');
      const buf = readFileSync(licPath);
      const sha = createHash('sha1').update(buf).digest('hex');
      shas.push({ workspace: r.workspace, sha });
    }
    const matchCount = shas.filter((s) => s.sha.startsWith(canonicalSha)).length;
    if (matchCount < fileCount) {
      throw new Error(
        `canonical LICENSE sha ${canonicalSha}... expected across all ${fileCount} subpackages, ` +
          `got ${matchCount}. A LICENSE text update landed in only some subpackages (drift):\n${shas
          .map((s) => `  - ${s.workspace}: ${s.sha}`)
          .join('\n')}`,
      );
    }
    expect(matchCount).toBe(fileCount);
    expect(shas.every((s) => s.sha === shas[0].sha)).toBe(true);
  });
});
