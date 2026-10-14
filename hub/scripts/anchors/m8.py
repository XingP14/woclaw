# M8 anchor — swap the ORDER of merge and dial inside addPeer, so the guard
# reads the OLD configured url instead of the incoming one. This is the coarsest
# edit that turns M4's dead conjunct into a live one.
# Usage: python3 scripts/anchors/m8.py src/federation.ts
import sys

OLD = """    if (existing) {
      Object.assign(existing, peer);
    } else {
      this.config.federationPeers.push(peer);
    }
    this.connectToPeer(peer);"""

NEW = """    if (existing) {
      Object.assign(existing, peer);
    } else {
      this.config.federationPeers.push(peer);
    }
    const wire = this.config.federationPeers.find(p => p.hubId === peer.hubId)!;
    this.connectToPeer({ ...peer, wsUrl: wire.wsUrl });"""

# NEW is deliberately a DIFFERENT ordering-only mutant: it reads `wire.wsUrl`
# from the configured list instead of passing the incoming peer, so the guard's
# second conjunct compares the configured (post-merge) url against a copy of
# itself. Kept separate from M9, which changes WHICH fields merge.
p = sys.argv[1]
s = open(p).read()
assert OLD in s, "M8 ANCHOR NOT FOUND"
assert s.count(OLD) == 1, f"M8 anchor not unique ({s.count(OLD)})"
open(p, 'w').write(s.replace(OLD, NEW))
