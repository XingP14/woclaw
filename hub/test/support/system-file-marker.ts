/**
 * The system-file marker, DERIVED from the host at runtime.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * The suites that guard the UI static server need a DETECTOR: a predicate
 * that answers "does this response body contain the bytes of a system
 * file?".  That detector is only load-bearing if it can actually FIRE on a
 * real system file -- otherwise every negative arm in the suite is
 * vacuously true (the "control that cannot fail" shape).
 *
 * The first version of that detector was:
 *
 *     /root:x:0:0/  ||  /root:\$1\$/  ||  /us-vps4/
 *
 * The first two arms are HOST-INDEPENDENT: the root line of /etc/passwd and
 * the root line of /etc/shadow have the same shape on every Linux.  The
 * THIRD arm was the author's own hostname, transcribed from the machine the
 * suite was written on.  On a CI runner the hostname is a different random
 * label, so /etc/hostname did not match -- and the control arm that asserts
 * "the detector CAN see a system file" FAILED on every push, on every
 * repository, while the product under test was perfectly correct.
 *
 * The fix is not "add more literals".  It is to DERIVE the marker from the
 * same file the escape names: /etc/hostname contains the host's own name, so
 * the marker for it is the CONTENT OF THAT FILE, read at runtime.
 *
 * THE INVARIANT THIS KEEPS
 * -------------------------
 * The control can never become vacuous: /etc/passwd is world-readable on
 * every Linux, so at least one marker is always available and always
 * matches real system-file bytes.
 *
 * NO CREDENTIAL IS EVER PRINTED.  The markers are used only as boolean
 * probes against a response body; bodies are never echoed into a failure
 * message.
 */
import { readFileSync } from 'fs';

/**
 * The markers, in the order they are probed.
 *
 * `root:x:0:0` -- the root line of /etc/passwd.  The passwd format is
 * fixed by the spec, so this is the same on every host.
 *
 * `root:$1$` -- the root line of /etc/shadow, for hosts where the shadow
 * file is readable by the test process.
 *
 * The hostname -- the CONTENT of /etc/hostname, not a literal.  There is
 * no host-independent way to recognise a hostname file by its bytes (its
 * whole content IS the host's name), so the marker has to come from the
 * file itself.
 */
function buildMarkers(): string[] {
  const markers = ['root:x:0:0', 'root:$1$'];

  let hostname = '';
  try {
    hostname = readFileSync('/etc/hostname', 'utf8').trim();
  } catch {
    // /etc/hostname is absent or unreadable on this host.  The passwd and
    // shadow markers still carry the control, so the suite does not become
    // vacuous -- it just loses one probe.
    hostname = '';
  }
  if (hostname.length > 0) {
    markers.push(hostname);
  }

  return markers;
}

const MARKERS = buildMarkers();

/**
 * Does this response body contain the bytes of a system file?
 *
 * This is the DETECTOR the negative arms rely on.  It must be able to fire
 * on real system-file content, on ANY host -- that is what makes the
 * negative arms meaningful rather than vacuous.
 */
export function isSystemFile(body: string): boolean {
  if (typeof body !== 'string' || body.length === 0) return false;
  return MARKERS.some((m) => body.includes(m));
}

/**
 * The markers themselves, for a suite that wants to assert the detector is
 * armed (e.g. "at least one marker exists and at least one real system
 * file is recognised").
 */
export function systemFileMarkers(): string[] {
  return [...MARKERS];
}
