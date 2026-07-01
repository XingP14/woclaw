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
});
