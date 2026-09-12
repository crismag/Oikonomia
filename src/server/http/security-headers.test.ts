import { describe, expect, it } from "vitest";

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
