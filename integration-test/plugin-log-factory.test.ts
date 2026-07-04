import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * plugin/src/plugin_log.ts createPluginLogger() factory (07-05 01:26 cron
 * chain #8 helper-extraction factory pattern).
 *
 * Wire-format note: the bind-fallback factory produces
 * `console.error(prefix, msg, ...args)` — i.e. prefix and msg are TWO
 * SEPARATE call arguments, not concatenated into one string. console.error
 * joins them with a space at print time, so the visible output looks like
 * `${prefix} ${msg}` — but the JS call signature has prefix as arg 0 and
 * msg as arg 1. This matches the legacy inline
 * `console.error.bind(null, '[WoClaw]')` shape byte-identically.
 *
 * Mirrors integration-test/plugin-log.test.ts (chain #6, 07-04 01:43)
 * but exercises the bind-fallback logger factory rather than the
 * single-message helper functions.
 */
describe('plugin/src/plugin_log.ts createPluginLogger() factory (07-05 01:26 cron chain #8)', () => {
  describe('module shape', () => {
    it('plugin_log.ts exists at plugin/src/plugin_log.ts', () => {
      const path = resolve(__dirname, '../plugin/src/plugin_log.ts');
      const src = readFileSync(path, 'utf-8');
      expect(src.length).toBeGreaterThan(0);
    });

    it('exports createPluginLogger() factory alongside pluginLog/pluginWarn/pluginError', async () => {
      const mod = await import('../plugin/src/plugin_log.js');
      expect(typeof mod.createPluginLogger).toBe('function');
      expect(typeof mod.pluginLog).toBe('function');
      expect(typeof mod.pluginWarn).toBe('function');
      expect(typeof mod.pluginError).toBe('function');
    });

    it('createPluginLogger() returns a PluginLogger with info/warn/error/debug function fields', async () => {
      const mod = await import('../plugin/src/plugin_log.js');
      const logger = mod.createPluginLogger();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('createPluginLogger() is an arrow-less function declaration (canonical shape)', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/plugin_log.ts'), 'utf-8');
      const re = /^export function createPluginLogger\(prefixes: PluginLoggerPrefixes = \{\}\): PluginLogger \{/m;
      expect(src, 'expected canonical factory signature').toMatch(re);
    });
  });

  describe('runtime wire-format — default prefixes (matches index.ts canonical shape)', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errSpy.mockRestore();
    });

    it('createPluginLogger().info("hello") emits exactly console.error("[WoClaw]", "hello")', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger();
      logger.info('hello');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw]', 'hello');
    });

    it('createPluginLogger().warn("oops") emits exactly console.error("[WoClaw] WARN:", "oops")', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger();
      logger.warn('oops');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] WARN:', 'oops');
    });

    it('createPluginLogger().error("bad", code) emits exactly console.error("[WoClaw] ERROR:", "bad", code) with multi-arg passthrough', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger();
      logger.error('bad', 42);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] ERROR:', 'bad', 42);
    });

    it('createPluginLogger().debug("trace") emits exactly console.error("[WoClaw] DEBUG:", "trace")', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger();
      logger.debug('trace');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw] DEBUG:', 'trace');
    });
  });

  describe('runtime wire-format — channel.ts prefix drift (overrides preserve [WoClaw WARN:] shape)', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errSpy.mockRestore();
    });

    it('createPluginLogger({warn:"[WoClaw WARN:]", error:"[WoClaw ERROR:]", debug:"[WoClaw DEBUG:]"}).warn("oops") emits exactly console.error("[WoClaw WARN:]", "oops")', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger({
        warn: '[WoClaw WARN:]',
        error: '[WoClaw ERROR:]',
        debug: '[WoClaw DEBUG:]',
      });
      logger.warn('oops');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[WoClaw WARN:]', 'oops');
    });

    it('partial override: only warn set, info/error/debug use canonical defaults', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger({ warn: '[WoClaw WARN:]' });
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      logger.debug('d');
      expect(errSpy).toHaveBeenCalledTimes(4);
      expect(errSpy).toHaveBeenNthCalledWith(1, '[WoClaw]', 'i');
      expect(errSpy).toHaveBeenNthCalledWith(2, '[WoClaw WARN:]', 'w');
      expect(errSpy).toHaveBeenNthCalledWith(3, '[WoClaw] ERROR:', 'e');
      expect(errSpy).toHaveBeenNthCalledWith(4, '[WoClaw] DEBUG:', 'd');
    });

    it('partial override: only error set, info/warn/debug use canonical defaults', async () => {
      const { createPluginLogger } = await import('../plugin/src/plugin_log.js');
      const logger = createPluginLogger({ error: '[CUSTOM ERROR:]' });
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      logger.debug('d');
      expect(errSpy).toHaveBeenCalledTimes(4);
      expect(errSpy).toHaveBeenNthCalledWith(1, '[WoClaw]', 'i');
      expect(errSpy).toHaveBeenNthCalledWith(2, '[WoClaw] WARN:', 'w');
      expect(errSpy).toHaveBeenNthCalledWith(3, '[CUSTOM ERROR:]', 'e');
      expect(errSpy).toHaveBeenNthCalledWith(4, '[WoClaw] DEBUG:', 'd');
    });
  });

  describe('closure parity (channel.ts + index.ts call sites migrated)', () => {
    it('channel.ts no longer has inline console.error.bind with [WoClaw ...] prefix literals', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/channel.ts'), 'utf-8');
      const bindPrefixMatches = src.match(/console\.error\.bind\(null, '\[WoClaw[^\]]*\]'\)/g) || [];
      expect(bindPrefixMatches.length, 'channel.ts should have 0 inline bind-fallback logger objects').toBe(0);
    });

    it('index.ts no longer has inline console.error.bind with [WoClaw ...] prefix literals', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/index.ts'), 'utf-8');
      const bindPrefixMatches = src.match(/console\.error\.bind\(null, '\[WoClaw[^\]]*\]'\)/g) || [];
      expect(bindPrefixMatches.length, 'index.ts should have 0 inline bind-fallback logger objects').toBe(0);
    });

    it('channel.ts imports createPluginLogger from plugin_log.ts', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/channel.ts'), 'utf-8');
      expect(src).toMatch(/^import \{ createPluginLogger \} from '\.\/plugin_log\.js';$/m);
    });

    it('index.ts imports createPluginLogger from plugin_log.ts alongside pluginError (chain #6)', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/index.ts'), 'utf-8');
      expect(src).toMatch(/^import \{ pluginError, createPluginLogger \} from '\.\/plugin_log\.js';$/m);
    });

    it('channel.ts uses createPluginLogger exactly 2 times (L507 setChannelRuntime + L523 register)', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/channel.ts'), 'utf-8');
      const calls = src.match(/createPluginLogger\(/g) || [];
      expect(calls.length, 'channel.ts should call createPluginLogger exactly 2 times').toBe(2);
    });

    it('index.ts uses createPluginLogger exactly 2 times (initWoclaw early-return + main path)', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/index.ts'), 'utf-8');
      const calls = src.match(/createPluginLogger\(/g) || [];
      expect(calls.length, 'index.ts should call createPluginLogger exactly 2 times').toBe(2);
    });

    it('channel.ts bind-fallback logger objects count drops from 2 (was 4 bind sites × 2 objects) to 0', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/channel.ts'), 'utf-8');
      // Old shape was 2 multi-line bind-fallback logger objects (L506-511 + L522-527),
      // each with 4 console.error.bind sites = 8 bind sites total. After refactor: 0.
      // Note: L441-443 has a different shape (plain console.log/warn/error/debug
      // without bind or prefix) which is intentionally NOT migrated (different
      // wire-format — plain fallback, no [WoClaw] prefix).
      const bindSites = (src.match(/console\.error\.bind\(null, '\[WoClaw[^\]]*\]'\)/g) || []).length;
      expect(bindSites, 'channel.ts should have 0 [WoClaw ...] bind sites after refactor').toBe(0);
    });

    it('index.ts bind-fallback logger objects count drops from 2 (was 4 bind sites × 2 objects) to 0', () => {
      const src = readFileSync(resolve(__dirname, '../plugin/src/index.ts'), 'utf-8');
      const bindSites = (src.match(/console\.error\.bind\(null, '\[WoClaw[^\]]*\]'\)/g) || []).length;
      expect(bindSites, 'index.ts should have 0 [WoClaw ...] bind sites after refactor').toBe(0);
    });
  });
});
