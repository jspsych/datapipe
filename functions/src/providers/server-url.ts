// Shared SSRF allowlist gate for researcher-supplied server URLs.
//
// Lives here, standalone, rather than in connect-provider.ts (its original
// home) so that a federated provider adapter (dataverse.ts) can import it
// without creating a cycle: connect-provider.ts -> providers/index.js ->
// dataverse.ts -> connect-provider.ts. This module has no imports of its own,
// so both connect-provider.ts and any adapter under providers/ can depend on
// it safely.

// Rejects request bodies/stored fields that could turn our authenticated
// Dataverse client into a server-side request forgery (SSRF) primitive:
// serverUrl is researcher-supplied (at connect time via the request body, and
// on every subsequent call via the container ref stored in Firestore, which
// the experiment owner can write), and downloadFile echoes the response body
// straight back to the caller. Left unconstrained, that is a read-with-
// credentials proxy against Google Cloud's metadata service
// (169.254.169.254 / metadata.google.internal) and anything else reachable
// on the private network. This is DEFENSE IN DEPTH, NOT a complete SSRF
// defense -- a public DNS name can still resolve to an internal address
// after this check passes (DNS rebinding) -- so it only closes the cheap,
// obvious cases: non-https schemes, embedded credentials, non-default ports,
// loopback/internal-looking hostnames, and literal IP addresses. Researchers
// only ever connect to named institutional installations
// (dataverse.harvard.edu, demo.dataverse.org), never to a bare IP, so
// rejecting every IPv4/IPv6 literal outright costs nothing real and closes
// the whole class rather than trying to enumerate private ranges.
export function isAllowedServerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // Default-port URLs are normalized to "" by the URL parser, so this also
  // accepts an explicit ":443".
  if (url.port !== "" && url.port !== "443") return false;

  // Strip a single trailing dot before any comparison. "…internal." is the
  // explicit-root FQDN form and DNS resolves it identically to "…internal",
  // but it matches neither an equality check nor an endsWith(".internal")
  // one -- so without this, https://metadata.google.internal./ walks straight
  // through every rule below.
  const hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
  if (hostname === "localhost") return false;
  if (hostname.endsWith(".localhost")) return false;
  if (hostname.endsWith(".internal")) return false;
  if (hostname === "metadata.google.internal") return false;
  if (hostname.startsWith("[")) return false; // IPv6 literal
  // Reject every IPv4-shaped literal outright, including the
  // octal/decimal-shorthand forms (0177.0.0.1, 2130706433) that a naive
  // dotted-quad check would miss -- rather than trying to enumerate private
  // ranges.
  if (/^\d+(\.\d+)*$/.test(hostname)) return false;
  if (!hostname.includes(".")) return false; // rejects bare single-label internal names

  return true;
}
