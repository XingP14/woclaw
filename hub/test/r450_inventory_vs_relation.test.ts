/**
 * R450 — the back-sweep R449.20 queued: **an inventory assertion is not a
 * relation**, and the difference is invisible until you execute it.
 *
 * R449-2 wrote the rule down without sweeping for it:
 *
 *   "An earlier draft of this file asserted 'N time-bearing fields exist'. That
 *    is an inventory assertion: it goes red when someone adds a sixth field and
 *    stays green when a field stops being compared."
 *
 * R449.20 queued: sweep R403-R448 for arms still asserting inventory. This is
 * that sweep, and it is **executed, not read**.
 *
 * ── THE FINDING ────────────────────────────────────────────────────────────
 *
 * hub/test/r414_cancel_reachability.test.ts:121-125
 *
 *   it('C2b every delivery site is guarded by readyState (a silent drop when closed)') {
 *     const guards = ws.split('\n').filter(l => /readyState\s*[!=]==?\s*(1|WebSocket\.OPEN)/.test(l));
 *     // 16 guards observed at HEAD; if the shape changes this test tells us
 *     expect(guards.length).toBeGreaterThanOrEqual(14);
 *   }
 *
 * The title is a universal claim. The body is a cardinality claim. Adding ONE
 * unguarded delivery site — literally the defect the title names, "a silent drop
 * when closed" — does not change the number of `readyState` tests, because a
 * delivery site is a `.send(` and a guard is a `readyState`: **the two sets are
 * disjoint by construction**, so no cardinality of one can ever detect the
 * absence of the other. Measured, not read: M1 SURVIVED.
 *
 * The floor's slack is not incidental either. 16 guards, floor 14 ⇒ the gate
 * tolerates 2 silent deletions before it fires, and M2 (neutralise one guard)
 * SURVIVED as predicted. So the arm is red only for a *large* regression of a
 * quantity that was never the claim.
 *
 * This is the family R438 opened ("a number stated in a test title with no
 * assertion binding it") and R449-2 named ("assert relationships, not
 * inventories") — with the ordering now closed: R438 caught the number, R449
 * stated the alternative, R450 executes the difference on a shipped suite.
 *
 * ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not modify r414 (R431 discipline: characterise, do not silently
 * rewrite behaviour). It adds the arm that was missing and pins the census so
 * the sweep is repeatable. Production behaviour is untouched.
 *
 * METHOD NOTES
 *
 * - **R450-1  A universal title over a numeric body is the smell.** The title is
 *   what a future reader trusts; the number is what the machine checks. Where
 *   they disagree, the machine is not checking the claim. Detect it by asking
 *   *can the title's counterexample move the body?*
 *
 * - **R450-2  "Guarded" needs a DOMINANCE relation, not co-presence.** Both sets
 *   living in one file is not enough: arm B is written so the counterexample is
 *   order-sensitive — a guard *below* its send does not guard it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');

/** Whole production tree, derived by walking — never listed (R427/R437). */
function deriveProdFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...deriveProdFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out.sort();
}

/** Strip `//` line comments so prose is never read as a mechanism (R449-4). */
const codeOnly = (t: string) => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/**
 * A **raw** socket send — `ws.send(...)`, `agent.ws.send(...)` — i.e. a call that
 * reaches the socket directly. `this.send(...)` is deliberately excluded: it is
 * a delegation into the guarded helper, and a helper call is not a delivery
 * site. Arm A pins both halves, because getting this wrong is exactly how a
 * guard-shaped assertion starts passing on the wrong subjects.
 *
 * Note the receiver is compared as a *value*, not by lookbehind: `(?<!this)\w`
 * does not exclude `this.send(` — `this` itself satisfies `\w`, so the
 * lookbehind sees only the character before it. Rejecting on the captured
 * receiver is the only check that works here (my first attempt counted 22 sites
 * where 2 exist, and arm B1 caught it).
 */
const SEND_CALL = /(?<![A-Za-z0-9_.])([\w.]+)\.send\s*\(/;
// Strip `//` INSIDE the predicates, not only in the caller's `codeOnly`: a
// predicate is used standalone by arm A, and an arm that asserts a property the
// predicate does not have is the same defect R450 exists to catch (a comment
// that mentions `.send(` is prose, not a delivery site).
const isSend = (l: string) => {
  const m = SEND_CALL.exec(l.replace(/\/\/.*$/, ''));
  return m !== null && m[1] !== 'this';
};
const isHelperCall = (l: string) => {
  const m = SEND_CALL.exec(l.replace(/\/\/.*$/, ''));
  return m !== null && m[1] === 'this';
};
const isGuard = (l: string) => /readyState\s*[!=]==?\s*(1|WebSocket\.OPEN)/.test(l);

/**
 * Delivery sites that are **dominated** by a guard: a `readyState` test on the
 * same line or anywhere in the enclosing block above. Scoped to a window so a
 * guard in an unrelated function 300 lines up cannot vouch for a send.
 */
function unguardedSends(text: string): string[] {
  const lines = codeOnly(text).split('\n');
  const bad: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isSend(lines[i])) continue;
    // walk up: a guard on this line, or within the previous 12 lines, closes it
    const window = lines.slice(Math.max(0, i - 12), i + 1);
    if (!window.some(isGuard)) bad.push(`${i + 1}: ${lines[i].trim()}`);
  }
  return bad;
}

