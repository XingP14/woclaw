# M9 anchor — the EXACT twin of M8: a completely different edit shape that
# produces the same "merge everything except wsUrl" divergence. A suite that
# only caught M8's particular line order would miss this one.
# Usage: python3 scripts/anchors/m9.py src/federation.ts
import sys

OLD = """    if (existing) {
      Object.assign(existing, peer);
    } else {
      this.config.federationPeers.push(peer);
    }"""

NEW = """    if (existing) {
      Object.assign(existing, {
        status: peer.status,
        lastSeen: peer.lastSeen,
        connectedAgents: peer.connectedAgents,
        federationToken: peer.federationToken,
      });
    } else {
      this.config.federationPeers.push(peer);
    }"""

p = sys.argv[1]
s = open(p).read()
assert OLD in s, "M9 ANCHOR NOT FOUND"
assert s.count(OLD) == 1, f"M9 anchor not unique ({s.count(OLD)})"
open(p, 'w').write(s.replace(OLD, NEW))
