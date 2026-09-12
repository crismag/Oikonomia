import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "./auth-service";
import { verifyPassword } from "../auth/secrets";
import type { Database as Db } from "better-sqlite3";

/**
 * Proving who somebody is.
 *
 * Most of these assert a **refusal**, because that is where authentication is
 * usually wrong: a link that works twice, a suspended account that still gets
 * in, a Google identity matched on an email somebody else now owns.
 */

let dir: string;
let db: Db;
let accounts: ReturnType<typeof createAccountRepository>;
let organization: ReturnType<typeof createOrganizationRepository>;
let auth: ReturnType<typeof createAuthService>;

let personId: string;
let accountId: string;

const PASSWORD = "a reasonable passphrase";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-auth-"));
  db = openDatabase(join(dir, "test.db"));

  organization = createOrganizationRepository(db);
  accounts = createAccountRepository(db);
  auth = createAuthService(accounts, organization);

  personId = organization.insertPerson({ name: "Delphine Arceneaux" }).id;
  accountId = accounts.create({
    personId,
    email: "delphine@example.org",
    status: "active",
  }).id;
  auth.setPassword(accountId, PASSWORD);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("signing in with a password", () => {
  it("works with the right one", () => {
    const result = auth.signInWithPassword({ email: "delphine@example.org", password: PASSWORD });

    expect(result.token).toBeTruthy();
    expect(result.account.id).toBe(accountId);
    expect(accounts.find(accountId)?.lastLoginAt).toBeTruthy();
  });

  it("is not case-sensitive about the address", () => {
    expect(() =>
      auth.signInWithPassword({ email: "DELPHINE@Example.ORG", password: PASSWORD }),
    ).not.toThrow();
  });

  it("refuses the wrong one", () => {
    expect(() =>
      auth.signInWithPassword({ email: "delphine@example.org", password: "something else" }),
    ).toThrow(ApiError);
  });

  /* The difference between "no such account" and "wrong password" is exactly
     what somebody enumerating addresses is looking for. */
  it("says the same thing whether or not the account exists", () => {
    const wrongPassword = attempt(() =>
      auth.signInWithPassword({ email: "delphine@example.org", password: "wrong" }),
    );
    const noAccount = attempt(() =>
      auth.signInWithPassword({ email: "nobody@example.org", password: "wrong" }),
    );

    expect(wrongPassword).toBe(noAccount);
  });

  it("refuses a suspended account, whatever the password", () => {
    auth.setAccountStatus(accountId, "suspended");
    expect(() =>
      auth.signInWithPassword({ email: "delphine@example.org", password: PASSWORD }),
    ).toThrow(ApiError);
  });

  it("refuses an account whose person has been deactivated", () => {
    organization.updatePerson(personId, { active: false });
    expect(() =>
      auth.signInWithPassword({ email: "delphine@example.org", password: PASSWORD }),
    ).toThrow(ApiError);
  });

  it("refuses an account that was invited and never set up", () => {
    const other = organization.insertPerson({ name: "Ignatius Bekele" });
    accounts.create({ personId: other.id, email: "ignatius@example.org", status: "invited" });

    expect(() =>
      auth.signInWithPassword({ email: "ignatius@example.org", password: PASSWORD }),
    ).toThrow(ApiError);
  });
});

