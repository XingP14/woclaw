// PROBE (not a test): does a request for a DIRECTORY inside publicDir take
// the WHOLE HUB PROCESS down?
//
// The shipped handler does:
//
//     let filePath = realTarget ?? indexPath;
//     if (!existsSync(filePath)) filePath = indexPath;
//     res.end(readFileSync(filePath));
//
// `existsSync` is TRUE for a directory, so a directory target survives to
// `readFileSync`, which throws EISDIR. The throw happens inside the http
// request handler, and src/index.ts registers NO `uncaughtException` handler
// -- so this may take the WHOLE hub process down, not just the UI request.
//
// This probe runs the handler in a CHILD PROCESS with the hub's own error
// configuration (no uncaughtException handler) and reports the child's exit.

import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'r500_directory_target_probe_child.ts');

const dir = mkdtempSync(join(tmpdir(), 'r498c-dir-'));
writeFileSync(join(dir, 'index.html'), 'INDEX');
mkdirSync(join(dir, 'nested'), { recursive: true });

function rawGet(port: number, rawPath: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((res) => {
    let done = false;
    const finish = (v: { status: number; body: string }) => {
      if (!done) {
        done = true;
        res(v);
      }
    };
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    sock.on('data', (d) => chunks.push(d as Buffer));
    sock.on('error', () => finish({ status: 0, body: '' }));
    sock.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const idx = text.indexOf('\r\n\r\n');
      const head = idx >= 0 ? text.slice(0, idx) : text;
      const body = idx >= 0 ? text.slice(idx + 4) : '';
      const m = head.match(/^HTTP\/1\.[01] (\d{3})/);
      finish({ status: m ? parseInt(m[1], 10) : 0, body });
    });
    setTimeout(() => {
      sock.destroy();
      finish({ status: -1, body: 'TIMEOUT' });
    }, timeoutMs).unref();
  });
}

// ---- the CHILD: the shipped handler, the hub's error configuration -------
const child = spawn(
  process.execPath,
  ['--import', 'tsx', CHILD, dir],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let childOut = '';
child.stdout?.on('data', (d) => (childOut += d.toString()));
child.stderr?.on('data', (d) => (childOut += d.toString()));

const port = await new Promise<number>((res) => {
  const t = setInterval(() => {
    const m = childOut.match(/PORT=(\d+)/);
    if (m) {
      clearInterval(t);
      res(parseInt(m[1], 10));
    }
  }, 100);
  setTimeout(() => {
    clearInterval(t);
    res(0);
  }, 60_000);
});

if (!port) {
  console.log('child never reported a port:\n' + childOut);
  process.exit(1);
}
console.log('child port =', port);

const ok = await rawGet(port, '/', 10_000);
console.log(`GET /        -> status=${ok.status} bodyLen=${ok.body.length}`);

const dirRes = await rawGet(port, '/nested', 10_000);
console.log(`GET /nested  -> status=${dirRes.status} body=${JSON.stringify(dirRes.body.slice(0, 60))}`);

// Is the child still alive AFTER the directory request?
const after = await rawGet(port, '/', 10_000);
console.log(`GET / (after) -> status=${after.status} bodyLen=${after.body.length}`);

const exitCode = await new Promise<number | null>((res) => {
  if (child.exitCode !== null) {
    res(child.exitCode);
    return;
  }
  child.on('exit', (c) => res(c));
  setTimeout(() => res(null), 5000);
});

console.log('child exit code =', exitCode, exitCode === null ? '(STILL ALIVE)' : '(PROCESS DIED)');
console.log('--- child output ---');
console.log(childOut.split('\n').slice(0, 25).join('\n'));
child.kill('SIGKILL');
process.exit(0);
