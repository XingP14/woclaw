import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

/**
 * R407 falsification probe.
 *
 * R406's deferred P5 is the store-per-owner *namespace* primitive. This probe does not
 * argue for or against it; it executes four claims the code appears to make about the
 * existing (non-namespace) isolation surface, so the round's conclusions rest on
 * observed behaviour rather than on reading. Each test names the claim it falsifies.
 */
describe('R407 — keyspace isolation claims', () => {
  const testDir = '/tmp/woclaw-r407-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('F1: the "workspace" scope is satisfiable by an unrelated tag, not by key form', async () => {
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-SECRET', 'rest-api', ['infra'], 0);
    // Same secret, arbitrary key form, single 'workspace' tag.
    await mp.write('deploy/bastion1/ssh-key', 'WS-SECRET', 'rest-api', ['infra', 'workspace'], 0);

    const scoped = await mp.search('ssh', 10, 'workspace');
    const keys = scoped.map(m => m.key);

    console.log('F1 scope=workspace ->', JSON.stringify(keys));
    // Claim under test: only the openclaw:-prefixed key is workspace-scoped.
    // Falsified: the arbitrary-form key is visible via the tag OR-branch.
    expect(keys).toContain('openclaw:workspace:infra:ssh-key');
    expect(keys).toContain('deploy/bastion1/ssh-key');
  });

  it('F2: scope is not applied to direct read or delete', async () => {
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-SECRET', 'rest-api', ['workspace'], 0);

    // handleMemoryGet -> memory.read(key): signature has no scope parameter.
    const direct = await mp.read('openclaw:workspace:infra:ssh-key');
    expect(direct).toBeDefined();

    // handleMemoryDelete -> memory.delete(key): likewise unscoped.
    const deleted = await mp.delete('openclaw:workspace:infra:ssh-key');
    expect(deleted).toBe(true);
  });

  it('F3: any holder of the shared token can overwrite any key (no owner column)', async () => {
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-SECRET', 'rest-api', ['workspace'], 0);
    await mp.write('openclaw:workspace:infra:ssh-key', 'OVERWRITTEN', 'agent:intruder', ['workspace'], 0);
    const after = await mp.read('openclaw:workspace:infra:ssh-key');
    console.log('F3 value/updatedBy ->', after!.value, '/', after!.updatedBy);
    expect(after!.value).toBe('OVERWRITTEN');
    expect(after!.updatedBy).toBe('agent:intruder');
  });

  it('F4: the default scope is "all", and scope filters nothing that lacks both markers', async () => {
    await mp.write('openclaw:session:main:agent:main:cron:abc', 'SESSION-SECRET', 'rest-api', [], 0);
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-SECRET', 'rest-api', [], 0);

    const sess = await mp.search('ssh secret', 10, 'session');
    const ws = await mp.search('ssh secret', 10, 'workspace');
    const all = await mp.search('ssh secret', 10, 'all');
    console.log('F4 session ->', JSON.stringify(sess.map(m => m.key)));
    console.log('F4 workspace ->', JSON.stringify(ws.map(m => m.key)));
    console.log('F4 all ->', JSON.stringify(all.map(m => m.key)));
    expect(all.length).toBe(2);
  });

  it('F5: a key with no markers is invisible to every narrowed scope — and "all" is the default', async () => {
    await mp.write('openclaw:workspace:infra:ssh-key', 'WS-SECRET', 'rest-api', ['workspace'], 0);
    // The same secret, re-written under a bare name with no tags: no prefix, no marker.
    await mp.write('ssh-key', 'WS-SECRET', 'rest-api', [], 0);
    await mp.delete('openclaw:workspace:infra:ssh-key');

    const ws = await mp.search('ssh', 10, 'workspace');
    const sess = await mp.search('ssh', 10, 'session');
    const all = await mp.search('ssh', 10, 'all');
    console.log('F5 workspace ->', JSON.stringify(ws.map(m => m.key)));
    console.log('F5 session ->', JSON.stringify(sess.map(m => m.key)));
    console.log('F5 all ->', JSON.stringify(all.map(m => m.key)));
    // An unmarked key belongs to NO narrowed scope; it is reachable only by the default.
    expect(ws).toEqual([]);
    expect(sess).toEqual([]);
    expect(all.map(m => m.key)).toEqual(['ssh-key']);
  });
});
