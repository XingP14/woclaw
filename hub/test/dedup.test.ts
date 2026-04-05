import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import fs from 'fs';

function mkTempDir() {
  const dir = `/tmp/woclaw-dedup-test-${Date.now()}-${Math.random()}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Deduplication (S26)', () => {
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    const dir = mkTempDir();
    db = new ClawDB(dir);
    mp = new MemoryPool(db);
  });

  it('first write has no duplicate or conflict', () => {
    const result = mp.write('key1', 'value1', 'agent1');
    expect(result.mem.key).toBe('key1');
    expect(result.duplicate).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.previousValue).toBeUndefined();
  });

  it('writing same value twice is marked duplicate', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value1', 'agent2');
    expect(result.duplicate).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.previousValue).toBe('value1');
  });

  it('writing different value triggers conflict', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value2', 'agent2');
    expect(result.duplicate).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.previousValue).toBe('value1');
  });

  it('duplicate write does not trigger subscriber notification', () => {
    const notifications: any[] = [];
    mp.subscribe('agent1', (msg) => notifications.push(msg));
    mp.write('key1', 'value1', 'agent1');   // first write - notification
    mp.write('key1', 'value1', 'agent2');   // duplicate - no notification
    mp.unsubscribe('agent1');
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('memory_write');
  });

  it('conflict write does trigger subscriber notification', () => {
    const notifications: any[] = [];
    mp.subscribe('agent1', (msg) => notifications.push(msg));
    mp.write('key1', 'value1', 'agent1');
    mp.write('key1', 'value2', 'agent2');  // conflict - notification triggered
    mp.unsubscribe('agent1');
    expect(notifications.length).toBe(2);
    expect(notifications[0].type).toBe('memory_write');
    expect(notifications[1].type).toBe('memory_write');
  });

  it('previousUpdatedAt and previousUpdatedBy are set on conflict', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value2', 'agent2');
    expect(result.conflict).toBe(true);
    expect(result.previousUpdatedBy).toBe('agent1');
    expect(typeof result.previousUpdatedAt).toBe('number');
  });

  it('previousUpdatedAt and previousUpdatedBy are set on duplicate', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value1', 'agent2');
    expect(result.duplicate).toBe(true);
    expect(result.previousUpdatedBy).toBe('agent1');
  });

  it('result mem has the new (overwritten) value on conflict', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value2', 'agent2');
    expect(result.mem.value).toBe('value2');
  });

  it('result mem has the same value on duplicate (no change)', () => {
    mp.write('key1', 'value1', 'agent1');
    const result = mp.write('key1', 'value1', 'agent2');
    expect(result.mem.value).toBe('value1');
  });
});
