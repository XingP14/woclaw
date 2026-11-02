// R529 — the MCP bridge path must be DERIVED, never LITERAL.
//
// THE DEFECT THIS SUITE PINS.
//
// `woclaw mcp serve` spawned a hard-coded absolute path:
//
//     '/home/node/.openclaw/workspace/woclaw/mcp-bridge/dist/index.js'
//
// That is ONE author's checkout on ONE host. MEASURED on this tree (2026-11-03
// 03:3x CST), running the HEAD version of `plugin/bin/woclaw.js` from a
// directory where `ws` resolves normally:
//
//     $ node head-woclaw.js mcp serve
//     Error: Cannot find module '/home/node/.openclaw/workspace/woclaw/mcp-bridge/dist/index.js'
//
// So `woclaw mcp serve` was broken on EVERY host but the author's, and the
// failure surfaced as an opaque module-resolution error raised by the CHILD
// process, with no mention of what was tried.
//
// WHY THIS IS A SUITE AND NOT A COMMENT.
//
// The shape of the defect is the same one this repo keeps measuring on the
// driver side (R506 / R510 / R511 / R513): a path baked into code is
// validated on exactly ONE host, and the defect is INVISIBLE on the one host
// the code was written on. A comment cannot prevent the next literal. Only a
// GATE can.
//
// WHAT THIS SUITE MEASURES (and what it deliberately does NOT).
//
// It does NOT assert that a particular path string is absent. A string gate
// would be satisfied by renaming the literal and would not notice a NEW
// literal in a different file. Instead it derives the subject set from the
// repository (R426's rule: a hand-written list would never notice a 17th
// file) and asserts a PROPERTY of every PUBLISHED RUNTIME file:
//
//     no PUBLISHED runtime script may contain a HOST-SPECIFIC absolute path
//     in LIVE code (comments and docstrings are documentation of the defect
//     class and are exempt — R511's rule).
//
// The property is what survives a rename, a move, and a new file.
//
// THE SUBJECT SET — WHY IT IS "PUBLISHED RUNTIME", NOT "EVERY SCRIPT".
//
// This matters, and getting it wrong is the trap this suite was written
// around. A first draft swept EVERY tracked script and found 23 host-path
// literals in `hub/scripts/*.py` and `*.sh` — the mutation drivers. Those
// are real defects of the same class (R527 fixed exactly one of them,
// `r498b_matrix.py`, and left the other 33 for follow-ups). But they are NOT
// the same subject: `hub/package.json#files` publishes only
// `dist/`, `tests/`, `test/`, `SKILL.md`, `README.md`, `LICENSE` — so
// `hub/scripts/` is DEV TOOLING that never reaches a user.
//
// Sweeping dev tooling into a SHIPPED-RUNTIME gate would have produced a gate
// that is red for 23 pre-existing, separately-tracked defects. A gate that
// cannot go green gets skipped, and a skipped gate asserts nothing (R432-3's
// mirror). Worse, it would have smuggled 23 unrelated fixes into this
// commit — the scope-discipline rule this repo keeps re-learning.
//
// So the subject set is derived from the PUBLISHED SURFACE: the files each
// workspace package's `package.json#files` globs actually put in the tarball.
// A defect that reaches a user is in that set; a driver that only runs on a
// maintainer's machine is not.
//
// WHY COMMENTS ARE EXEMPT.
//
// The CLI fix documents the exact literal it replaced, in a comment, at the
// site of the fix. A scanner that counted comments would go RED on its own
// repair — the same shape R498b measured on the sibling repo, where counting
// the bare word `shadow` turned a correct security fix RED because the prose
// named the attack. Python docstrings are therefore removed STRUCTURALLY (a
// regex cannot tell a docstring from a string constant), and C-style and
// shell comments are removed by their own scanners.
//
// The exemption is narrow and it is load-bearing in both directions: a literal
// in live CODE is a finding, a literal in a COMMENT is not, and the suite
// below proves both halves (arm A2 plants a live literal and demands RED;
// arm A3 plants a comment-only literal and demands GREEN).

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/** Extensions that can carry executable logic. */
const SCRIPT_SUFFIXES = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash']);

