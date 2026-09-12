import { afterEach, describe, expect, it } from "vitest";

import { clearSessionCookie, sessionCookie } from "./principal";
import { deploymentIsHttps } from "./site-url";
import { securityHeaders } from "../http/security-headers";

/**
 * The flags that only exist outside local development.
 *
 * `Secure` and `Strict-Transport-Security` are the two things a deployment
 * gets that a developer's machine does not, which makes them the two least
 * likely to be exercised before somebody depends on them. They are also the
 * same decision — whether this deployment is reached over HTTPS — and nothing
 * would notice if they drifted apart, because each looks right on its own.
 *
 * Verified live as well, behind nginx with TLS: the session cookie came back
 * `HttpOnly; SameSite=Lax; Max-Age=1209600; Secure`, and the response carried
 * HSTS. These tests are what keeps that true.
 */

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

const asHttps = () => {
  process.env["OIKONOMIA_URL"] = "https://oikonomia.example.org";
};
const asLocal = () => {
  process.env["OIKONOMIA_URL"] = "http://localhost:8080";
};

describe("deciding whether this deployment is HTTPS", () => {
  it("reads the configured address, not the request", () => {
    asHttps();
    expect(deploymentIsHttps()).toBe(true);
    asLocal();
    expect(deploymentIsHttps()).toBe(false);
  });

  /* Unset: production is assumed to be served properly, development is not. */
  it("falls back to the environment when no address is configured", () => {
    delete process.env["OIKONOMIA_URL"];
    process.env["NODE_ENV"] = "production";
    expect(deploymentIsHttps()).toBe(true);

    process.env["NODE_ENV"] = "development";
    expect(deploymentIsHttps()).toBe(false);
  });
});

describe("the session cookie", () => {
  it("is always HttpOnly, SameSite=Lax and scoped to the whole site", () => {
    for (const configure of [asHttps, asLocal]) {
      configure();
      const cookie = sessionCookie("a-token");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    }
  });

  it("is Secure over HTTPS and not over plain localhost", () => {
    asHttps();
    expect(sessionCookie("a-token")).toContain("Secure");

    /* Marking it Secure on http://localhost stops the browser sending it at
       all, which looks like a broken login rather than a security setting. */
    asLocal();
    expect(sessionCookie("a-token")).not.toContain("Secure");
  });

  it("clears with the same flags it was set with", () => {
    asHttps();
    const cleared = clearSessionCookie();
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Max-Age=0");
  });

  it("carries the token, and never anything else about the session", () => {
    asHttps();
    const cookie = sessionCookie("a-token");
    expect(cookie.startsWith("oikonomia_session=a-token;")).toBe(true);
  });
});

/**
 * The property that makes these one decision rather than two.
 */
describe("the cookie and the transport policy agree", () => {
  it("sends HSTS exactly when the cookie is Secure", () => {
    for (const configure of [asHttps, asLocal]) {
      configure();
      const https = deploymentIsHttps();
      const secureCookie = sessionCookie("t").includes("Secure");
      const hsts = Boolean(
        securityHeaders({ https, development: false })["Strict-Transport-Security"],
      );

      expect(secureCookie, String(process.env["OIKONOMIA_URL"])).toBe(https);
      expect(hsts, String(process.env["OIKONOMIA_URL"])).toBe(https);
    }
  });
});