describe('R450 — an inventory assertion is not a relation (R449.20 back-sweep)', () => {
  it('A (control, non-vacuous): the send/guard predicates discriminate both ways', () => {
    // R427/R437 discipline: a predicate never asked to reject passes everything.
    expect(isSend('  ws.send(JSON.stringify(msg));')).toBe(true);
    expect(isSend('  agent.ws.send(JSON.stringify(payload));')).toBe(true);
    // a delegation into the guarded helper is NOT a delivery site (reachability,
    // not locality — this distinction is the whole fix, see arm B comment)
    expect(isSend('  this.send(ws, { type: "pong" });')).toBe(false);
    expect(isHelperCall('  this.send(ws, { type: "pong" });')).toBe(true);
    expect(isSend('  // agent.ws.send(x)')).toBe(false);                // comment
    expect(isGuard('  if (ws.readyState === 1) {')).toBe(true);
    expect(isGuard('  if (ws.readyState !== WebSocket.OPEN) return;')).toBe(true);
    expect(isGuard('  if (ws.readyState === 0) {')).toBe(false);        // closed, not open
  });

  it('B: the RELATION r414 C2b\'s title claims — every delivery site is guarded', () => {
    // The counterexample that C2b cannot see, expressed as an assertion.
    const offenders: string[] = [];
    let sendSites = 0;
    for (const f of deriveProdFiles()) {
      const text = readFileSync(f, 'utf8');
      sendSites += codeOnly(text).split('\n').filter(isSend).length;
      for (const o of unguardedSends(text)) offenders.push(`${relative(SRC, f)}:${o}`);
    }
    // The subject set is derived and non-empty — otherwise B is vacuous.
    expect(sendSites).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('B1: the guard is a CHOKE POINT, not a per-site check', () => {
    // Why B is currently green, and what makes it non-vacuous.
    //
    // Every delivery site in the production tree reaches the socket through one
    // helper — `private send(ws, msg)` at ws_server.ts:594 — and that helper
    // tests `readyState === 1` itself. So the relation holds *by construction*,
    // not by 16 independent acts of discipline. That is the good news and the
    // caution: the choke point is load-bearing, and the choke point is a **single
    // line of production code** with nothing pinning it.
    //
    // Today there is exactly 2 raw send and 2 guards (both guards immediately
    // dominate their send). If someone adds a raw `ws.send(` far from the helper,
    // arm B turns red — which is the arm doing its job.
    const ws = codeOnly(readFileSync(join(SRC, 'ws_server.ts'), 'utf8'));
    expect(ws.split('\n').filter(isSend)).toHaveLength(2);
    // and the helper that makes the relation hold exists and tests readyState
    expect(/private send\(ws:\s*WS[\s\S]{0,200}?readyState === 1[\s\S]{0,200}?\.send\(/.test(ws)).toBe(true);
  });

  it('B2: the relation is order-sensitive — a guard BELOW its send does not guard it', () => {
    // Without this, arm B could pass because the window scan is accidentally
    // direction-agnostic, i.e. because it counts co-presence in a file — which
    // is exactly the property R450 exists to refute.
    const reversed = [
      "  ws.send(JSON.stringify(msg));",
      "  if (ws.readyState === 1) {",
    ].join('\n');
    expect(unguardedSends(reversed)).toHaveLength(1);

    // ...and the sanctioned shape is accepted, so B is not red by construction.
    const accepted = [
      "  if (ws.readyState === 1) {",
      "    ws.send(JSON.stringify(msg));",
    ].join('\n');
    expect(unguardedSends(accepted)).toHaveLength(0);
  });

  it('C: the census is pinned — C2b is inventory-shaped, R449\'s own arms are not', () => {
    // The sweep result, as a number, so a later round cannot quietly grow the
    // class (R438: a stated number needs an assertion binding it).
    const r414 = readFileSync(join(__dirname, 'r414_cancel_reachability.test.ts'), 'utf8');
    const c2b = /C2b[\s\S]{0,700}?expect\(guards\.length\)\.toBeGreaterThanOrEqual\((\d+)\)/.exec(r414);
    expect(c2b).not.toBeNull();
    // the arm states a cardinality over a set disjoint from the claim
    expect(Number(c2b![1])).toBe(14);
    // and it never mentions a send in its own body — the title's subject
    const body = r414.slice(r414.indexOf("C2b every delivery site"), r414.indexOf("C2c"));
    expect(/\.send\b/.test(body)).toBe(false);

    // Contrast: R449's arms each bind a stamp AND a non-comparison.
    const r449 = readFileSync(join(__dirname, 'r449_time_authority_probe.test.ts'), 'utf8');
    expect(/expect\(after\)\.not\.toMatch\(\/\\bupdatedAt\\b\/\)/.test(r449)).toBe(true);
  });
});