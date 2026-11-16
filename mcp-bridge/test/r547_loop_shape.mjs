#!/usr/bin/env node
/**
 * R547 helper — executes the REAL read-loop arithmetic from
 * mcp-bridge/src/index.js against a real `process.stdin`.
 *
 * Why this exists
 * ---------------
 * The bridge's loop is:
 *
 *     for await (const chunk of rl) {
 *       buffer += chunk;
 *       const lines = buffer.split('\n');
 *       buffer = lines.pop() || '';
 *       for (const line of lines) { ...handle... }   // <-- what decides
 *     }                                                  //    if a request
 *                                                        //    is ever handled
 *
 * `readline`'s async iterator yields the line WITHOUT its terminator, so
 * `chunk` never contains '\n'. `buffer.split('\n')` yields exactly ONE
 * element (the whole chunk); `lines.pop()` takes it and MUTATES THE ARRAY
 * IN PLACE; so `lines` is EMPTY when the handler loop iterates it.
 *
 * This helper does NOT re-implement that arithmetic. It EXTRACTS the
 * statements from the real `src/index.js` and executes them, so that any
 * mutation of the bridge changes what this helper computes. (An earlier
 * version of this helper hard-coded the arithmetic in a separate file; the
 * mutation matrix correctly reported that arm as SURVIVED — the probe was
 * measuring a copy, not the subject.)
 *
 * It consumes a real `process.stdin` because readline's async iterator does
 * not settle on an in-memory PassThrough in this Node version.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'src', 'index.js');
const SRC = readFileSync(INDEX_PATH, 'utf-8');

// Extract the block of statements that decides what gets handled: from the
// `buffer += chunk;` accumulation up to (but not including) the handler loop.
const start = SRC.indexOf('buffer += chunk;');
const end = SRC.indexOf('for (const line of lines)', start);
if (start === -1 || end === -1) {
  process.stderr.write(JSON.stringify({
    extraction_failed: true,
    reason: 'could not locate the read-loop block in src/index.js',
    start, end,
  }) + '\n');
  process.exit(2);
}
const BLOCK = SRC.slice(start, end);

// Execute the real block for one chunk. `lines` is declared inside the block
// exactly as in the source, so `lines.pop()` mutates the same array the
// source would have iterated.
function runBlock(chunk) {
  const fn = new Function(
    'chunk',
    'let buffer = "";\n' + BLOCK + '\nreturn { lines, buffer };',
  );
  return fn(chunk);
}

const rl = createInterface({ input: process.stdin });
const report = [];

for await (const chunk of rl) {
  let lines;
  let buffer;
  let error = null;
  try {
    ({ lines, buffer } = runBlock(chunk));
  } catch (e) {
    error = e.message;
  }
  report.push({
    chunk: chunk.length > 120 ? chunk.slice(0, 120) + '…' : chunk,
    chunk_has_newline: chunk.includes('\n'),
    lines_to_handle: error ? null : lines.length,
    leftover_buffer_is_empty: error ? null : buffer === '',
    handled: error ? null : lines.length > 0,
    error,
  });
}

process.stdout.write(JSON.stringify({ block: BLOCK, report }, null, 2) + '\n');
