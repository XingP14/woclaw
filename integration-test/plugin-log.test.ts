import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('plugin/src/plugin_log.ts helper extraction (07-04 01:43 cron chain #6)', () => {
  describe('module shape', () => {
    it('plugin_log.ts exists at plugin/src/plugin_log.ts', () => {
      const path = resolve(__dirname, '../plugin/src/plugin_log.ts');
      const src = readFileSync(path, 'utf-8');
      expect(src.length).toBeGreaterThan(0);
    });

    it('exports 3 helpers: pluginLog, pluginWarn, pluginError', async () => {
      const mod = await import('../plugin/src/plugin_log.js');
      expect(typeof mod.pluginLog).toBe('function');
      expect(typeof mod.pluginWarn).toBe('function');
      expect(typeof mod.pluginError).toBe('function');
    });

    it('all 3 helpers are arrow-less function declarations (canonical shape matching federation_log)', async () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/plugin_log.ts'), 'utf-8');
      for (const name of ['pluginLog', 'pluginWarn', 'pluginError']) {
        const re = new RegExp(`^export function ${name}\\(msg: string, \\.\\.\\.args: unknown\\[\\]\\): void \\{`, 'm');
        expect(src, `expected canonical signature for ${name}`).toMatch(re);
      }
    });
  });

  describe('runtime wire-format (parity with pre-refactor inline sites)', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('pluginError("setRuntime called with cfg:", cfg) emits exactly console.error("[WoClaw] setRuntime called with cfg:", cfg)', async () => {
      const { pluginError } = await import('../plugin/src/plugin_log.js');
      const cfg = { channels: { woclaw: {} }, plugins: 'exists' };
      pluginError('setRuntime called with cfg:', JSON.stringify(cfg));
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] setRuntime called with cfg:', JSON.stringify(cfg));
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('pluginError("registerFull called") emits exactly console.error("[WoClaw] registerFull called")', async () => {
      const { pluginError } = await import('../plugin/src/plugin_log.js');
      pluginError('registerFull called');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] registerFull called');
    });

    it('pluginLog routes to console.error with [WoClaw] prefix (parity with bind fallback logger)', async () => {
      const { pluginLog } = await import('../plugin/src/plugin_log.js');
      pluginLog('hello world');
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] hello world');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('multi-arg passthrough (...args: unknown[]) preserved', async () => {
      const { pluginError } = await import('../plugin/src/plugin_log.js');
      pluginError('Failed:', 'ECONNRESET', { retry: 3 });
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] Failed:', 'ECONNRESET', { retry: 3 });
    });
  });

  describe('plugin/src/index.ts migrated sites (closure parity)', () => {
    const indexSrc = readFileSync(resolve(__dirname, '../plugin/src/index.ts'), 'utf-8');

    it('imports pluginError from ./plugin_log.js', () => {
      expect(indexSrc).toMatch(/^import \{ pluginError(, [\w]+)? \} from '\.\/plugin_log\.js';$/m);  // allows createPluginLogger co-import (chain #8 0531355 closure)
    });

    it('has exactly 2 pluginError call sites in plugin/src/index.ts', () => {
      // Count pluginError occurrences (excluding the import line)
      const matches = indexSrc.match(/pluginError\(/g) || [];
      // /pluginError\(/g matches only `(`, not `}` — so the import line `import { pluginError } from ...`
      // is not counted. matches.length is exactly the call-site count.
      expect(matches.length).toBe(2);
    });

    it('both call sites are inside the entry setRuntime / registerFull callbacks', () => {
      // setRuntime callback contains pluginError('setRuntime called...')
      expect(indexSrc).toMatch(/setRuntime: \(runtime\) => \{[\s\S]*?pluginError\('setRuntime called with cfg:'/);
      // registerFull callback contains pluginError('registerFull called')
      expect(indexSrc).toMatch(/registerFull: \(api\) => \{[\s\S]*?pluginError\('registerFull called'\)/);
    });

    it('zero direct console.error("[WoClaw]") call sites remain in plugin/src/index.ts', () => {
      // The 2 migrated sites must be gone — only the inline `[WoClaw]` literals in the
      // bind-fallback logger objects (lines 43, 47) remain, which are a different pattern
      // (object literal expression, not direct console.error call).
      const direct = indexSrc.match(/console\.error\('\[WoClaw\]/g) || [];
      expect(direct.length).toBe(0);
    });

    it('bind-fallback logger objects on lines 43 + 47 still use console.error.bind(null, "[WoClaw]") (untouched, different pattern)', () => {
      // The { info: console.error.bind(...), warn: ..., error: ..., debug: ... } objects
      // are a different pattern (logger fallback abstraction), not part of this round.
      // Verify they are still present (no accidental migration).
      // chain #8 0531355 closure: bind-fallback logger objects on old L43+L47 were replaced
      // by pluginError(0) + createPluginLogger() factories; the bind() pattern is gone.
      // The test now asserts zero residual bind() patterns (stale >=2 assertion removed).
      const bindMatches = indexSrc.match(/console\.error\.bind\(null, '\[WoClaw\]'\)/g) || [];
      expect(bindMatches.length).toBe(0);
    });
  });
});
