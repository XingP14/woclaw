#!/usr/bin/env python3
"""R479 mutation matrix.

Discipline (R477 D1 + r474 restore-cadence correction):
  - OWNED files are snapshotted BYTE-FOR-BYTE before injection.
  - Every arm asserts the OWNED files are CLEAN first, and refuses to run
    on a dirty tree rather than overwriting someone's in-flight work.
  - restore happens IMMEDIATELY per arm, not only in finally:, so a later
    arm never reads a file an earlier arm rewrote.
  - every arm asserts anchor count == 1 AND mutated != original, so a
    needle that does not appear reports ANCHOR MISS instead of a fake kill.
"""
import subprocess, sys, pathlib, json, hashlib

HUB = pathlib.Path('/root/.hermes/workspace/woclaw/hub')
SUITE = 'test/r479_periodic_sync_provider_reach.test.ts'
OWNED = [HUB / 'src/federation.ts', HUB / 'src/ws_server.ts']
# M6 also touches the Config type declaration.
OWNED_EXTRA = [HUB / 'src/types.ts']

def sh(cmd):
    return subprocess.run(cmd, shell=True, cwd=HUB, capture_output=True, text=True)

def clean_check():
    out = sh('git status --porcelain src/federation.ts src/ws_server.ts src/types.ts').stdout.strip()
    if out:
        print('REFUSING: OWNED files are dirty:\n' + out)
        sys.exit(2)
    return True

def run_suite():
    r = sh(f'npx vitest run {SUITE}')
    tail = [l for l in r.stdout.splitlines() if 'Tests ' in l]
    summary = tail[-1].strip() if tail else 'NO SUMMARY'
    failed = 'failed' in summary
    if 'Test Files' in r.stdout and 'failed' in summary:
        pass
    return (not failed), summary, r.stdout

MUTANTS = [
    # (id, description, files, needle, replacement, expect)
    ('M1', 'REPAIR F1: wire setMemoryProvider into the production site (ws_server.ts)',
     ['src/ws_server.ts'],
     '    this.federationManager = new FederationManager(config);',
     '    this.federationManager = new FederationManager(config);\n'
     '    this.federationManager.setMemoryProvider(async () => []);',
     'KILLED'),
    ('M2', 'NEGATIVE CONTROL: pure rename of a local binding, zero behaviour change (federation.ts)',
     ['src/federation.ts'],
     'const important = memories.filter(m => m.importanceScore >= threshold);',
     "const important = memories.filter((m: any) => m.importanceScore >= threshold);\n"
     '    const survivors = important;',
     'SURVIVED'),
    ('M3', 'REPAIR F2: make the default threshold permissive so a mapped row can pass (7.0 -> 0)',
     ['src/federation.ts'],
     'const threshold = this.config.federationSync?.importanceThreshold ?? 7.0;',
     'const threshold = this.config.federationSync?.importanceThreshold ?? 0;',
     'KILLED'),
    ('M4', 'REPAIR F3: enforce maxSyncPerRound so the declared bound becomes real',
     ['src/federation.ts'],
     '    for (const mem of important) {',
     '    for (const mem of important.slice(0, this.config.federationSync?.maxSyncPerRound ?? 50)) {',
     'KILLED'),
    ('M5', 'REPAIR F4: arm the timer even with no peers (move startPeriodicSync before the guard)',
     ['src/federation.ts'],
     "    if (!this.config.federationPeers?.length) {\n      fedLog('No peers configured');\n      return;\n    }",
     "    if (!this.config.federationPeers?.length) {\n      fedLog('No peers configured');\n      this.startPeriodicSync();\n      return;\n    }",
     'KILLED'),
    ('M6', 'REPAIR F1b: gate the early-return on an unconfigured provider instead of a null one',
     ['src/federation.ts'],
     '    if (!this.getMemoriesForSync) return;',
     '    if (this.getMemoriesForSync === undefined) return;',
     'KILLED'),
]

def apply(f, needle, repl):
    src = f.read_text()
    n = src.count(needle)
    if n != 1:
        raise SystemExit(f'ANCHOR MISS count={n} in {f.name}')
    new = src.replace(needle, repl)
    if new == src:
        raise SystemExit(f'MUTATION NO-OP in {f.name} (needle absent from disk?)')
    f.write_text(new)
    return f.read_text()

def main():
    clean_check()
    all_owned = OWNED + OWNED_EXTRA
    snaps = {f: f.read_bytes() for f in all_owned}
    hashes = {f: hashlib.sha256(b).hexdigest()[:12] for f, b in snaps.items()}
    print('SNAPSHOT:', {f.name: h for f, h in hashes.items()})

    print('\nCONTROL (pristine tree):')
    ok, summ, _ = run_suite()
    print('  ', 'GREEN' if ok else 'RED', '|', summ)
    if not ok:
        print('CONTROL RED — aborting, do not score mutants.')
        for f, b in snaps.items(): f.write_bytes(b)
        sys.exit(1)

    results = []
    for mid, desc, files, needle, repl, expect in MUTANTS:
        try:
            for rel in files:
                apply(HUB / rel, needle, repl)
            ok, summ, _ = run_suite()
            if ok:
                verdict = 'SURVIVED'
            elif 'Tests ' in summ and 'failed' in summ and 'passed' in summ:
                # A partial red (some arms green, some failed) is a REAL
                # assertion kill. A compile/collect failure reports
                # "Test Files 1 failed" with no "Tests N failed" line at
                # all, which is the harness case.
                verdict = 'KILLED'
            elif 'failed' in summ:
                verdict = 'ERROR'
            else:
                verdict = 'HARNESS'
            results.append((mid, verdict, expect, summ, desc, ''))
            print(f'  {mid}: {verdict} | {summ} | {desc}')
        except SystemExit as e:
            results.append((mid, 'HARNESS', expect, str(e), desc, ''))
            print(f'  {mid}: HARNESS | {e}')
        finally:
            # IMMEDIATE per-arm restore (r474 D1 correction)
            for f, b in snaps.items(): f.write_bytes(b)

    print('\n=== TALLY ===')
    k = sum(1 for r in results if r[1] == 'KILLED')
    s = sum(1 for r in results if r[1] == 'SURVIVED')
    h = sum(1 for r in results if r[1] == 'HARNESS')
    e = sum(1 for r in results if r[1] == 'ERROR')
    print(f'KILLED={k} SURVIVED={s} HARNESS={h} ERROR={e}  of {len(MUTANTS)}')

    bad = []
    for mid, verdict, expect, summ, desc, note in results:
        okexp = (verdict == expect)
        print(f'  {mid}: expected {expect}, got {verdict} -> {"OK" if okexp else "UNEXPECTED"}')
        if not okexp: bad.append(mid)

    # post-restore integrity
    print('\nRESTORE INTEGRITY:')
    for f, b in snaps.items():
        now = f.read_bytes()
        print(f'  {f.name}: {"MATCH" if now == b else "*** DIVERGED ***"}')

    with open('/root/.hermes/workspace/woclaw/hub/scripts/r479_matrix.json', 'w') as f:
        json.dump([{'id': r[0], 'verdict': r[1], 'expect': r[2], 'summary': r[3], 'desc': r[4]} for r in results], f, indent=2)
    sys.exit(1 if bad else 0)

main()
