// The CHILD half of the R500 suite (hub/test/r500_directory_target_dos.test.ts).
//
// It runs the SHIPPED UI static handler (createUiRequestHandler) in a process
// with the HUB'S OWN error configuration: `src/index.ts` registers NO
// `uncaughtException` and NO `unhandledRejection` handler (verified by grep
// over hub/src/), so an exception thrown inside a request handler terminates
// the process.
//
// It binds an ALLOCATED port (port 0) and prints `PORT=<n>` so the parent can
// drive it over a raw socket.
//
// `--crash-on-directory` mode wraps the handler so that a request for a
// DIRECTORY inside the root throws EISDIR -- exactly the shape the shipped
// handler had before the R500 repair. It is used ONLY by the suite's
// detector-liveness control arm, and it is deliberately INDEPENDENT of the
// source text: it does not read, patch or pattern-match the shipped source,
// so the control cannot fail merely because the repair was spelled
// differently.
//
// It also prints `EXIT=<reason>` when it is about to die, so the parent can
// distinguish "crashed" from "answered".

import http from 'node:http';
import { statSync } from 'fs';
import { join } from 'path';

const HERE = new URL('.', import.meta.url).pathname;
const SRC = join(HERE, '../src/ui_static.ts');

const dir = process.argv[2];
const crashOnDirectory = process.argv.includes('--crash-on-directory');
if (!dir) {
  console.log('EXIT=no-dir-argument');
  process.exit(2);
}

const mod = await import(SRC);
const shipped = mod.createUiRequestHandler(dir);

const handler = crashOnDirectory
  ? (req: any, res: any) => {
      try {
        const url = (req.url === '/' ? 'index.html' : String(req.url).split('?')[0]).replace(/^\/+/, '');
        const candidate = join(dir, url);
        // A DIRECTORY is the crash shape: `existsSync` is true for it, and
        // `readFileSync` on it throws EISDIR.
        if (statSync(candidate).isDirectory()) {
          throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read`), {
            code: 'EISDIR',
            syscall: 'read',
          });
        }
      } catch (e: any) {
        if (e && e.code === 'EISDIR') throw e;
      }
      shipped(req, res);
    }
  : shipped;

const server = http.createServer(handler as never);
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  console.log(`PORT=${port}`);
});

// The hub registers no uncaughtException handler. This listener is here ONLY
// so the parent can SEE the failure and report it -- it does NOT swallow it
// silently: it exits with a distinct code, exactly as the hub does (the hub
// would die with an uncaught exception; here the death is observable).
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  console.log(`EXIT=uncaughtException code=${err.code ?? 'UNKNOWN'} syscall=${err.syscall ?? '-'}`);
  process.exit(9);
});