describe("how a password is stored", () => {
  it("is not the password", () => {
    const credential = accounts.credential(accountId, "password")!;

    expect(credential.secret).not.toContain(PASSWORD);
    expect(JSON.stringify(credential)).not.toContain(PASSWORD);
    expect(credential.secret).toMatch(/^[0-9a-f]{128}$/);
    expect(credential.salt).toBeTruthy();
  });

  it("records the algorithm and cost, so the cost can be raised later", () => {
    const credential = accounts.credential(accountId, "password")!;

    expect(credential.algorithm).toBe("scrypt");
    expect(JSON.parse(credential.parameters ?? "{}")).toMatchObject({ N: expect.any(Number) });
  });

  it("uses a different salt for the same password twice", () => {
    const other = organization.insertPerson({ name: "Ignatius Bekele" });
    const second = accounts.create({ personId: other.id, email: "i@example.org" }).id;
    auth.setPassword(second, PASSWORD);

    const a = accounts.credential(accountId, "password")!;
    const b = accounts.credential(second, "password")!;

    expect(a.salt).not.toBe(b.salt);
    expect(a.secret).not.toBe(b.secret);
  });

  it("refuses one too short to be worth hashing", () => {
    expect(() => auth.setPassword(accountId, "short")).toThrow(ApiError);
  });

  /* If the reason for changing a password is that somebody else knew it,
     leaving their session alive defeats the change. */
  it("signs every other session out when it changes", () => {
    const token = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;
    expect(accounts.session(token)?.revokedAt).toBeUndefined();

    auth.setPassword(accountId, "an entirely different passphrase");

    expect(accounts.session(token)?.revokedAt).toBeTruthy();
  });

  it("refuses an unrecognised algorithm rather than guessing", () => {
    expect(verifyPassword(PASSWORD, { secret: "aa", salt: "bb", algorithm: "rot13" })).toBe(false);
  });
});

describe("magic links", () => {
  it("issues one for an address that belongs to somebody", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    expect(token).toBeTruthy();
  });

  /* Always succeeds. What comes back differs; what the caller can observe
     does not. */
  it("issues nothing for an address that does not, without saying so", () => {
    expect(() => auth.requestMagicLink("nobody@example.org")).not.toThrow();
    expect(auth.requestMagicLink("nobody@example.org").token).toBeUndefined();
  });

  it("signs somebody in", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    const result = auth.signInWithMagicLink({ token: token! });

    expect(result.account.id).toBe(accountId);
  });

  it("proves the address by being followed", () => {
    expect(accounts.find(accountId)?.emailVerified).toBe(false);

    const { token } = auth.requestMagicLink("delphine@example.org");
    auth.signInWithMagicLink({ token: token! });

    expect(accounts.find(accountId)?.emailVerified).toBe(true);
  });

  it("works exactly once", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    auth.signInWithMagicLink({ token: token! });

    expect(() => auth.signInWithMagicLink({ token: token! })).toThrow(ApiError);
  });

  it("stops working when it expires", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    db.prepare("UPDATE auth_token SET expires_at = '2000-01-01T00:00:00.000Z'").run();

    expect(() => auth.signInWithMagicLink({ token: token! })).toThrow(ApiError);
  });

  it("refuses a token nobody issued", () => {
    for (const invented of ["", "nonsense", "a".repeat(43)]) {
      expect(() => auth.signInWithMagicLink({ token: invented }), invented).toThrow(ApiError);
    }
  });

  /* The token in the database is a hash. Somebody who reads the table cannot
     use what they find to sign in. */
  it("stores the hash and not the link", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    const rows = db.prepare("SELECT id FROM auth_token").all() as { id: string }[];

    expect(rows[0]?.id).not.toBe(token);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signing in with Google", () => {
  const google = { subject: "google-subject-40218", email: "delphine@example.org" };

  it("links a verified Google identity to an existing account", () => {
    const result = auth.signInWithGoogle({ ...google, emailVerified: true });

    expect(result.account.id).toBe(accountId);
    expect(accounts.credential(accountId, "google")?.subject).toBe(google.subject);
  });

  it("recognises the same identity next time without relinking", () => {
    auth.signInWithGoogle({ ...google, emailVerified: true });
    /* The address changes; the subject does not. Google is still the same
       identity, and that is what it is matched on. */
    const again = auth.signInWithGoogle({
      subject: google.subject,
      email: "somebody-else@example.org",
      emailVerified: true,
    });

    expect(again.account.id).toBe(accountId);
  });

  /* An address can change hands. Matching on one is how somebody inherits an
     account that was never theirs. */
  it("refuses an unverified Google email rather than trusting it", () => {
    expect(() => auth.signInWithGoogle({ ...google, emailVerified: false })).toThrow(ApiError);
    expect(accounts.credential(accountId, "google")).toBeUndefined();
  });

  /* Self-registration is not the policy: an account exists because somebody
     entered a person. */
  it("refuses an identity with no account here, rather than creating one", () => {
    expect(() =>
      auth.signInWithGoogle({
        subject: "google-subject-99999",
        email: "stranger@example.org",
        emailVerified: true,
      }),
    ).toThrow(ApiError);

    expect(db.prepare("SELECT COUNT(*) AS n FROM account").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM person").get()).toEqual({ n: 1 });
  });

  it("refuses a suspended account", () => {
    auth.setAccountStatus(accountId, "suspended");
    expect(() => auth.signInWithGoogle({ ...google, emailVerified: true })).toThrow(ApiError);
  });
});

