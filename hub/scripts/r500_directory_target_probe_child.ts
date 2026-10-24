// The CHILD half of probe498c_directory_target.ts.
//
// It runs the SHIPPED UI static handler (createUiRequestHandler) in a process
// with the HUB'S OWN error configuration: src/index.ts registers NO
// `uncaughtException` and NO `unhandledRejection` handler, so an exception
// thrown inside a request handler terminates the process.
//
// It binds an ALLOCATED port (port 0) and prints `PORT=<n>` so the parent can
// drive it over a raw socket. It also prints `EXIT=<reason>` when it is about
// to die, so the parent can distinguish "crashed" from "answered".

import http from 'node:http';
import { createUiRequestHandler } from '../src/ui_static.js';

const dir = process.argv[2];
if (!dir) {
  console.log('EXIT=no-dir-argument');
  process.exit(2);
}

const server = http.createServer(createUiRequestHandler(dir) as never);
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  console.log(`PORT=${port}`);
});

// The hub registers no uncaughtException handler. This listener is here ONLY
// so the parent can SEE the failure and report it -- it does NOT swallow it
// silently: it re-throws so the process still dies, exactly as the hub does.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  console.log(`EXIT=uncaughtException code=${err.code ?? 'UNKNOWN'} syscall=${err.syscall ?? '-'}`);
  process.exit(9);
});
