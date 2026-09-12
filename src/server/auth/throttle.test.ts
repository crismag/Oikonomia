import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "../services/auth-service";
import { createThrottle, nextState, policies, throttleKey } from "./throttle";
import type { Database as Db } from "better-sqlite3";

/**
 * Slowing somebody down.
 *
 * Every refusal used to be recorded and then permitted again immediately, so a
 * password could be guessed as fast as the network allowed.
 */

let dir: string;
let db: Db;
let now = Date.parse("2026-09-12T09:00:00.000Z");
const clock = () => now;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-throttle-"));
  db = openDatabase(join(dir, "test.db"));
  now = Date.parse("2026-09-12T09:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the arithmetic, without a database", () => {
  const policy = { attempts: 3, windowMs: 60_000, blockMs: 120_000 };
  const t0 = Date.parse("2026-09-12T09:00:00.000Z");

  it("starts a window at one failure", () => {
    expect(nextState(undefined, policy, t0)).toMatchObject({ attempts: 1 });
    expect(nextState(undefined, policy, t0).blockedUntil).toBeUndefined();
  });

  it("blocks on reaching the limit, not before", () => {
    const row = (attempts: number) => ({
      key: "k",
      windowStartedAt: new Date(t0).toISOString(),
      attempts,
    });

    expect(nextState(row(1), policy, t0 + 1_000).blockedUntil).toBeUndefined();
    expect(nextState(row(2), policy, t0 + 1_000).blockedUntil).toBeDefined();
  });

  /* The limit is "three in a minute", not "three ever". */
  it("starts counting again once the window has closed", () => {
    const stale = { key: "k", windowStartedAt: new Date(t0).toISOString(), attempts: 2 };
    const after = nextState(stale, policy, t0 + policy.windowMs + 1);

    expect(after.attempts).toBe(1);
    expect(after.blockedUntil).toBeUndefined();
  });

  it("folds case, so casing cannot evade the count", () => {
    expect(throttleKey("password", "  Alice@Example.ORG ")).toBe("password:alice@example.org");
  });

  it("keeps the kinds apart, so signing in does not spend the reset budget", () => {
    expect(throttleKey("password", "a@b.org")).not.toBe(throttleKey("password-reset", "a@b.org"));
  });
});

describe("the throttle against a database", () => {
  it("blocks after the configured number of failures", () => {
    const throttle = createThrottle(db, clock);

    for (let i = 1; i < policies.password.attempts; i++) {
      throttle.fail("password", "alice@example.org");
      expect(throttle.blocked("password", "alice@example.org"), `after ${i}`).toBe(false);
    }

    expect(throttle.fail("password", "alice@example.org")).toBe(true);
    expect(throttle.blocked("password", "alice@example.org")).toBe(true);
  });

  it("lets them try again once the block expires", () => {
    const throttle = createThrottle(db, clock);
    for (let i = 0; i < policies.password.attempts; i++) throttle.fail("password", "a@b.org");
    expect(throttle.blocked("password", "a@b.org")).toBe(true);

    now += policies.password.blockMs + 1;
    expect(throttle.blocked("password", "a@b.org")).toBe(false);
  });

  /* Hammering a locked subject keeps it locked rather than running the block out. */
  it("extends the block when somebody keeps trying", () => {
    const throttle = createThrottle(db, clock);
    for (let i = 0; i < policies.password.attempts; i++) throttle.fail("password", "a@b.org");

    now += policies.password.blockMs - 1_000;
    throttle.fail("password", "a@b.org");

    now += 2_000;
    expect(throttle.blocked("password", "a@b.org")).toBe(true);
  });

  it("forgets a subject's failures on success", () => {
    const throttle = createThrottle(db, clock);
    throttle.fail("password", "a@b.org");
    throttle.fail("password", "a@b.org");
    throttle.clear("password", "a@b.org");

    for (let i = 1; i < policies.password.attempts; i++) throttle.fail("password", "a@b.org");
    expect(throttle.blocked("password", "a@b.org")).toBe(false);
  });

  it("counts each subject separately", () => {
    const throttle = createThrottle(db, clock);
    for (let i = 0; i < policies.password.attempts; i++) throttle.fail("password", "a@b.org");

    expect(throttle.blocked("password", "a@b.org")).toBe(true);
    expect(throttle.blocked("password", "someone-else@b.org")).toBe(false);
  });

  it("sweeps rows nothing is counting any more", () => {
    const throttle = createThrottle(db, clock);
    throttle.fail("password", "a@b.org");

    expect(throttle.sweep()).toBe(0);
    now += 25 * 60 * 60 * 1000;
    expect(throttle.sweep()).toBe(1);
  });
});

