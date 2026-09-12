import { describe, expect, it } from "vitest";

import {
  landingFor,
  linkProblemMessage,
  magicLinkSent,
  mayEnter,
  passwordResetSent,
  safeReturnTo,
  signInFailure,
  statusExplanation,
  type AuthSession,
} from "./auth";

/**
 * Identity rules.
 *
 * The identity behind these is a mock; the rules are not. Two of them would be
 * real vulnerabilities if they were wrong — **open redirect** and **account
 * enumeration** — so they are tested as carefully as anything in this codebase.
 */

describe("where a sign-in may send somebody afterwards", () => {
  it("allows this application's own paths", () => {
    expect(safeReturnTo("/leadership-reports/lr-1")).toBe("/leadership-reports/lr-1");
    expect(safeReturnTo("/weekly-agenda?view=list")).toBe("/weekly-agenda?view=list");
  });

  /**
   * The vulnerability this exists to prevent: a sign-in page that honours
   * `?next=` without checking will bounce a leader to somebody else's site,
   * with Oikonomia's own page as the thing that lent it credibility.
   */
  it("refuses anywhere that is not this application", () => {
    const elsewhere = [
      "https://evil.example/steal",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/\\/evil.example",
      "data:text/html,hi",
      "mailto:someone@example.org",
    ];
    for (const destination of elsewhere) {
      expect(safeReturnTo(destination), destination).toBeUndefined();
    }
  });

  /** A scheme hidden behind extra slashes is still a scheme. */
  it("refuses a scheme however it is padded", () => {
    expect(safeReturnTo("///https://evil.example")).toBeUndefined();
    expect(safeReturnTo("/https:evil")).toBeUndefined();
  });

  it("refuses control characters, which a path has no business carrying", () => {
    expect(safeReturnTo("/reports\t/x")).toBeUndefined();
    expect(safeReturnTo("/reports\nSet-Cookie: x")).toBeUndefined();
  });

  /** Sending somebody back to sign in after signing in is a loop. */
  it("refuses the sign-in page itself", () => {
    expect(safeReturnTo("/login")).toBeUndefined();
    expect(safeReturnTo("/login?next=/")).toBeUndefined();
  });

  it("falls back to the leader's own home when there is nothing safe", () => {
    expect(landingFor("https://evil.example")).toBe("/");
    expect(landingFor(undefined)).toBe("/");
    expect(landingFor("/goals")).toBe("/goals");
  });
});

/**
 * The difference between "no such account" and "wrong password" is exactly
 * what somebody enumerating accounts is looking for.
 */
describe("what a failure is allowed to say", () => {
  it("says the same thing whether the account exists or the password was wrong", () => {
    expect(signInFailure("credentials")).toBe(
      "We could not sign you in. Check your details and try again.",
    );
  });

  it("says nothing about accounts, passwords, hashes or users", () => {
    const forbidden = ["exists", "not found", "no account", "hash", "incorrect password", "user"];
    for (const kind of ["credentials", "network", "rate-limited"] as const) {
      const message = signInFailure(kind).toLowerCase();
      for (const word of forbidden) {
        expect(message, `${kind}: ${word}`).not.toContain(word);
      }
    }
  });

  /** Not the leader's fault, and retrying is the right response. */
  it("distinguishes a failure to reach the server from a refusal", () => {
    expect(signInFailure("network")).not.toBe(signInFailure("credentials"));
    expect(signInFailure("rate-limited")).not.toBe(signInFailure("credentials"));
  });

  /**
   * Phrased as a condition, so it reads identically to somebody who has an
   * account and somebody probing for one.
   */
  it("confirms a link request without confirming the account", () => {
    const message = magicLinkSent("someone@example.org");
    expect(message.startsWith("If an Oikonomia account exists")).toBe(true);
    expect(message).not.toMatch(/we have sent you|your account/i);
    expect(
      passwordResetSent("someone@example.org").startsWith("If an Oikonomia account exists"),
    ).toBe(true);
  });

  it("explains a broken link without naming the token or the reason in detail", () => {
    for (const problem of ["expired", "used", "invalid"] as const) {
      const { title, body } = linkProblemMessage[problem];
      expect(title).toBeTruthy();
      expect(`${title} ${body}`.toLowerCase()).not.toMatch(/token|hash|signature|jwt|database/);
    }
  });
});

describe("what a session permits", () => {
  const session = (over: {
    [K in keyof AuthSession]?: AuthSession[K] | undefined;
  }): AuthSession =>
    ({
      status: "authenticated",
      membership: {
        organizationName: "Church",
        roleLabel: "Leader",
        status: "active",
      },
      ...(over.membership !== undefined || "membership" in over
        ? { membership: over.membership }
        : {}),
    }) as AuthSession;

  it("lets an active member in", () => {
    expect(mayEnter(session({}))).toBe(true);
  });

  /**
   * Proving who you are is not being allowed in. Oikonomia is a private church
   * application, and a valid Google account is not a membership.
   */
  it("does not let somebody in merely because they are authenticated", () => {
    expect(mayEnter(session({ status: "authenticated_no_access", membership: undefined }))).toBe(
      false,
    );
    expect(
      mayEnter(
        session({
          membership: { organizationName: "Church", roleLabel: "Leader", status: "invited" },
        }),
      ),
    ).toBe(false);
    expect(
      mayEnter(
        session({
          membership: { organizationName: "Church", roleLabel: "Leader", status: "suspended" },
        }),
      ),
    ).toBe(false);
  });

  it("does not let an unauthenticated or erroring session in", () => {
    expect(mayEnter({ status: "unauthenticated" })).toBe(false);
    expect(mayEnter({ status: "error" })).toBe(false);
    expect(mayEnter({ status: "loading" })).toBe(false);
  });

  /**
   * Why an account was suspended is between an administrator and the person.
   * A sign-in screen is not where that conversation happens.
   */
  it("explains each state without administrative or security detail", () => {
    for (const state of ["unauthenticated", "authenticated_no_access", "suspended"] as const) {
      const { title, body } = statusExplanation[state];
      expect(title).toBeTruthy();
      expect(`${title} ${body}`.toLowerCase()).not.toMatch(
        /banned|violation|fraud|locked out|security team|policy breach/,
      );
    }
  });
});
