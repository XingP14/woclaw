"""
packages/codex-woclaw-example/example_log.py

Centralized `[WoClaw] ` prefix helpers for the woclaw-codex-example reference
Python client (10th subpackage consolidation — Python parallel to the
chain #10 `cli_log` 9th subpackage consolidation in woclaw-hooks).

Mirrors the federation_log / hub_log / scheduler_log / db_log /
plugin_log / mcp_log / opencode_plugin_log helper-extraction pattern,
adapted to Python print() instead of console.*. All helpers prepend
`[WoClaw] ` to a single message string and forward to print(); existing
call sites that previously wrote `print(f"[WoClaw] ...")` collapse to
`example_log("...")` with byte-identical wire format.

Usage:
    from example_log import example_log, example_warn, example_err
    example_log("Connected as", AGENT_ID)
    # → print("[WoClaw] Connected as", AGENT_ID)
    example_warn("Joined topic:", topic)
    # → print("[WoClaw][warn] Joined topic:", topic)
    example_err("Hub unreachable:", e)
    # → print("[WoClaw][error] Hub unreachable:", e)

Strategy:
    - All helpers forward to `print(...)` so existing
      `print(f"[WoClaw] ...")` call sites collapse with byte-identical
      wire format (no stream-level changes: stdout stays stdout).
    - The `[WoClaw] ` literal is confined to this module so a future
      prefix change (e.g. `[WoClaw Example]`) requires one edit here.
    - multi-arg passthrough (sep defaults to ' ') so callers can keep
      their structured payload alongside the message.

Why chain #11:
    - chain #10 (cli_log) consolidated 49 emoji-decoration sites in
      woclaw-hooks + 4 cross-subpackage sites in codex-woclaw/bin/cli.js
      = 9th subpackage. woclaw-codex-example is the **10th subpackage**
      with `[WoClaw] ` prefix duplication: 6 inline sites in
      codex_example.py (L103/110/116/142/150/152) across ws_connect,
      ws_join_topic, ws_send_message, save_codex_context_to_hub,
      load_hub_context_to_codex ×2 functions.
    - Sub-package is Python only (no build step), so the helper is a
      plain module imported via `from example_log import ...`. The
      8th subpackage `codex-woclaw-example` (added 06-28 bbf2489) has
      been the only woclaw monorepo sub-package without its own
      log-helper module.
"""


def example_log(*args):
    """Log an informational message prefixed with `[WoClaw]`.

    Forwards to `print(*args)` after prepending the `[WoClaw] ` marker.
    Wire format: `print("[WoClaw]", *args)` — byte-identical to the
    pre-refactor `print(f"[WoClaw] {msg}")` form (the helper accepts
    multiple positional args which print joins with a space by default).
    """
    print("[WoClaw]", *args)


def example_warn(*args):
    """Log a warning message prefixed with `[WoClaw][warn]`.

    Same wire format as `example_log` but adds the `[warn]` level tag
    so downstream log parsers can filter by severity.
    """
    print("[WoClaw][warn]", *args)


def example_err(*args):
    """Log an error message prefixed with `[WoClaw][error]`.

    Same wire format as `example_log` but adds the `[error]` level tag.
    Note: still routes to stdout (matching pre-refactor `print(...)`
    sites); the prefix tag is the only severity signal.
    """
    print("[WoClaw][error]", *args)
