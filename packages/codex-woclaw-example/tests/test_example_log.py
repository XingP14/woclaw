#!/usr/bin/env python3
"""
Regression tests for chain #11: example_log helper module.

Mirrors the pattern from chain #10 cli-log.test.js (12 tests across
module-shape / canonical-signature / runtime-wire-format / closure
gates) adapted to Python's stdlib unittest.

Why these tests:
  - example_log / example_warn / example_err all forward to print(...)
    after prepending the `[WoClaw]` marker. A regression that drops
    the prefix, drops the level tag, or changes the print stream
    would silently break the downstream log parser.
  - The 6 inline `print("[WoClaw] ...")` call sites in
    codex_example.py must be fully migrated to `example_log(...)`.
    A regression that re-introduces an inline prefix would
    duplicate the chain-extraction debt that this round eliminated.

Runs under `python3 -m unittest` (Python 3.8+) — no extra deps.
"""

import contextlib
import importlib.util
import io
import os
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
EXAMPLE_LOG = PKG_ROOT / "example_log.py"
CODEX_EXAMPLE = PKG_ROOT / "codex_example.py"


def _load_example_log():
    spec = importlib.util.spec_from_file_location("example_log", str(EXAMPLE_LOG))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _capture(fn, *args):
    """Invoke fn(*args) and capture stdout."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args)
    return buf.getvalue()


class ModuleShapeTests(unittest.TestCase):
    """example_log.py exports exactly 3 helpers with the canonical names."""

    def test_three_helpers_exported(self):
        mod = _load_example_log()
        for name in ("example_log", "example_warn", "example_err"):
            self.assertTrue(
                hasattr(mod, name),
                f"example_log.py must export `{name}`",
            )
            self.assertTrue(
                callable(getattr(mod, name)),
                f"example_log.{name} must be callable",
            )

    def test_no_other_public_helpers(self):
        mod = _load_example_log()
        public = [
            n for n in dir(mod)
            if not n.startswith("_") and callable(getattr(mod, n))
        ]
        # Exactly the 3 helpers, nothing else.
        self.assertEqual(
            sorted(public),
            ["example_err", "example_log", "example_warn"],
            f"unexpected public callable exports: {public}",
        )


class CanonicalSignatureTests(unittest.TestCase):
    """Each helper accepts *args (variadic positional), matching print()."""

    def test_example_log_accepts_one_arg(self):
        mod = _load_example_log()
        out = _capture(mod.example_log, "hello")
        self.assertEqual(out, "[WoClaw] hello\n")

    def test_example_log_accepts_multi_args(self):
        mod = _load_example_log()
        out = _capture(mod.example_log, "Connected as", "agent-123")
        # print joins multiple args with a space by default — wire-format
        # byte-identical to the pre-refactor `print(f"[WoClaw] Connected as {AGENT_ID}")`
        # form when AGENT_ID == "agent-123" (print joins with one space).
        self.assertEqual(out, "[WoClaw] Connected as agent-123\n")

    def test_example_warn_includes_warn_tag(self):
        mod = _load_example_log()
        out = _capture(mod.example_warn, "reconnecting")
        self.assertEqual(out, "[WoClaw][warn] reconnecting\n")

    def test_example_err_includes_error_tag(self):
        mod = _load_example_log()
        out = _capture(mod.example_err, "Hub unreachable:", "ECONNREFUSED")
        self.assertEqual(out, "[WoClaw][error] Hub unreachable: ECONNREFUSED\n")


class RuntimeWireFormatTests(unittest.TestCase):
    """Wire-format byte-identical to pre-refactor inline `print(f"[WoClaw] ...")`."""

    def test_wire_format_matches_pre_refactor_connected_as(self):
        # Pre: print(f"[WoClaw] Connected as {AGENT_ID}") with AGENT_ID="agent-1"
        # → stdout: "[WoClaw] Connected as agent-1\n"
        # Post: example_log(f"Connected as {'agent-1'}")
        # → example_log calls print("[WoClaw]", "Connected as", "agent-1")
        # → stdout: "[WoClaw] Connected as agent-1\n"
        # byte-identical.
        mod = _load_example_log()
        agent_id = "agent-1"
        out = _capture(mod.example_log, f"Connected as {agent_id}")
        self.assertEqual(out, f"[WoClaw] Connected as {agent_id}\n")

    def test_wire_format_matches_pre_refactor_joined_topic(self):
        mod = _load_example_log()
        topic = "general"
        out = _capture(mod.example_log, f"Joined topic: {topic}")
        self.assertEqual(out, f"[WoClaw] Joined topic: {topic}\n")

    def test_wire_format_matches_pre_refactor_no_context(self):
        # Pre: print("[WoClaw] No shared context found")
        # → stdout: "[WoClaw] No shared context found\n"
        # Post: example_log("No shared context found")
        # → example_log calls print("[WoClaw]", "No shared context found")
        # → stdout: "[WoClaw] No shared context found\n"
        # byte-identical.
        mod = _load_example_log()
        out = _capture(mod.example_log, "No shared context found")
        self.assertEqual(out, "[WoClaw] No shared context found\n")


class ClosureTests(unittest.TestCase):
    """codex_example.py fully migrated: import wired, 6 callsites, 0 inline literals."""

    def setUp(self):
        self.src = CODEX_EXAMPLE.read_text()

    def test_example_log_import_present(self):
        self.assertRegex(
            self.src,
            r"from\s+example_log\s+import\s+example_log\b",
            "codex_example.py must import example_log from ./example_log",
        )

    def test_no_inline_woclaw_print_remaining(self):
        # Strip comments to avoid false positives on documentation strings
        # that legitimately contain the prefix as an example.
        code_only = re.sub(r"#[^\n]*", "", self.src)
        # Match any print(...) call whose literal/f-string contains the
        # [WoClaw] prefix. Such a regression would re-introduce the
        # prefix-duplication debt.
        inline_plain = re.findall(r'print\(["\'][^"\']*\[WoClaw\][^"\']*["\']', code_only)
        inline_f = re.findall(r'print\(f["\'][^"\']*\[WoClaw\][^"\']*["\']', code_only)
        self.assertEqual(
            len(inline_plain),
            0,
            f"regression: inline print('[WoClaw] ...') remaining: {inline_plain}",
        )
        self.assertEqual(
            len(inline_f),
            0,
            f"regression: inline print(f'[WoClaw] ...') remaining: {inline_f}",
        )

    def test_six_example_log_call_sites(self):
        callsites = re.findall(r"\bexample_log\(", self.src)
        # Exactly 6 — 1 in ws_connect, 1 in ws_join_topic, 1 in
        # ws_send_message, 1 in save_codex_context_to_hub, 2 in
        # load_hub_context_to_codex (one inside the `if exists` branch
        # and one in the `else` fall-through).
        self.assertEqual(
            len(callsites),
            6,
            f"expected exactly 6 example_log() call sites, found {len(callsites)}",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
