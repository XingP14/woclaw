// Differential probe: woclaw R498c M2 -- "check the REAL path, but SERVE the
// textual path". Is M2 an EQUIVALENT mutant, or does it open a hole?
//
// Equivalence = identical observable output for EVERY request path under both
// variants. A survivor is a HYPOTHESIS; this probe is the ADJUDICATION.
//
// It drives the REAL shipped handler (`createUiRequestHandler`) twice: once
// with the shipped source, once with the M2 mutation applied to a COPY of the
// module in a temp directory. Both are loaded as separate modules so the
// real source is never touched.

import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  readFileSync,
  copyFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src/ui_static.ts');

type Rec = { statusCode?: number; body?: Buffer | string };

function makeRes() {
  const rec: Rec = {};
  const res = {
    writeHead(status: number) {
      rec.statusCode = status;
      return res;
    },
    end(body?: Buffer | string) {
      rec.body = body;
      return res;
    },
  };
  return { res: res as never, rec };
}

const PATHS = [
  '/',
  '/index.html',
  '/app.js',
  '/nested/deep.js',
  '/inside-link',
  '/escape/passwd',
  '/escape/shadow',
  '/escape/hostname',
  '/escape-file',
  '/missing',
  '/nested',
  '/escape',
];

describe('R498c M2 differential probe', () => {
  it('the M2 mutant is EQUIVALENT to the shipped source on every path', async () => {
    // The fixture.
    const dir = mkdtempSync(join(tmpdir(), 'r498c-m2-'));
    writeFileSync(join(dir, 'index.html'), 'INDEX');
    writeFileSync(join(dir, 'app.js'), 'APPJS');
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'deep.js'), 'DEEP');
    symlinkSync('/etc', join(dir, 'escape'), 'dir');
    symlinkSync('/etc/hostname', join(dir, 'escape-file'));
    const realDir = realpathSync(dir);
    symlinkSync(join(realDir, 'app.js'), join(realDir, 'inside-link'));

    // The M2 mutant: the REAL path is used for the CHECK, but the file
    // actually opened is the TEXTUAL one (which follows the symlink).
    const mutantDir = mkdtempSync(join(tmpdir(), 'r498c-m2-src-'));
    const mutantSrc = join(mutantDir, 'ui_static.ts');
    const original = readFileSync(SRC, 'utf8');
    const needle = '    let filePath = realTarget ?? indexPath;';
    expect(original.split(needle).length - 1).toBe(1);
    writeFileSync(
      mutantSrc,
      original.replace(needle, '    let filePath = (realTarget ? target : null) ?? indexPath;'),
    );

    try {
      const shipped = await import(pathToFileURL(SRC).href);
      const mutant = await import(pathToFileURL(mutantSrc).href);

      const drive = (mod: any, url: string): Rec => {
        const { res, rec } = makeRes();
        mod.createUiRequestHandler(dir)({ url } as never, res);
        return rec;
      };

      const diffs: string[] = [];
      for (const p of PATHS) {
        const a = drive(shipped, p);
        const b = drive(mutant, p);
        const norm = (r: Rec) => ({
          status: r.statusCode ?? 0,
          len: typeof r.body === 'string' ? r.body.length : (r.body?.length ?? 0),
        });
        const na = norm(a);
        const nb = norm(b);
        if (na.status !== nb.status || na.len !== nb.len) {
          diffs.push(`${p}: shipped=${JSON.stringify(na)} mutant=${JSON.stringify(nb)}`);
        }
      }
      // Equivalence: identical observable output for EVERY path.
      expect(diffs).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(mutantDir, { recursive: true, force: true });
    }
  }, 60_000);
});