/**
 * A host-specific absolute path.
 *
 * The shape is deliberately anchored on a HOME-like prefix rather than on a
 * workspace path, because the defect class is "a path that names ONE host's
 * layout". `/home/node/...`, `/root/...` and `/Users/...` are all one host's
 * layout; a repo-relative path is not.
 */
const HOST_PATH_RE =
  /(?<![A-Za-z0-9_])(?:\/home\/[A-Za-z0-9._-]+|\/root\/[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)+/g;

/** The workspace packages that are published to npm. */
const PUBLISHED_PACKAGES = [
  'hub',
  'plugin',
  'mcp-bridge',
  'packages/woclaw-hooks',
  'packages/codex-woclaw',
  'packages/codex-woclaw-example',
  'packages/opencode-woclaw-plugin',
  'packages/woclaw-vscode',
];

/**
 * Derive the PUBLISHED runtime surface.
 *
 * The subject set is derived, never hand-listed (R426): it comes from each
 * package's own `package.json#files` globs applied to the files that package
 * actually has on disk. `npm pack --dry-run` would be the authoritative
 * answer, but it shells out to npm for seven packages on every test run, and
 * it requires the package to be installable; the glob expansion below is the
 * same rule applied to the same inputs, and arm A1 pins the result against
 * the packages that MUST be in it.
 *
 * The file list comes from `git ls-files`, not from a filesystem walk. A walk
 * has to decide what to do with `node_modules/`, and this repository's
 * workspace symlinks (`hub/node_modules/ws` -> `../node_modules/ws`) make a
 * naive walk loop forever (MEASURED: ELOOP after 40 levels). The TRACKED file
 * list is both cheaper and more accurate: it is exactly what the package
 * publishes, before the build generates `dist/` from it.
 */
function publishedRuntimeFiles(): string[] {
  const out: string[] = [];
  for (const pkg of PUBLISHED_PACKAGES) {
    const pkgDir = join(REPO, pkg);
    const pkgJson = join(pkgDir, 'package.json');
    if (!existsSync(pkgJson)) continue;
    let files: string[] = [];
    try {
      files = JSON.parse(readFileSync(pkgJson, 'utf8')).files ?? [];
    } catch {
      continue;
    }
    for (const rel of trackedFiles(pkgDir)) {
      if (files.some((g) => globMatches(g, rel))) {
        out.push(`${pkg}/${rel}`);
      }
    }
  }
  return out;
}

/** The TRACKED files of a directory, relative to it. */
function trackedFiles(root: string): string[] {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

/** Minimal glob matcher: `**` matches any path segments, `*` matches within one segment. */
function globMatches(glob: string, rel: string): boolean {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|+?()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re + '$').test(rel);
}

/** Strip C-style comments while preserving line structure. */
function stripCComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (ch === '/' && src[i + 1] === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Remove shell comments, honouring simple quoting. */
function stripShellComments(src: string): string {
  return src
    .split('\n')
    .map((ln) => {
      let q: string | null = null;
      for (let i = 0; i < ln.length; i++) {
        const c = ln[i];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") {
          q = c;
        } else if (c === '#' && (i === 0 || /\s/.test(ln[i - 1]))) {
          return ln.slice(0, i);
        }
      }
      return ln;
    })
    .join('\n');
}

/** Remove Python comments. */
function stripPythonComments(src: string): string {
  return src
    .split('\n')
    .map((ln) => ln.replace(/(?<!['"])#.*$/, ''))
    .join('\n');
}

/**
 * Strip Python DOCSTRINGS structurally.
 *
 * A regex cannot distinguish a docstring from any other string constant, so
 * this parses the module's statement structure. It is deliberately
 * conservative: an unrecognised shape leaves the source alone, which can only
 * ADD findings, never hide one.
 */
function stripPythonDocstrings(src: string): string {
  const lines = src.split('\n');
  const isStringStmt = (ln: string): boolean => {
    const t = ln.trim();
    return /^("""|''')/.test(t) || (/^(['"]).*\1\s*$/.test(t) && !/=/.test(t));
  };

  // Module docstring: the first statement, if it is a bare string.
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#')) continue;
    if (isStringStmt(lines[i])) {
      for (let j = i; j < lines.length; j++) {
        const u = lines[j].trim();
        if (!u || u.startsWith('#')) { lines[j] = ''; continue; }
        break;
      }
    }
    break;
  }

  // Function/class docstrings.
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?(?:def|class)\b/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && lines[j].search(/\S/) <= indent) j++;
    if (j < lines.length && lines[j].trim() && lines[j].search(/\S/) > indent) {
      if (isStringStmt(lines[j])) {
        const start = j;
        // A triple-quoted docstring may span lines.
        const t = lines[j].trim();
        if (/^("""|''')/.test(t) && !(t.length > 3 && t.endsWith(t.slice(0, 3)))) {
          let k = j + 1;
          while (k < lines.length && !lines[k].includes(t.slice(0, 3))) {
            lines[k] = '';
            k++;
          }
          if (k < lines.length) lines[k] = '';
          j = k;
        } else {
          lines[j] = '';
        }
        void start;
      }
    }
  }

  return stripPythonComments(lines.join('\n'));
}

/** Strip comments/docstrings for a file, by extension. */
function stripComments(rel: string, src: string): string {
  const ext = extname(rel);
  if (ext === '.py') return stripPythonDocstrings(src);
  if (ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs') return stripCComments(src);
  if (ext === '.sh' || ext === '.bash') return stripShellComments(src);
  return src;
}

/** Every live host-path literal in one file. */
function liveHostPaths(rel: string, src: string): Array<{ literal: string; line: number }> {
  const code = stripComments(rel, src);
  const out: Array<{ literal: string; line: number }> = [];
  code.split('\n').forEach((ln, idx) => {
    const matches = ln.match(HOST_PATH_RE);
    if (matches) for (const m of matches) out.push({ literal: m, line: idx + 1 });
  });
  return out;
}

/** The PUBLISHED runtime scripts — the subject set of the gate. */
function publishedRuntimeScripts(): string[] {
  return publishedRuntimeFiles().filter((rel) => {
    if (!SCRIPT_SUFFIXES.has(extname(rel))) return false;
    const segs = rel.split('/');
    if (segs.includes('node_modules')) return false;
    // `test/` and `tests/` are shipped too, but they are not RUNTIME: they
    // do not execute for a user. The gate's subject is what RUNS.
    if (segs.some((s) => s === 'test' || s === 'tests')) return false;
    return true;
  });
}

describe('R529: the MCP bridge path must be DERIVED, never LITERAL', () => {
  it('A0 — the subject set is DERIVED, non-empty, and contains the file the defect lived in', () => {
    // A suite whose subject set is hand-written cannot notice a new file.
    // It must also actually contain the file that carried the defect, or the
    // sweep below would be vacuous for exactly the reason that matters.
    const subjects = publishedRuntimeScripts();
    expect(subjects.length, 'published runtime scripts').toBeGreaterThan(5);
    expect(subjects, 'the file that carried the literal').toContain('plugin/bin/woclaw.js');
  });

  it('A0b — dev tooling is NOT in the subject set (scope discipline)', () => {
    // `hub/scripts/` holds the mutation drivers, which carry the same class
    // of host-path literals but are NOT published (`hub/package.json#files`
    // does not include `scripts/`). Mixing them in would make this gate red
    // for 23 pre-existing, separately-tracked defects and smuggle unrelated
    // fixes into this commit.
    const subjects = publishedRuntimeScripts();
    expect(subjects.filter((s) => s.startsWith('hub/scripts/'))).toEqual([]);
    expect(subjects, 'the shipped CLI must be in the subject set').toContain('plugin/bin/woclaw.js');
  });

  it('A1 — no PUBLISHED runtime script carries a host-specific absolute path in LIVE code', () => {
    // THE GATE. The subject set is derived from each package's own
    // `package.json#files` globs; every published runtime script is scanned;
    // comments and docstrings are exempt because they are DOCUMENTATION of
    // the defect class.
    const subjects = publishedRuntimeScripts();
    const findings: string[] = [];
    for (const rel of subjects) {
      let src: string;
      try {
        src = readFileSync(join(REPO, rel), 'utf8');
      } catch {
        continue;
      }
      for (const f of liveHostPaths(rel, src)) {
        findings.push(`${rel}:${f.line} ${f.literal}`);
      }
    }
    expect(
      findings,
      'live host-specific absolute paths in published runtime scripts — derive the path instead',
    ).toEqual([]);
  });

  it('A2 — the gate is not vacuous: a LIVE literal is a finding', () => {
    // A gate that cannot fail proves nothing (R427's rule). This arms a
    // live-code literal and demands that the same detector reports it.
    const planted = [
      "const p = '/home/someone/else/thing/index.js';",
      "const q = '/root/.hermes/workspace/woclaw/hub/scripts/x.py';",
    ].join('\n');
    const found = liveHostPaths('probe.js', planted);
    expect(found.length, 'the detector must see planted live literals').toBe(2);
    expect(found[0].literal).toBe('/home/someone/else/thing/index.js');
  });

  it('A3 — a COMMENT-only literal is NOT a finding (the exemption is load-bearing)', () => {
    // The fix documents the literal it replaced, in a comment, at the site of
    // the fix. A scanner that counted comments would go RED on its own
    // repair — R498b's shape, where counting the bare word `shadow` turned a
    // correct security fix RED because the prose named the attack.
    const commented = [
      '// The old code spawned',
      "//   '/home/node/.openclaw/workspace/woclaw/mcp-bridge/dist/index.js'",
      '/* and also /root/some/other/path in a block comment */',
      'const ok = 1;',
    ].join('\n');
    expect(liveHostPaths('probe.js', commented)).toEqual([]);
  });

  it('A4 — the fix itself derives the bridge, and names every candidate when it cannot', () => {
    // The gate proves the ABSENCE of a literal. This arm proves the
    // PRESENCE of the repair: the resolution is derived from the file's own
    // location, and the failure is LOUD — it names every candidate it tried,
    // because a silent spawn against a missing path surfaces as an opaque
    // module-resolution error from the CHILD.
    const src = readFileSync(join(REPO, 'plugin/bin/woclaw.js'), 'utf8');
    expect(src, 'the resolver must exist').toContain('function resolveMcpBridge()');
    expect(src, 'the resolver must derive from __dirname').toContain('__dirname');
    expect(src, 'the resolver must try the installed package').toContain("require.resolve('woclaw-mcp')");
    expect(src, 'the failure must name the candidates').toContain('cannot find the MCP bridge');
    expect(liveHostPaths('plugin/bin/woclaw.js', src), 'no live literal in the CLI').toEqual([]);
  });

  it('A5 — the shipped CLI resolves the bridge to a REAL file on this tree', () => {
    // The strongest arm: not "the string is absent" but "the resolution
    // SUCCEEDS and lands on a file that exists". This is what makes the
    // repair a behaviour rather than a string edit.
    const resolved = loadResolver()();
    expect(resolved, 'the resolved bridge must be an absolute path').toMatch(/^\//);
    expect(statSync(resolved).isFile(), `resolved bridge must exist: ${resolved}`).toBe(true);
    expect(resolved, 'the resolved bridge must be inside the mcp-bridge package').toContain('mcp-bridge');
  });

  it('A6 — when NOTHING resolves, the resolver FAILS LOUDLY instead of returning a dead path', () => {
    // A MEASURED GAP, found by mutation, not by reading.
    //
    // Mutant M3 removed the `existsSync(candidate)` guard from the candidate
    // loop — the exact "silent zero" shape this repo keeps measuring (a
    // filter that drops everything reports an empty result instead of an
    // error). It SURVIVED arms A0-A5, because on THIS tree the first
    // candidate always exists: `require.resolve('woclaw-mcp')` resolves
    // through the workspace symlink, so the guard is never load-bearing
    // here. The guard IS load-bearing in the PACKED case — a published
    // tarball has no sibling package — and that is exactly the case a
    // suite that only runs on a checkout can never reach.
    //
    // So this arm measures the DECISION under a controlled namespace where
    // NO candidate can resolve: the resolver must THROW, and the error must
    // name the candidates, because the alternative (returning a path that
    // does not exist) hands the user an opaque module-resolution error from
    // the CHILD process with no indication of what was tried.
    // The resolver uses the module-scoped `require` for TWO things:
    // `require.resolve('woclaw-mcp')` (inside a try/catch) and
    // `require('child_process')` (NOT inside a try/catch). The stub must
    // serve the second call or the arm measures the stub instead of the
    // resolver.
    const stubRequire = Object.assign(
      (id: string) => {
        if (id === 'child_process') {
          return {
            execFileSync: () => {
              throw new Error('not found');
            },
          };
        }
        throw new Error(`unexpected require(${id})`);
      },
      {
        resolve: () => {
          throw new Error('Cannot find module \'woclaw-mcp\'');
        },
      },
    );
    const emptyDir = mkdtempSync(join(tmpdir(), 'r529-empty-'));
    let thrown: unknown = null;
    try {
      const resolve = loadResolver({
        require: stubRequire,
        dirname: emptyDir,
        // `fs.existsSync` returns false for a missing path; it never throws.
        // The stub MUST match that contract, or the arm measures the stub
        // instead of the resolver.
        existsSync: () => false,
      });
      const resolved = resolve();
      // If it did not throw, it returned a path that does not exist.
      expect(
        resolved,
        'the resolver returned a path that does not exist instead of failing loudly',
      ).toBe('');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'the resolver must THROW when no candidate resolves').not.toBeNull();
    const msg = (thrown as Error).message;
    expect(msg, 'the failure must name the defect').toContain('cannot find the MCP bridge');
    expect(msg, 'the failure must name the candidates it tried').toContain('mcp-bridge');
    expect(msg, 'the failure must name the PATH fallback it tried').toContain('woclaw-mcp');
    rmSync(emptyDir, { recursive: true, force: true });
  });
});

/**
 * Load `resolveMcpBridge` out of the shipped CLI.
 *
 * The CLI is an ESM module whose top level calls `main()`, which would try to
 * talk to a Hub. So the resolver is extracted TEXTUALLY and evaluated in a
 * controlled namespace supplying exactly the bindings the real file gets
 * (`__dirname`, `require`, `path`, `existsSync`) — the "observe the DECISION,
 * do not perform the CONSEQUENCE" rule (R198). The source under test is the
 * REAL shipped file, read from disk; nothing is copied or mutated.
 */
function loadResolver(opts?: { require?: unknown; dirname?: string; existsSync?: (p: string) => boolean }): () => string {
  const cliPath = join(REPO, 'plugin/bin/woclaw.js');
  const src = readFileSync(cliPath, 'utf8');

  const start = src.indexOf('function resolveMcpBridge()');
  expect(start, 'resolveMcpBridge must be present in the CLI source').toBeGreaterThan(-1);

  // Take the function body up to its matching close brace.
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) { end = j + 1; break; }
    }
  }
  expect(end, 'the resolver body must be extractable').toBeGreaterThan(-1);

  const fnSource = src.slice(start, end);

  // `createRequire` is an ESM import; the resolver uses the module-scoped
  // `require` binding. Recreate that binding the same way the file does.
  const { createRequire } = require('node:module');
  const scopedRequire = opts?.require ?? createRequire(cliPath);

  const factory = new Function(
    'require',
    'path',
    'existsSync',
    '__dirname',
    `${fnSource}\nreturn resolveMcpBridge;`,
  );

  return factory(
    scopedRequire,
    require('node:path'),
    opts?.existsSync ?? ((p: string) => statSync(p).isFile()),
    opts?.dirname ?? join(REPO, 'plugin', 'bin'),
  ) as () => string;
}
