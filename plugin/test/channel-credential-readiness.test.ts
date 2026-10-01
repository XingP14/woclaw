// Credential-readiness surface of the OpenClaw channel plugin
// (2026-10-02 04:03 cron tick).
//
// Background — why this file exists. A fresh scoped probe
// (`npx vitest run --config vitest.probe.config.js --coverage`) put
// plugin/src/channel.ts at 3/31 dark branches, all three of them on the
// account-credential pair:
//
//   L396:47  enabled:     Boolean(account.hubUrl && account.agentId && account.token)
//   L397:50  configured:  Boolean(account.hubUrl && account.agentId && account.token)
//   L400:25  tokenStatus: account.token ? 'available' : 'missing'
//
// All three are the same shape, and the reason is one fact about
// resolveAccount (L373):
//
//   hubUrl: account?.hubUrl ?? cfg?.hubUrl ?? 'ws://localhost:8080'
//
// hubUrl can therefore NEVER be falsy — an unconfigured install still resolves
// to a real default URL. That makes `hubUrl` inert in every `&&` chain and
// pushes the whole falsy decision onto agentId/token, which are '' by default.
// The three dark arms are exactly the "plugin is installed but the user never
// filled in the credentials" outcome — the single most common first-run state,
// and the one that produces `configured: false` / `tokenStatus: 'missing'`.
//
// This is NOT unreachable defensive code. It is the reachable bad path, and
// nothing asserted it before.
//
// The existing plugin/test/channel.test.ts cannot cover it: it mocks `ws`, then
// asserts on the mock's own properties (`expect(mockWs.on).toBeDefined()`) and
// on vi.clearAllMocks(). It imports no production code. Its 2 passing tests
// would pass with plugin/src/channel.ts deleted. That is why the whole
// credential surface reads as partially exercised — the coverage it did
// contribute came from adapter-config.test.ts, not from channel.test.ts.

import { describe, it, expect } from 'vitest';
import { woclawChannelPlugin } from '../src/channel.js';

const config = woclawChannelPlugin.config;

