import { afterEach, describe, expect, it, vi } from "vitest";

import { contentSecurityPolicy, securityHeaders, withSecurityHeaders } from "./security-headers";

const production = { https: true, development: false };

describe("what a browser is told to enforce", () => {
  it("always sets the headers that cost nothing anywhere", () => {
    for (const options of [production, { https: false, development: true }]) {
      const headers = securityHeaders(options);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["Permissions-Policy"]).toContain("camera=()");
    }
  });

  /* Vite's dev server needs eval and a websocket. A policy loosened until it
     permits those is not the policy production runs. */
  it("does not send a policy in development", () => {
    expect(
      securityHeaders({ https: false, development: true })["Content-Security-Policy"],
    ).toBeUndefined();
    expect(securityHeaders(production)["Content-Security-Policy"]).toBeDefined();
  });

  it("sends HSTS only over HTTPS", () => {
    expect(securityHeaders(production)["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(
      securityHeaders({ https: false, development: false })["Strict-Transport-Security"],
    ).toBeUndefined();
  });

  it("upgrades insecure requests only where there is something to upgrade to", () => {
    expect(contentSecurityPolicy(true)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy(false)).not.toContain("upgrade-insecure-requests");
  });
});

/**
 * The directives that matter are the ones that blunt the XSS this project
 * already had: script that runs but cannot phone home, and cannot be framed.
 */
describe("the directives that limit what a successful injection can do", () => {
  const policy = contentSecurityPolicy(true);

  it("refuses connections to anywhere but this origin", () => {
    expect(policy).toContain("connect-src 'self'");
  });

  it("refuses scripts, objects and frames from elsewhere", () => {
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
  });

  it("cannot be framed, so it cannot be clickjacked", () => {
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("pins where relative URLs and form posts go", () => {
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("allows the fonts the application actually loads, and no other origin", () => {
    expect(policy).toContain("https://fonts.gstatic.com");
    expect(policy).toContain("https://fonts.googleapis.com");
    expect(policy).not.toMatch(/https:\/\/(?!fonts\.)/);
  });
});

describe("applying them to a response", () => {
  it("never replaces a header the application set", () => {
    const response = new Response("hi", {
      headers: { "Set-Cookie": "oikonomia_session=abc; HttpOnly", "X-Frame-Options": "SAMEORIGIN" },
    });

    const out = withSecurityHeaders(response);
    expect(out.headers.get("Set-Cookie")).toBe("oikonomia_session=abc; HttpOnly");
    expect(out.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps the status and body it was given", async () => {
    const out = withSecurityHeaders(new Response("body", { status: 404 }));
    expect(out.status).toBe(404);
    expect(await out.text()).toBe("body");
  });
});

/**
 * A public demonstration asks not to be indexed; a church's own installation
 * does not. Same build, decided by the installation's environment.
 */
describe("asking search engines not to index", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a header only when asked for", () => {
    expect(securityHeaders({ ...production, noindex: true })["X-Robots-Tag"]).toBe(
      "noindex, nofollow",
    );
    expect(securityHeaders(production)["X-Robots-Tag"]).toBeUndefined();
    expect(securityHeaders({ ...production, noindex: false })["X-Robots-Tag"]).toBeUndefined();
  });

  it("is on every response of an installation in Demo Mode, whatever kind", () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const responses = [
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
      new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
      new Response(null, { status: 302, headers: { location: "/login" } }),
      new Response("error", { status: 500 }),
    ];
    for (const response of responses) {
      expect(withSecurityHeaders(response).headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("is absent from an ordinary installation, set or unset", () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
    expect(withSecurityHeaders(new Response("page")).headers.get("X-Robots-Tag")).toBeNull();

    delete process.env["OIKONOMIA_DEMO_MODE"];
    expect(withSecurityHeaders(new Response("page")).headers.get("X-Robots-Tag")).toBeNull();
  });

  /* Such an installation serves only its error page; the header must not be
     the thing that throws. */
  it("is sent, and does not throw, when the installation's policy cannot be read", () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "yes");
    const out = withSecurityHeaders(new Response("unavailable", { status: 503 }));
    expect(out.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