describe("signing out", () => {
  it("ends that session", () => {
    const token = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;
    auth.signOut(token, accountId);

    expect(accounts.session(token)?.revokedAt).toBeTruthy();
  });

  it("leaves other sessions alone", () => {
    const phone = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;
    const laptop = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;

    auth.signOut(phone, accountId);

    expect(accounts.session(phone)?.revokedAt).toBeTruthy();
    expect(accounts.session(laptop)?.revokedAt).toBeUndefined();
  });

  it("can end all of them", () => {
    const phone = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;
    const laptop = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;

    auth.signOutEverywhere(accountId);

    expect(accounts.session(phone)?.revokedAt).toBeTruthy();
    expect(accounts.session(laptop)?.revokedAt).toBeTruthy();
  });
});

describe("giving somebody a way in", () => {
  it("creates an account that cannot yet be signed in to", () => {
    const person = organization.insertPerson({ name: "Ignatius Bekele" });
    const account = auth.inviteAccount(person.id, "ignatius@example.org");

    expect(account.status).toBe("invited");
    expect(accounts.credential(account.id, "password")).toBeUndefined();
  });

  it("refuses an address somebody else already uses", () => {
    const person = organization.insertPerson({ name: "Ignatius Bekele" });
    expect(() => auth.inviteAccount(person.id, "delphine@example.org")).toThrow(ApiError);
  });

  it("refuses a person who does not exist", () => {
    expect(() => auth.inviteAccount("per-invented", "x@example.org")).toThrow(ApiError);
  });
});

describe("what is written down about all this", () => {
  it("records a sign-in and a sign-out", () => {
    const token = auth.signInWithPassword({
      email: "delphine@example.org",
      password: PASSWORD,
    }).token;
    auth.signOut(token, accountId);

    const actions = accounts.events().map((event) => event.action);
    expect(actions).toContain("auth.login.success");
    expect(actions).toContain("auth.logout");
  });

  it("records a refusal without recording the attempt's password", () => {
    attempt(() =>
      auth.signInWithPassword({ email: "delphine@example.org", password: "hunter2-guess" }),
    );

    const trail = JSON.stringify(accounts.events());
    expect(trail).toContain("auth.login.failed");
    expect(trail).not.toContain("hunter2-guess");
  });

  /**
   * An audit trail that records the secret it was watching has become the
   * vulnerability it exists to detect.
   */
  it("never records a password, a hash or a raw token", () => {
    const { token } = auth.requestMagicLink("delphine@example.org");
    auth.signInWithMagicLink({ token: token! });

    const trail = JSON.stringify(accounts.events());
    expect(trail).not.toContain(PASSWORD);
    expect(trail).not.toContain(token);
    expect(trail).not.toContain(accounts.credential(accountId, "password")?.secret);
  });
});

/** The message a refusal carries, for comparing two refusals. */
function attempt(work: () => unknown): string {
  try {
    work();
    return "no refusal";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
