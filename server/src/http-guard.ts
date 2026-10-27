import net from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Loomwerk usually runs on loopback with an empty token, so the API is open to
// anything that can reach 127.0.0.1 — including the operator's own browser.
// Without these two checks any web page the operator visits could drive the
// API through that browser:
//
// - DNS rebinding: a page on attacker.example re-resolves its name to
//   127.0.0.1 and then reads and writes the API "same-origin". The browser
//   still sends `Host: attacker.example`, so a Host allowlist stops it.
// - Cross-site requests (CSRF): a plain form POST to /api/engine/cycle needs
//   no preflight and starts LLM cycles on the operator's key. Browsers mark
//   such requests with `Sec-Fetch-Site` and `Origin`; non-browser clients
//   (curl, webhooks, scripts) send neither and stay unaffected.
//
// Found in a source security review (2026-10-27); both were reachable with the
// default configuration.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DNS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

// Hostname of a Host header value ("localhost:7791", "[::1]:7791"), lowercased
// and without a trailing dot. Null for anything that is not a plain host[:port]
// — a userinfo part or a path has no business in a Host header.
export function hostnameFromHostHeader(value: string): string | null {
  const v = value.trim().toLowerCase();
  let host: string;
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end < 0) return null;
    host = v.slice(1, end);
    const rest = v.slice(end + 1);
    if (rest !== '' && !/^:\d+$/.test(rest)) return null;
    return net.isIPv6(host) ? host : null;
  }
  const m = /^([^:]+)(?::\d+)?$/.exec(v);
  if (!m?.[1]) return null;
  host = m[1].replace(/\.$/, '');
  if (net.isIP(host)) return host;
  return DNS_NAME.test(host) ? host : null;
}

// Allowed without configuration: IP literals (a rebinding page cannot make the
// browser send one for its own origin), `localhost` and `*.localhost` (RFC 6761,
// browsers resolve them to loopback, nobody can register them). Everything else
// — a reverse-proxy domain, a Docker service name — must be listed in
// LOOMWERK_ALLOWED_HOSTS. An entry with a leading dot also covers subdomains.
export function isAllowedHostname(hostname: string, extraHosts: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (net.isIP(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  return isConfiguredHostname(h, extraHosts);
}

// Only the operator's LOOMWERK_ALLOWED_HOSTS entries, no implicit names.
function isConfiguredHostname(hostname: string, extraHosts: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return extraHosts.some((entry) => {
    const e = entry.toLowerCase().replace(/\.$/, '');
    if (e.startsWith('.')) return h === e.slice(1) || h.endsWith(e);
    return h === e;
  });
}

// The Origin must be the server's own origin: same host AND port as the Host
// header. The free pass for IP literals and localhost that the Host check
// grants does not carry over — an attacker can serve a page from an IP address
// or from another port on localhost, and that page's Origin would pass a
// hostname-only check. Behind a reverse proxy that rewrites Host, the public
// name counts too, but only when it is listed in LOOMWERK_ALLOWED_HOSTS.
function originIsAllowed(origin: string, hostHeader: string, extraHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin); // "null" (sandboxed iframes, file://) throws here
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  try {
    // Same scheme on both sides, so default ports (":80", ":443") normalize alike.
    if (new URL(`${url.protocol}//${hostHeader}`).host === url.host) return true;
  } catch {
    // unparsable Host was already rejected; fall through to the allowlist
  }
  return isConfiguredHostname(url.hostname.replace(/^\[(.*)\]$/, '$1'), extraHosts);
}

function reject(res: Response, error: string): void {
  res.status(403).json({ error });
}

export function requestGuard(extraHosts: readonly string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host;
    const hostname = hostHeader ? hostnameFromHostHeader(hostHeader) : null;
    if (!hostHeader || !hostname || !isAllowedHostname(hostname, extraHosts)) {
      reject(res, `host not allowed: ${hostHeader ?? '(none)'} — add it to LOOMWERK_ALLOWED_HOSTS`);
      return;
    }

    if (!SAFE_METHODS.has(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        reject(res, 'cross-site request rejected');
        return;
      }
      const origin = req.headers.origin;
      if (origin !== undefined && !originIsAllowed(origin, hostHeader, extraHosts)) {
        reject(res, `origin not allowed: ${origin}`);
        return;
      }
    }

    next();
  };
}
