// plugin/src/errors.ts
//
// Tiny helpers for `catch (e: unknown)` narrowing. Mirrors the hub
// pattern (see hub/src/errors.ts). Used by channel.ts to migrate
// the `catch (e)` sites that previously defaulted to implicit any
// (plugin/tsconfig.json has `strict: true`, so `e: unknown` is the
// correct explicit annotation).
//
// Why: with strict mode on, `catch (e)` would be flagged as needing
// annotation. Routing `.message` / string reads through a typed
// helper keeps logs useful even when a non-Error value is thrown.

/** Safely extract a human-readable message from an unknown caught value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e === undefined) return '';
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Like errorMessage, but returns the full Error.toString() when available. */
export function errorToString(e: unknown): string {
  if (e instanceof Error) return e.toString();
  return errorMessage(e);
}