describe("signing in, through the service", () => {
  const setUp = () => {
    const organization = createOrganizationRepository(db);
    const accounts = createAccountRepository(db);
    const throttle = createThrottle(db, clock);
    const auth = createAuthService(accounts, organization, throttle);

    const person = organization.insertPerson({ name: "Delphine Arceneaux" } as never);
    const account = accounts.create({
      personId: person.id,
      email: "delphine@example.org",
      status: "active",
    });
    auth.setPassword(account.id, "a long enough passphrase");
    return { auth, accounts, throttle };
  };

  const guessTimes = (auth: ReturnType<typeof createAuthService>, email: string, n: number) => {
    const messages: string[] = [];
    for (let i = 0; i < n; i++) {
      try {
        auth.signInWithPassword({ email, password: "not the passphrase" });
      } catch (error) {
        messages.push((error as { body?: () => { message: string } }).body?.().message ?? "");
      }
    }
    return messages;
  };

  it("stops accepting guesses after the limit", () => {
    const { auth } = setUp();
    const messages = guessTimes(auth, "delphine@example.org", policies.password.attempts + 1);

    expect(messages[0]).toBe("Those details were not recognised.");
    expect(messages.at(-1)).toMatch(/Too many attempts/);
  });

  /* The property that makes the distinct wording safe. */
  it("throttles an address nobody has, exactly like one somebody has", () => {
    const { auth } = setUp();

    const real = guessTimes(auth, "delphine@example.org", policies.password.attempts + 1);
    const invented = guessTimes(auth, "nobody-here@example.org", policies.password.attempts + 1);

    expect(invented).toEqual(real);
    expect(invented.at(-1)).toMatch(/Too many attempts/);
  });

  it("refuses the right password too, once blocked", () => {
    const { auth } = setUp();
    guessTimes(auth, "delphine@example.org", policies.password.attempts);

    expect(() =>
      auth.signInWithPassword({
        email: "delphine@example.org",
        password: "a long enough passphrase",
      }),
    ).toThrow(/Too many attempts/);
  });

  it("does not block somebody who gets it right in time", () => {
    const { auth } = setUp();
    guessTimes(auth, "delphine@example.org", policies.password.attempts - 1);

    expect(() =>
      auth.signInWithPassword({
        email: "delphine@example.org",
        password: "a long enough passphrase",
      }),
    ).not.toThrow();

    /* And the near misses are forgotten. */
    guessTimes(auth, "delphine@example.org", policies.password.attempts - 1);
    expect(() =>
      auth.signInWithPassword({
        email: "delphine@example.org",
        password: "a long enough passphrase",
      }),
    ).not.toThrow();
  });

  it("limits magic-link requests, which cost somebody an inbox", () => {
    const { auth } = setUp();
    for (let i = 0; i < policies["magic-link"].attempts; i++) {
      auth.requestMagicLink("delphine@example.org");
    }
    expect(() => auth.requestMagicLink("delphine@example.org")).toThrow(/Too many attempts/);
  });

  it("limits password-reset requests separately from sign-in", () => {
    const { auth } = setUp();
    guessTimes(auth, "delphine@example.org", policies.password.attempts);

    /* Sign-in is blocked; asking for a reset is a different budget. */
    expect(() => auth.requestPasswordReset("delphine@example.org")).not.toThrow();
  });

  it("records a throttled attempt for whoever investigates later", () => {
    const { auth, accounts } = setUp();
    guessTimes(auth, "delphine@example.org", policies.password.attempts + 1);

    expect(accounts.events(20).some((e) => e.action === "auth.throttled")).toBe(true);
  });
});
