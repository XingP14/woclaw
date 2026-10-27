#!/usr/bin/env python3
"""R515 mutation matrix.

Guards (each from prior rounds, each earned by a real incident):
  R475-2  snapshot the OWNED files BYTE-LEVEL before injecting; never
          `git checkout` (it would silently destroy a concurrent agent's
          uncommitted work in the same files). Restore from the snapshot, per
          arm, always.
  R475-3  a needle that matches MORE THAN ONE place is rejected, not silently
          injected into the wrong copy. Report NOT-INJECTED honestly.
  R475-9  assert the tree is clean BEFORE injecting anything.
  R456-10 `assert needle in before` AND `assert after != before` — a
          `str.replace` that matches nothing returns the string unchanged and
          still satisfies a `count == 1` assertion.
  R482-10(1) a negative control must be VERIFIED to be a real no-op.
  R482-10(2) "has a Tests line" is NOT a sufficient discriminator — a compile
          failure prints "Tests  no tests". Judge the SHAPE.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HUB = Path('/root/.hermes/workspace/woclaw/hub')
TEST = 'test/r515_declared_origin_columns.test.ts'
OWNED = ['src/db.ts', 'src/ws_server.ts']


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def snapshot() -> dict:
    return {rel: ((HUB / rel).read_bytes(), md5(HUB / rel)) for rel in OWNED}


def restore(snap: dict) -> None:
    for rel, (data, _) in snap.items():
        (HUB / rel).write_bytes(data)


def tree_clean() -> bool:
    r = subprocess.run(['git', 'status', '--short', 'hub/src/'],
                       cwd=HUB.parent, capture_output=True, text=True)
    return r.stdout.strip() == ''


def run_tests() -> tuple[int, str]:
    r = subprocess.run(['npx', 'vitest', 'run', TEST],
                       cwd=HUB, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    m = None
    for line in out.splitlines():
        if 'Tests' in line and ('passed' in line or 'failed' in line or 'no tests' in line):
            m = line.strip()
            break
    if m is None:
        m = out[-800:]
    return r.returncode, m


MUTANTS = [
    dict(
        id='M1', kind='REAL-REPAIR',
        desc='the read path SELECTs federated + source_hub (arm D/E react)',
        file='src/db.ts',
        edits=[("""    const rows = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, key ASC
    `).all() as MemoryRowSqlite[];""",
"""    const rows = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by, federated, source_hub
      FROM memory
      ORDER BY updated_at DESC, key ASC
    `).all() as MemoryRowSqlite[];""")],
    ),
    dict(
        id='M2', kind='REAL-REPAIR',
        desc='the SQLite migration ALSO adds federated + source_hub (arm G reacts)',
        file='src/db.ts',
        edits=[("""    this.addColumnIfNotExists('memory', 'last_accessed_at', 'INTEGER');""",
"""    this.addColumnIfNotExists('memory', 'last_accessed_at', 'INTEGER');
    this.addColumnIfNotExists('memory', 'federated', 'INTEGER DEFAULT 0');
    this.addColumnIfNotExists('memory', 'source_hub', 'TEXT');""")],
    ),
    dict(
        id='M3', kind='NOT-A-REPAIR',
        desc='the receive handler re-writes the row with the [federated] TAG — changes the TAGS, never the ORIGIN (so arm F correctly does not react)',
        expect='SURVIVED',
        
        file='src/ws_server.ts',
        edits=[("""Array.isArray(tags) ? (tags as string[]) : ['federated']""",
                """Array.isArray(tags) ? (tags as string[]) : ['federated', 'r515-m3']""")],
    ),
    dict(
        id='M4', kind='NEGATIVE-CONTROL',
        desc='rename the origin fields in the receive handler (NO behaviour change)',
        file='src/ws_server.ts',
        edits=[("const { key, value, tags, sourceHub, updatedAt } = payload;",
                "const { key, value, tags, sourceHub: _sh, updatedAt: _ua } = payload;")],
        expect='SURVIVED',
    ),
    dict(
        id='M5', kind='REAL-REPAIR',
        desc='the TRUE end-to-end repair: the write path carries the origin AND the read path selects it',
        file='src/db.ts',
        edits=[
            # (a) the SQLite migration adds the two columns
            ("""    this.addColumnIfNotExists('memory', 'last_accessed_at', 'INTEGER');""",
             """    this.addColumnIfNotExists('memory', 'last_accessed_at', 'INTEGER');
    this.addColumnIfNotExists('memory', 'federated', 'INTEGER DEFAULT 0');
    this.addColumnIfNotExists('memory', 'source_hub', 'TEXT');"""),
            # (b) the read path selects them
            ("""    const rows = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, key ASC
    `).all() as MemoryRowSqlite[];""",
             """    const rows = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by, federated, source_hub
      FROM memory
      ORDER BY updated_at DESC, key ASC
    `).all() as MemoryRowSqlite[];"""),
        ],
    ),
    dict(
        id='M6', kind='REAL-REPAIR',
        desc='the WRITE path records the origin (arms B/C/D react)',
        file='src/db.ts',
        edits=[
            ("""        this.db.prepare(`
          INSERT INTO memory (key, value, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          payload.key,
          payload.value,
          serializeTags(payload.tags),
          payload.ttl,
          payload.expireAt,
          payload.now,
          payload.updatedBy,
        );""",
             """        this.db.prepare(`
          INSERT INTO memory (key, value, tags, ttl, expire_at, updated_at, updated_by, federated, source_hub)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          payload.key,
          payload.value,
          serializeTags(payload.tags),
          payload.ttl,
          payload.expireAt,
          payload.now,
          payload.updatedBy,
          payload.updatedBy,
        );"""),
        ],
    ),
]


def inject(m: dict) -> str:
    """Apply every (needle, replacement) pair. All must match EXACTLY ONCE
    (R475-3: an ambiguous needle is rejected, never injected into the wrong
    copy). R456-10: assert the file really changed."""
    p = HUB / m['file']
    before = p.read_text()
    after = before
    for needle, replacement in m['edits']:
        if needle not in after:
            return 'NOT-INJECTED'
        count = after.count(needle)
        if count != 1:
            return 'AMBIGUOUS-NEEDLE(%d)' % count
        after = after.replace(needle, replacement)
    if after == before:
        return 'NO-OP'
    p.write_text(after)
    return 'INJECTED'


def main() -> None:
    if not tree_clean():
        print('ABORT: hub/src is dirty before the matrix started (R475-9).')
        sys.exit(2)
    snap = snapshot()
    print('baseline md5: ' + json.dumps({k: v[1] for k, v in snap.items()}))

    rc, summary = run_tests()
    print('CONTROL rc=%d  %s' % (rc, summary))
    if rc != 0:
        restore(snap)
        print('ABORT: control is not green.')
        sys.exit(2)

    results = []
    try:
        for m in MUTANTS:
            st = inject(m)
            if st != 'INJECTED':
                results.append((m['id'], m['kind'], st, '-', '-', '-'))
                print('%-4s %-16s %-22s' % (m['id'], m['kind'], st))
                restore(snap)
                continue
            rc, summary = run_tests()
            killed = (rc != 0)
            verdict = 'KILLED' if killed else 'SURVIVED'
            exp = m.get('expect', 'KILLED')
            agree = 'AGREE' if verdict == exp else 'DISAGREE-WITH-EXPECTATION'
            results.append((m['id'], m['kind'], verdict, agree, summary))
            print('%-4s %-16s %-10s expect=%-9s %-26s %s' % (m['id'], m['kind'], verdict, exp, agree, summary))
            restore(snap)
            for rel, (data, h) in snap.items():
                assert md5(HUB / rel) == h, 'RESTORE FAILED for %s' % rel
    finally:
        restore(snap)
        for rel, (data, h) in snap.items():
            assert md5(HUB / rel) == h, 'FINAL RESTORE FAILED for %s' % rel
        print('restored OK: ' + json.dumps({k: v[1] for k, v in snap.items()}))

    print('\n--- SUMMARY ---')
    for r in results:
        if len(r) == 6:
            print('  %-4s %-16s %-10s expect=%-9s %-26s %s' % r)
        else:
            print('  %-4s %-16s %-22s %s' % (r[0], r[1], r[2], r[3]))


if __name__ == '__main__':
    main()