describe('plugin credential readiness', () => {
  it('exposes the readiness hooks on the public plugin surface', () => {
    // If OpenClaw ever drops one of these from `config`, the assertions below
    // stop being about credential state and start being about `undefined`
    // throwing. Fail here instead, with a clear message.
    expect(typeof config.inspectAccount).toBe('function');
    expect(typeof config.isConfigured).toBe('function');
    expect(typeof config.unconfiguredReason).toBe('function');
  });

  describe('inspectAccount', () => {
    it('reports a fully configured account as available', () => {
      const r = config.inspectAccount(
        { hubUrl: 'ws://hub.example:8082', agentId: 'p14', token: 'tok' },
        undefined,
      );
      expect(r.configured).toBe(true);
      expect(r.enabled).toBe(true);
      expect(r.tokenStatus).toBe('available');
      expect(r.hubUrl).toBe('ws://hub.example:8082');
      expect(r.agentId).toBe('p14');
    });

    // THE three dark arms. An empty config resolves to the default hub URL and
    // '' credentials, so every one of the three falsy outcomes is reachable
    // from a plain first-run install.
    it('reports an unconfigured install as missing, not as available', () => {
      const r = config.inspectAccount({}, undefined);
      expect(r.configured).toBe(false);
      expect(r.enabled).toBe(false);
      expect(r.tokenStatus).toBe('missing');
      // hubUrl is NOT '' — this is the defaulting that makes hubUrl inert in
      // the && chain above. Asserted so the default is a pinned contract.
      expect(r.hubUrl).toBe('ws://localhost:8080');
      expect(r.agentId).toBe('');
    });

    it('treats a completely absent config the same as an empty one', () => {
      // cfg is `undefined`, so every `cfg?.x ?? default` falls through. This is
      // the shape OpenClaw passes before the user has run any setup wizard.
      const r = config.inspectAccount(undefined, undefined);
      expect(r.configured).toBe(false);
      expect(r.tokenStatus).toBe('missing');
      expect(r.hubUrl).toBe('ws://localhost:8080');
    });

    it('marks a hub-only config as unconfigured, since agentId and token are empty', () => {
      // hubUrl truthy but the pair is missing: the && short-circuits late, which
      // is the whole reason L396:47/L397:50 sit on the LAST operand.
      const r = config.inspectAccount({ hubUrl: 'ws://hub.example:8082' }, undefined);
      expect(r.configured).toBe(false);
      expect(r.tokenStatus).toBe('missing');
    });

    it('marks a config with a token but no agentId as unconfigured', () => {
      const r = config.inspectAccount({ token: 'tok' }, undefined);
      expect(r.configured).toBe(false);
      expect(r.tokenStatus).toBe('available');
    });

    it('lets an empty account entry inherit the top-level credentials', () => {
      // MEASURED, not assumed. A first draft of this test asserted the
      // opposite and failed, which is worth recording: `{}` is not nullish, so
      // `account?.hubUrl` is `undefined` and the `??` chain in resolveAccount
      // CONTINUES to the top-level config. An account entry created empty (or
      // by a partial setup wizard) therefore reports the parent's credentials
      // as its own.
      //
      // Is that right? Yes, and it is deliberate-looking: a config with a
      // top-level hubUrl/agentId/token and a per-account override block is the
      // documented shape, and the common case is a single account inheriting
      // the shared credentials. Pinned here so a future change to the `??`
      // chain cannot silently alter it.
      const cfg = {
        hubUrl: 'ws://top.example:8082',
        agentId: 'top',
        token: 'top-tok',
        accounts: { empty: {} },
      };
      const inherited = config.inspectAccount(cfg, 'empty');
      expect(inherited.hubUrl).toBe('ws://top.example:8082');
      expect(inherited.agentId).toBe('top');
      expect(inherited.tokenStatus).toBe('available');
      expect(inherited.configured).toBe(true);

      // An explicit per-account value still wins over the top level.
      const overridden = config.inspectAccount(
        { ...cfg, accounts: { empty: { agentId: 'own', token: 'own-tok' } } },
        'empty',
      );
      expect(overridden.agentId).toBe('own');
      expect(overridden.tokenStatus).toBe('available');
    });

    it('does not invent a token for an account with no top level to inherit', () => {
      // The control for the case above: with nothing at the top level, the
      // account resolves empty and readiness correctly reports 'missing'.
      const r = config.inspectAccount({ accounts: { empty: {} } }, 'empty');
      expect(r.tokenStatus).toBe('missing');
      expect(r.configured).toBe(false);
      expect(r.agentId).toBe('');
    });
  });

  describe('isConfigured', () => {
    it('is the same predicate as inspectAccount().configured', () => {
      // The two must not drift: OpenClaw uses isConfigured to gate connection
      // setup and inspectAccount to render status, so a disagreement would show
      // a channel as connected while reporting it unconfigured.
      const full = { accountId: 'd', hubUrl: 'ws://h:8082', agentId: 'a', token: 't', autoJoin: [] };
      expect(config.isConfigured(full)).toBe(true);
      expect(config.isConfigured(full)).toBe(config.inspectAccount({ hubUrl: 'ws://h:8082', agentId: 'a', token: 't' }).configured);

      const bare = { accountId: 'd', hubUrl: 'ws://h:8082', agentId: '', token: '', autoJoin: [] };
      expect(config.isConfigured(bare)).toBe(false);
      expect(config.isConfigured(bare)).toBe(config.inspectAccount({ hubUrl: 'ws://h:8082' }).configured);
    });
  });

  describe('unconfiguredReason', () => {
    it('names the first missing field, in the order the user must fix them', () => {
      const mk = (p: Partial<{ hubUrl: string; agentId: string; token: string }>) =>
        ({ accountId: 'd', hubUrl: '', agentId: '', token: '', autoJoin: [], ...p });

      // hubUrl-first ordering is asserted explicitly even though resolveAccount
      // makes it unreachable through inspectAccount: unconfiguredReason is
      // exported and also called with hand-built accounts, so the ordering is a
      // real contract and not dead code.
      expect(config.unconfiguredReason(mk({}))).toBe('hubUrl is required');
      expect(config.unconfiguredReason(mk({ hubUrl: 'ws://h:8082' }))).toBe('agentId is required');
      expect(config.unconfiguredReason(mk({ hubUrl: 'ws://h:8082', agentId: 'a' }))).toBe('token is required');
      expect(config.unconfiguredReason(mk({ hubUrl: 'ws://h:8082', agentId: 'a', token: 't' }))).toBe('');
    });

    it('is meant to be called with a resolved account, not an inspect result', () => {
      // MEASURED, not assumed. A first draft passed the inspectAccount RESULT
      // in here and got 'token is required' back even though the account was
      // fully configured. That is not a bug: WoClawInspectResult exposes
      // `tokenStatus: 'available' | 'missing'`, never a `token` field, so
      // `!account.token` is trivially true for it.
      //
      // The two types are structurally different and unconfiguredReason's
      // parameter is WoClawResolvedAccount. OpenClaw's own plugin-types.d.ts
      // declares it as `(account: ResolvedAccount, cfg: any)`, so callers pass a
      // resolved account and this is correct usage. Pinned so a future
      // refactor that merges the two types does not silently change which
      // reason a configured account reports.
      const resolved = config.resolveAccount({ hubUrl: 'ws://h', agentId: 'a', token: 't' });
      expect(config.unconfiguredReason(resolved)).toBe('');

      const inspected = config.inspectAccount({ hubUrl: 'ws://h', agentId: 'a', token: 't' });
      expect(inspected.configured).toBe(true);
      expect(config.unconfiguredReason(inspected as never)).toBe('token is required');
    });
  });

  describe('listAccountIds / resolveAccount', () => {
    it('falls back to a single default account when none are declared', () => {
      expect(config.listAccountIds(undefined)).toEqual(['default']);
      expect(config.listAccountIds({})).toEqual(['default']);
    });

    it('lists declared account ids in declaration order', () => {
      expect(config.listAccountIds({ accounts: { a: {}, b: {} } })).toEqual(['a', 'b']);
    });

    it('defaults accountId to "default" for null and undefined', () => {
      expect(config.resolveAccount({}, undefined).accountId).toBe('default');
      expect(config.resolveAccount({}, null).accountId).toBe('default');
    });
  });
});
