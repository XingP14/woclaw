// Regression test for plugin-side type-safety refactor (post-50c572b):
// exercises the new typed WoClawPluginConfig / WoClawAccountInput /
// WoClawAdapterRuntime shapes via the public woclawChannelPlugin object,
// so that a future regression that re-introduces `: any` on the adapter
// function parameters will fail tsc (caught by `npm run build`).
//
// Specifically asserts:
//   1. listAccountIds / resolveAccount / inspectAccount accept undefined
//      cfg without throwing (previously cfg?.channels?.['woclaw']?.accounts
//      was the un-typed path; now the type is WoClawPluginConfig | undefined).
//   2. resolveAccount prefers per-account fields over top-level cfg fields
//      (matches the previous cfg.channels['woclaw'].accounts[id] ?? section.X
//      fallback chain, just expressed in the new flat shape).
//   3. applyAccountConfig round-trips: input written into cfg.accounts[id]
//      can be re-read by resolveAccount (the type is now a flat
//      WoClawPluginConfig, not a nested channels.woclaw.accounts envelope).
//   4. The ChannelPlugin shape (woclawChannelPlugin.config / .setup) is
//      wired correctly so the OpenClaw SDK can call into the typed adapters.

import { describe, it, expect } from 'vitest';
import { woclawChannelPlugin } from '../src/channel.js';
import type { WoClawPluginConfig, WoClawAccountInput, WoClawAdapterRuntime } from '../src/channel.js';

describe('woclawChannelPlugin: config adapter (typed WoClawPluginConfig shape)', () => {
  it('listAccountIds / resolveAccount / inspectAccount handle undefined cfg', () => {
    const cfg = woclawChannelPlugin.config;
    expect(cfg).toBeDefined();
    // listAccountIds is the canonical entry point OpenClaw calls first;
    // a regression that introduces a null deref on cfg?.* would throw.
    const ids = cfg.listAccountIds(undefined);
    expect(ids).toEqual(['default']);

    // resolveAccount with no cfg and no accountId → default account.
    const account = cfg.resolveAccount(undefined);
    expect(account).toEqual({
      accountId: 'default',
      hubUrl: 'ws://localhost:8080',
      agentId: '',
      token: '',
      autoJoin: [],
    });

    // inspectAccount with no cfg → all unconfigured.
    const inspected = cfg.inspectAccount?.(undefined);
    expect(inspected).toEqual({
      enabled: false,
      configured: false,
      hubUrl: 'ws://localhost:8080',
      agentId: '',
      tokenStatus: 'missing',
    });
  });

  it('resolveAccount prefers per-account fields over top-level cfg fields', () => {
    const cfg: WoClawPluginConfig = {
      hubUrl: 'ws://top-level.example.com:8080',
      agentId: 'top-level-agent',
      token: 'top-level-token',
      autoJoin: ['general'],
      accounts: {
        prod: {
          hubUrl: 'ws://prod.example.com:9090',
          agentId: 'prod-agent',
          token: 'prod-token',
          autoJoin: ['alerts'],
        },
      },
    };
    const account = woclawChannelPlugin.config.resolveAccount(cfg, 'prod');
    expect(account).toEqual({
      accountId: 'prod',
      hubUrl: 'ws://prod.example.com:9090',
      agentId: 'prod-agent',
      token: 'prod-token',
      autoJoin: ['alerts'],
    });
    // listAccountIds lists the explicit account IDs.
    expect(woclawChannelPlugin.config.listAccountIds(cfg)).toEqual(['prod']);
  });

  it('resolveAccount falls back to top-level cfg when account is missing', () => {
    const cfg: WoClawPluginConfig = {
      hubUrl: 'ws://top-level.example.com:8080',
      agentId: 'top-level-agent',
      token: 'top-level-token',
    };
    const account = woclawChannelPlugin.config.resolveAccount(cfg, 'unknown-id');
    expect(account).toEqual({
      accountId: 'unknown-id',
      hubUrl: 'ws://top-level.example.com:8080',
      agentId: 'top-level-agent',
      token: 'top-level-token',
      autoJoin: [],
    });
  });
});

describe('woclawChannelPlugin: setup adapter (applyAccountConfig round-trips with typed shape)', () => {
  it('applyAccountConfig writes into cfg.accounts and is readable by resolveAccount', () => {
    const initial: WoClawPluginConfig = {
      hubUrl: 'ws://top-level.example.com:8080',
      autoJoin: ['general'],
    };
    const input: WoClawAccountInput = {
      hubUrl: 'ws://new.example.com:8080',
      agentId: 'new-agent',
      token: 'new-token',
      autoJoin: ['alerts', 'incidents'],
    };
    const after = woclawChannelPlugin.setup.applyAccountConfig({
      cfg: initial,
      accountId: 'newacct',
      input,
    });
    // Written at the flat cfg.accounts path (the typed shape), not the
    // old nested cfg.channels.woclaw.accounts envelope.
    expect(after.accounts?.['newacct']).toEqual(input);
    // Top-level fields preserved.
    expect(after.hubUrl).toBe('ws://top-level.example.com:8080');
    expect(after.autoJoin).toEqual(['general']);
    // Round-trip: resolveAccount reads it back.
    const resolved = woclawChannelPlugin.config.resolveAccount(after, 'newacct');
    expect(resolved).toEqual({
      accountId: 'newacct',
      hubUrl: 'ws://new.example.com:8080',
      agentId: 'new-agent',
      token: 'new-token',
      autoJoin: ['alerts', 'incidents'],
    });
  });

  it('applyAccountConfig on undefined cfg produces a valid flat WoClawPluginConfig', () => {
    const input: WoClawAccountInput = {
      hubUrl: 'ws://fresh.example.com:8080',
      agentId: 'fresh',
      token: 'fresh-token',
    };
    const result = woclawChannelPlugin.setup.applyAccountConfig({
      cfg: undefined,
      accountId: 'first',
      input,
    });
    // applyAccountConfig fills in autoJoin: [] when the input omits it, so
    // the stored account is a fully-shaped WoClawAccountInput, not a raw
    // echo of the caller-provided input. Assert the intended defaults:
    expect(result.accounts?.['first']).toEqual({
      hubUrl: input.hubUrl,
      agentId: input.agentId,
      token: input.token,
      autoJoin: [],
    });
    expect(result.hubUrl).toBeUndefined();
    // resolveAccount still works.
    const account = woclawChannelPlugin.config.resolveAccount(result, 'first');
    expect(account.hubUrl).toBe('ws://fresh.example.com:8080');
    expect(account.agentId).toBe('fresh');
    expect(account.token).toBe('fresh-token');
    expect(account.autoJoin).toEqual([]);
  });
});

describe('woclawChannelPlugin: WoClawAdapterRuntime shape accepts the fields adapters read', () => {
  it('compile-time check: WoClawAdapterRuntime can be shaped for both setChannelRuntime and register paths', () => {
    // This test exists primarily to force tsc to validate the shape we
    // declared. If a future refactor narrows the interface incorrectly,
    // the assignments below will fail tsc and `npm run build` will catch it.
    const runtime: WoClawAdapterRuntime = {
      cfg: { hubUrl: 'ws://x', agentId: 'a', token: 't' },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      dispatch: () => {},
    };
    // The nested runtime shape (used by `register` path through api.runtime.dispatch).
    const apiShape: WoClawAdapterRuntime = {
      cfg: { hubUrl: 'ws://x' },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      runtime: {
        dispatch: () => {},
      },
    };
    expect(runtime.cfg?.hubUrl).toBe('ws://x');
    expect(apiShape.runtime?.dispatch).toBeDefined();
  });
});
