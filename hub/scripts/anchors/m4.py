# M4 anchor definition — kept in its own file so no shell can expand ${...},
# and the source text is pasted here verbatim from src/federation.ts:98-101.
# Usage: python3 scripts/anchors/m4.py src/federation.ts
import sys

OLD = """    if (this.peers.has(peer.hubId)) {
      fedLog(`Already connected to ${peer.hubId}`);
      return;
    }"""

NEW = """    const live = this.peers.get(peer.hubId);
    if (live && this.config.federationPeers?.find(p => p.hubId === peer.hubId)?.wsUrl === peer.wsUrl) {
      fedLog(`Already connected to ${peer.hubId}`);
      return;
    }"""

p = sys.argv[1]
s = open(p).read()
assert OLD in s, "ANCHOR NOT FOUND"
assert s.count(OLD) == 1, f"anchor not unique ({s.count(OLD)})"
open(p, 'w').write(s.replace(OLD, NEW))
