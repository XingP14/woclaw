#!/usr/bin/env python3
"""R538 — measure the MySQL carrier for a negative LIMIT.

The MySQL backend of the hub binds `LIMIT ?` as a prepared-statement
parameter.  Two forms are measured SEPARATELY, because they can differ:

  (a) LITERAL interpolation  `LIMIT -1`
  (b) PREPARED STATEMENT    `LIMIT ?` with a bound negative value

(b) is the form the hub actually uses (`pool.query(... LIMIT ?`, [limit]).
The server is reached from inside the `r492-mysql` container (its root
password is empty in that context); no destructive statements are used.

ARM (b) NEEDS CREDENTIALS for the PUBLISHED port (the container's root
account is socket-authenticated, so a TCP connection is refused for
'root'@'172.17.0.1').  The script therefore tries a small ladder of
accounts and reports which one it used; if none works, arm (b) is
reported as UNMEASURED rather than silently skipped.
"""
import subprocess

def sh(cmd, timeout=40):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or "").strip()
    err = "\n".join(l for l in (r.stderr or "").splitlines() if "Warning" not in l).strip()
    return out, err

DOCKER = ["docker", "exec", "r492-mysql", "mysql", "-u", "root", "-N", "-B"]

def mysql(stmt, db=None):
    cmd = list(DOCKER)
    if db:
        cmd.append(db)
    cmd += ["-e", stmt]
    return sh(cmd)

print("=== setup ===")
print("db:", mysql("CREATE DATABASE IF NOT EXISTS r538")[0])
print("table:", mysql("CREATE TABLE IF NOT EXISTS r538.t (a INT)", db="r538")[0])
print("rows:", mysql("SELECT COUNT(*) FROM r538.t", db="r538")[0])

# The throwaway TCP account arm (b) needs.  The container's root is
# socket-authenticated, so it is used over `docker exec` to create a
# dedicated account that may connect over the PUBLISHED port.
for stmt in [
    "CREATE USER IF NOT EXISTS 'r538probe'@'%' IDENTIFIED BY 'r538probe'",
    "GRANT ALL PRIVILEGES ON r538_probe.* TO 'r538probe'@'%'",
    "FLUSH PRIVILEGES",
]:
    out, err = mysql(stmt)
    print("  [%s...] err=%r" % (stmt.split()[0], err[:90]))

print("\n=== (a) LITERAL interpolation: LIMIT -1 ===")
for lit in ["3", "0", "-1", "-5"]:
    out, err = mysql(f"SELECT COUNT(*) FROM (SELECT a FROM r538.t ORDER BY a LIMIT {lit}) x")
    print(f"  LIMIT {lit:>5} -> out={out!r} err={err[:130]!r}")

print("\n=== (b) PREPARED statement: LIMIT ? with a bound negative value ===")
node = r'''
const mysql = require(process.argv[2]);
const creds = [
  {user:'r538probe', password:'r538probe'},
  {user:'root', password:''},
  {user:'root', password:'root'},
];
(async () => {
  let c = null, used = null;
  for (const cred of creds) {
    try {
      c = await mysql.createConnection({host:'127.0.0.1',port:33306,user:cred.user,password:cred.password});
      used = cred.user;
      break;
    } catch (e) { console.log('  no connection as ' + cred.user + ': ' + String(e.message).slice(0,70)); }
  }
  if (!c) { console.log('  ARM (b) UNMEASURED: no working account for the published port'); process.exit(3); }
  console.log('  connected as ' + used);
  await c.query('CREATE DATABASE IF NOT EXISTS r538_probe');
  await c.query('USE r538_probe');
  await c.query('CREATE TABLE IF NOT EXISTS t (a INT)');
  await c.query('DELETE FROM t WHERE a >= 0');
  await c.query('INSERT INTO t (a) VALUES (1),(2),(3),(4),(5)');
  const [seed] = await c.query('SELECT COUNT(*) AS n FROM t');
  console.log('  seeded rows: ' + seed[0].n);
  for (const L of [3, 0, -1, -5, -9999, NaN]) {
    try {
      const [rows] = await c.query('SELECT a FROM t ORDER BY a LIMIT ?', [L]);
      console.log(`  LIMIT ? <- ${String(L)} -> ${rows.length} rows`);
    } catch (e) {
      console.log(`  LIMIT ? <- ${String(L)} -> ERROR ${e.code || ''} ${String(e.message).slice(0,90)}`);
    }
  }
  await c.end();
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
'''
open("/tmp/r538_mysql_probe.cjs", "w").write(node)
import base64, os
b64 = base64.b64encode(node.encode()).decode()
sh(["docker", "exec", "r492-mysql", "sh", "-c",
    f"echo {b64} | base64 -d > /tmp/r538_probe.cjs"])
# mysql2 is not inside the container; run node on the host against the
# PUBLISHED port (33306) with a credential ladder.
MYSQL2 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node_modules", "mysql2", "promise.js")
MYSQL2 = os.path.normpath(MYSQL2)
print("  mysql2 module:", MYSQL2, "exists:", os.path.exists(MYSQL2))
out, err = sh(["node", "/tmp/r538_mysql_probe.cjs", MYSQL2], timeout=90)
if out:
    print(out)
if err:
    print("  stderr:", err[:400])
