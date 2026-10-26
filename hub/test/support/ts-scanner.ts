/**
 * A COMMENT- and LITERAL-AWARE scanner for TypeScript source text.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Two of this repository's suites need to measure the CODE of a file
 * rather than its prose, and both were doing it with a regular
 * expression:
 *
 *     src.replace(BLOCK_COMMENT_RE, ' ')
 *        .replace(LINE_COMMENT_RE, '$1 ')
 *
 * where BLOCK_COMMENT_RE matches a block comment and LINE_COMMENT_RE
 * matches a line comment.  (The patterns are written out in prose here
 * rather than literally, because a literal block-comment delimiter
 * written inside this block comment would TERMINATE this block comment
 * early -- which is the very class of defect this file exists to fix.)
 *
 * That pair is WRONG in two independent ways, and both were measured:
 *
 * (1) A block-comment OPENER INSIDE a `//` line comment opens a PHANTOM
 *     block comment.
 *
 *     The non-greedy block-comment pattern matches from the FIRST opener
 *     to the NEXT closer.  When the opener came from a line comment -- for
 *     example the glob `hub/test/**` written in prose -- the pair it
 *     formed ran to the next REAL closer hundreds of lines away, and the
 *     stripper DELETED the code in between.
 *
 *     Measured on `test/r417_extraction_plane_unwired.test.ts`: the
 *     `const SRC = ...` declaration vanished from the stripped output
 *     entirely, so a suite asserting "this file is anchored to its own
 *     location" read an EMPTY string and went RED for a reason that had
 *     nothing to do with the file's subject.
 *
 *     The same defect makes a census SILENT: a file whose real
 *     `join(process.cwd(), ...)` happens to sit after a prose glob would
 *     not be flagged at all.
 *
 * (2) A STRING LITERAL is not CODE.  A suite that scans for code
 *     patterns must not match text that merely sits inside a string --
 *     including the very string a suite uses to describe the pattern it
 *     is hunting (a suite that scans itself will match its own
 *     negative-control literal).
 *
 *     Measured: `test/r507_cwd_anchored_subject_set.test.ts` flagged
 *     ITSELF, because its negative-control arm contains the literal
 *     text `const SRC = join(process.cwd(), 'src');`.
 *
 * THE FIX
 * -------
 * A single-pass scanner with an explicit state machine: line comments,
 * block comments, string literals (', " and `), and regex literals are
 * each recognised as such, so no pair of characters can be misread.
 *
 * TWO EXPORTS, TWO DIFFERENT QUESTIONS
 * ------------------------------------
 *   `stripComments(src)` -- comments become spaces, STRING CONTENTS are
 *     KEPT.  Use this when the question is about the LITERALS a file
 *     hardcodes ("does any source literal contain this host's name?").
 *
 *   `codeOnly(src)` -- comments AND string contents become spaces.  Use
 *     this when the question is about the CODE a file executes ("does
 *     any source build a path from process.cwd()?").
 *
 * ONE RULE, ONE COPY.  Two suites that both need "read the code of a
 * file" and each carry their own regex are two copies that will drift --
 * and these two copies HAD drifted, in exactly this way.
 */
export function stripComments(src: string): string {
  return scan(src, true);
}

export function codeOnly(src: string): string {
  return scan(src, false);
}

/** Characters that can legally precede a `/` that starts a regex. */
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '%', '~', '^', '<', '>', '\n', '',
]);

/**
 * Single-pass scanner.
 *
 * @param keepLiteralContents true  -> string contents are preserved
 *                           false -> string contents become spaces
 */
function scan(src: string, keepLiteralContents: boolean): string {
  const n = src.length;
  let out = '';
  let i = 0;

  /** The last non-whitespace character emitted, for regex detection. */
  function lastMeaningful(): string {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k];
      if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') return c;
    }
    return '';
  }

  /** Emit `text` either verbatim or as blanks (newlines preserved). */
  function emit(text: string): void {
    if (keepLiteralContents) {
      out += text;
      return;
    }
    for (const c of text) out += c === '\n' ? '\n' : ' ';
  }

  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';

    // ── line comment ────────────────────────────────────────────────
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    // ── block comment ───────────────────────────────────────────────
    if (c === '/' && c2 === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    // ── string literal (', " or `) ──────────────────────────────────
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          emit(src[i] + (i + 1 < n ? src[i + 1] : ''));
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out += quote;
          i++;
          break;
        }
        emit(src[i]);
        i++;
      }
      continue;
    }

    // ── regex literal ───────────────────────────────────────────────
    if (c === '/' && c2 !== '/' && c2 !== '*' && REGEX_PRECEDERS.has(lastMeaningful())) {
      out += '/';
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') {
          emit(src[i] + (i + 1 < n ? src[i + 1] : ''));
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) {
          out += '/';
          i++;
          break;
        }
        emit(src[i]);
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}
