#!/usr/bin/env python3
"""
R503 -- THE FINDING, CONSOLIDATED: the source list enumerates NAMES where it
must express a ROLE.

THE TWO LISTS
--------------
The detector recognises an attacker-controlled value by matching a SPELLING:

    REQ_SOURCE = \\b(?:req|request|ctx)\\s*\\??\\.\\s*(?:url|originalUrl|path|
                  params|query|body)\\b
    MSG_SOURCE = \\b(?:msg|message|envelope|frame|payload|evt|event|body|peer|
                  agent|delegation|notification)\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*

Both lists name OBJECTS (`req`, `request`, `ctx`, `msg`, ...) and the HTTP arm
also names FIELDS (`url`, `originalUrl`, `path`, `params`, `query`, `body`).

So there are two independent lists, and each one is CLOSED:

  * a request-shaped object with a field called `relPath`, `target`,
    `resource`, `file`, `filename` or `q` is INVISIBLE -- those are ordinary
    names, not exotic ones;
  * a request-shaped object called `httpReq` or `incoming` is INVISIBLE --
    those are ordinary names too.

WHAT MAKES IT A FINDING RATHER THAN A STYLE NOTE
-------------------------------------------------
The MESSAGE arm already demonstrates the correct shape: it names the OBJECTS
and then accepts ANY field of them.  The HTTP arm does not.  The SAME value,
in the SAME position, in the SAME sink, gets a DIFFERENT verdict depending
on the spelling of the field or of the object that carries it.

And the consequence is not academic: `req.headers` appears 7 times in
woclaw's `hub/src` and is NOT in the HTTP field list, so a path built from a
request header is invisible to the detector.  `req.userId` (12 occurrences in
llm-benchmark) and `req.username` (2) are likewise invisible.

THE GENERALISATION (the transferable rule)
-------------------------------------------
A source list should express a ROLE, not a vocabulary:

    the value is attacker-controlled  <=>  it is read off an object that
                                         CARRIES ATTACKER-CONTROLLED FIELDS

The role can be recognised structurally -- an HTTP request/middleware
parameter, a peer message, a frame, a body -- and then EVERY field of it is
a source, whatever the field is called.  That is what the MSG arm already
does; the HTTP arm's field list is the redundancy.

This is R449-1's shape one level down ("a field name is not an authority")
and R438's shape ("a list of names is a stated number with no binding").

USAGE
-----
    python3 r503_source_enumeration.py [--detector PATH] [--json]
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DEFAULT_DETECTOR = os.path.join(HERE, "r502_detector.py")

PREAMBLE = """import fs from 'fs';
import path from 'path';
const readFileSync = fs.readFileSync;
"""

# Field names chosen to span ORDINARY usage.  The first six are the ones the
# HTTP source list names; the rest are names an ordinary codebase would use.
HTTP_FIELDS = [
    "url", "originalUrl", "path", "params", "query", "body",     # named
    "relPath", "target", "resource", "filename", "anythingAtAll",  # NOT named
]

# Object names chosen the same way.
HTTP_OBJECTS = [
    "req", "request", "ctx",      # named by the HTTP arm
    "httpReq", "incoming", "r",   # NOT named
]

MSG_OBJECTS = ["msg", "message", "envelope", "frame", "payload", "evt",
               "event", "body", "peer", "agent", "delegation",
               "notification", "incoming", "data"]


def md5(path: str) -> str:
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def case(obj: str, field: str) -> str:
    return (PREAMBLE +
            "export function handler(%s: any) {\n"
            "  const p = path.join('/srv/public', %s.%s);\n"
            "  return readFileSync(p);\n"
            "}\n" % (obj, obj, field))


def measure(detector: str, cases):
    d = tempfile.mkdtemp(prefix="r503-src-")
    for fn, src in cases:
        with open(os.path.join(d, fn), "w", encoding="utf8") as f:
            f.write(src)
    proc = subprocess.run([sys.executable, detector, d],
                          capture_output=True, text=True, timeout=300)
    if proc.returncode not in (0, 1):
        raise RuntimeError("detector exited %d: %s" % (proc.returncode,
                                                       proc.stderr[-500:]))
    fired = set()
    for line in proc.stdout.split("\n"):
        m = re.match(r"^\[(HIGH|LOW\s*)\]\s+\S+/([^/]+\.ts):\d+", line)
        if m:
            fired.add(m.group(2))
    return fired


def run_group(detector, prefix, objs, fields):
    """Fire the detector at one case per (object, field) pair.

    Returns (hit_labels, missed_labels, fired_filenames) where the labels
    are the OBJECT names for the object group and the FIELD names for the
    field group -- the caller decides which, by passing the same value in
    both lists.  A first draft printed the FIELD names for the object group
    too, so the report said "hit: url, url, url" -- a report that cannot be
    read is a report that cannot be believed.
    """
    cases = [("%s_%02d.ts" % (prefix, i), case(o, f))
             for i, (o, f) in enumerate(zip(objs, fields))]
    fired = measure(detector, cases)
    labels = objs if prefix != "hf" else fields
    hit = [labels[i] for i in range(len(labels))
           if "%s_%02d.ts" % (prefix, i) in fired]
    miss = [labels[i] for i in range(len(labels))
            if "%s_%02d.ts" % (prefix, i) not in fired]
    return hit, miss, fired


def main() -> int:
    detector = DEFAULT_DETECTOR
    if "--detector" in sys.argv:
        detector = sys.argv[sys.argv.index("--detector") + 1]
    if not os.path.exists(detector):
        print("detector not found: %s" % detector)
        return 2

    facts = {"detector": os.path.basename(detector),
             "detector_md5": md5(detector)}

    # --- the HTTP FIELD list ---------------------------------------------
    f_hit, f_miss, _ = run_group(detector, "hf", ["request"] * len(HTTP_FIELDS),
                                 HTTP_FIELDS)
    # --- the HTTP OBJECT list --------------------------------------------
    o_hit, o_miss, _ = run_group(detector, "ho", HTTP_OBJECTS,
                                 ["url"] * len(HTTP_OBJECTS))
    # --- the MESSAGE object list -----------------------------------------
    m_hit, m_miss, _ = run_group(detector, "mo", MSG_OBJECTS,
                                 ["anyField"] * len(MSG_OBJECTS))

    facts["http_field_hit"] = f_hit
    facts["http_field_missed"] = f_miss
    facts["http_object_hit"] = o_hit
    facts["http_object_missed"] = o_miss
    facts["msg_object_hit"] = m_hit
    facts["msg_object_missed"] = m_miss
    facts["http_field_sensitivity"] = "%d/%d" % (len(f_hit), len(HTTP_FIELDS))
    facts["http_object_sensitivity"] = "%d/%d" % (len(o_hit), len(HTTP_OBJECTS))
    facts["msg_object_sensitivity"] = "%d/%d" % (len(m_hit), len(MSG_OBJECTS))

    # --- the CONTROLLED comparison ---------------------------------------
    # Identical code; the field is one the HTTP arm does NOT name; the ONLY
    # difference between the two cases is the OBJECT's name.
    probe_field = "relPath"
    ctrl = measure(detector, [("ctrl_http.ts", case("request", probe_field)),
                              ("ctrl_msg.ts", case("msg", probe_field))])
    facts["controlled_probe"] = {"field": probe_field,
                                 "request_obj_fired": "ctrl_http.ts" in ctrl,
                                 "msg_obj_fired": "ctrl_msg.ts" in ctrl}

    print("detector %s  md5 %s" % (facts["detector"], facts["detector_md5"]))
    print()
    print("HTTP  FIELD list (CLOSED): %s" % facts["http_field_sensitivity"])
    print("  hit  : %s" % ", ".join(f_hit))
    print("  MISS : %s" % ", ".join(f_miss))
    print()
    print("HTTP  OBJECT list (CLOSED): %s" % facts["http_object_sensitivity"])
    print("  hit  : %s" % ", ".join(o_hit))
    print("  MISS : %s" % ", ".join(o_miss))
    print()
    print("MESSAGE OBJECT list (OPEN) : %s" % facts["msg_object_sensitivity"])
    print("  hit  : %s" % ", ".join(m_hit))
    print("  MISS : %s" % ", ".join(m_miss))
    print()
    print("CONTROLLED PROBE -- identical code, field `%s`, only the OBJECT's"
          % probe_field)
    print("name differs:")
    print("  request.%s -> fired=%s" % (probe_field,
                                         facts["controlled_probe"]["request_obj_fired"]))
    print("  msg.%s     -> fired=%s" % (probe_field,
                                        facts["controlled_probe"]["msg_obj_fired"]))
    print()
    if "--json" in sys.argv:
        print(json.dumps(facts, indent=2))

    # The finding holds when BOTH lists are closed AND the controlled probe
    # shows the SAME field firing under the message object but not the
    # request object.
    finding = (bool(f_miss) and bool(o_miss)
               and facts["controlled_probe"]["msg_obj_fired"]
               and not facts["controlled_probe"]["request_obj_fired"])
    print("%-6s FINDING: the source list enumerates NAMES where it must "
          "express a ROLE" % ("PASS" if finding else "FAIL"))
    return 0 if finding else 1


if __name__ == "__main__":
    raise SystemExit(main())
