import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';

const dataDir = mkdtempSync(join(tmpdir(), 'r488f1-'));
const config: any = {
  host: '127.0.0.1', port: 0, restPort: 0, dataDir,
  storage: { type: 'sqlite', sqlitePath: join(dataDir, 'u.sqlite') },
  authToken: 'T0-aaaaaaaaaaaaaaaa',
};
const db = new ClawDB(config);
const s = new WSServer(config, db);

const first = s.rotateToken('T1-bbbbbbbbbbbbbbbb', 1000);
const second = s.rotateToken('T2-cccccccccccccccc', 60_000);
console.log('first.gracePeriodEnd  =', first.gracePeriodEnd);
console.log('second.gracePeriodEnd =', second.gracePeriodEnd);
console.log('clock EXTENDED        =', second.gracePeriodEnd > first.gracePeriodEnd);
console.log('T0 authorizes now?    =', s.isTokenAuthorized('T0-aaaaaaaaaaaaaaaa'));
console.log('T1 authorizes now?    =', s.isTokenAuthorized('T1-bbbbbbbbbbbbbbbb'));
console.log('T2 authorizes now?    =', s.isTokenAuthorized('T2-cccccccccccccccc'));
console.log('TOKEN THAT LOST ITS SLOT = T0');
console.log('TOKEN THAT GAINED THE EXTENDED CLOCK =',
  s.isTokenAuthorized('T1-bbbbbbbbbbbbbbbb') ? 'T1' : 'nobody');
process.exit(0);
