// R498c probe: does the shipped confinement assertion survive a SYMLINK?
//
// Both R498b (woclaw) and R497 (llm-benchmark) assert containment TEXTUALLY:
//   target = resolve(root, relative);  target.startsWith(root + sep)
// `resolve` normalises `..` but does NOT resolve symlinks, so the assertion
// says "the path, spelled out, starts with the root" -- not "the file that
// will be opened lives under the root".
//
// The canonical guidance (safeguard.sh / OWASP) asks for a symlink-FREE
// resolution: resolve BOTH the target and the root to real paths, then
// compare.
//
// This probe MEASURES the difference against the shipped woclaw handler.
// It is a probe, not a test: it reports what happens.

import { mkdtempSync, symlinkSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createUiRequestHandler } from '../src/ui_static.js';

type Res = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  writeHead?: (s: number, h: Record<string, string>) => void;
  end?: (b?: string) => void;
};

function drive(handler: (req: any, res: any) => void, url: string): Res {
  const res: Res = {};
  res.writeHead = (s, h) => {
    res.status = s;
    res.headers = h;
  };
  res.end = (b) => {
    res.body = b === undefined ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
  };
  handler({ url } as any, res as any);
  return res;
}

const root = mkdtempSync(join(tmpdir(), 'r498c_symlink_'));
// a legitimate file inside the root
writeFileSync(join(root, 'index.html'), '<html>index</html>');
writeFileSync(join(root, 'ok.js'), 'console.log(1)');
// an ATTACKER-CONTROLLED symlink inside the root -> outside
symlinkSync('/etc', join(root, 'escape'), 'dir');

console.log('root =', root);
console.log('symlink inside root:', join(root, 'escape'), '-> /etc');

const handler = createUiRequestHandler(root);

for (const url of [
  '/',                        // control: index
  '/ok.js',                   // control: a legitimate file
  '/escape/passwd',           // ATTACK: traversal-free, through a symlink
  '/escape/hostname',         // ATTACK: another one
]) {
  const r = drive(handler, url);
  const body = (r.body ?? '').slice(0, 90).replace(/\n/g, '\\n');
  console.log(
    `GET ${url.padEnd(22)} -> ${r.status}  ct=${r.headers?.['Content-Type'] ?? '-'}  body[0..90]=${body}`
  );
}
