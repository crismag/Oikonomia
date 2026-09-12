import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "../services/auth-service";
import { getCurrentUser, SESSION_COOKIE } from "./current-user";
import { principalFor } from "./principal";
import type { Database as Db } from "better-sqlite3";

/**
 * Who the server thinks is asking.
 *
 * This used to read a person id straight out of a cookie, which meant every
 * authorization rule in Oikonomia — all of them real, all enforced
 * server-side — was evaluated against a string the browser could set to
 * anybody's id.
 *
 * Every test here is about the replacement holding: identity comes from a
 * session the server issued, and from nothing the client can write.
 */

let dir: string;
let db: Db;
let accounts: ReturnType<typeof createAccountRepository>;
let auth: ReturnType<typeof createAuthService>;
let organization: ReturnType<typeof createOrganizationRepository>;

let personId: string;
let accountId: string;

const request = (cookie?: string) =>
  new Request("https://oikonomia.test/", {
    headers: cookie ? { cookie } : {},
  });

const signedInRequest = (token: string) => request(`${SESSION_COOKIE}=${token}`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-principal-"));
  db = openDatabase(join(dir, "test.db"));

  organization = createOrganizationRepository(db);
  accounts = createAccountRepository(db);
  auth = createAuthService(accounts, organization);

  const person = organization.insertPerson({ name: "Delphine Arceneaux", accessRole: "leader" });
  personId = person.id;

  const account = accounts.create({ personId, email: "delphine@example.org", status: "active" });
  accountId = account.id;
  auth.setPassword(accountId, "a reasonable passphrase");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const signIn = () =>
  auth.signInWithPassword({
    email: "delphine@example.org",
    password: "a reasonable passphrase",
  }).token;

describe("resolving who is asking", () => {
  it("is nobody when no cookie is sent", () => {
    expect(getCurrentUser(request(), db)).toBeUndefined();
  });

  it("resolves the person behind a real session", () => {
    const viewer = getCurrentUser(signedInRequest(signIn()), db);

    expect(viewer?.person.id).toBe(personId);
    expect(viewer?.persona.id).toBe("leader");
  });

  it("finds the cookie among others", () => {
    const token = signIn();
    const viewer = getCurrentUser(
      request(`theme=dark; ${SESSION_COOKIE}=${token}; other=value`),
      db,
    );

    expect(viewer?.person.id).toBe(personId);
  });

  it("does not confuse a cookie whose name merely ends the same way", () => {
    const token = signIn();
    expect(getCurrentUser(request(`not_${SESSION_COOKIE}=${token}`), db)).toBeUndefined();
  });

  /**
   * The whole point. A person id is not a credential any more.
   */
  it("is nobody for a session token somebody invented", () => {
    for (const invented of [personId, accountId, "anything", "a".repeat(43)]) {
      expect(getCurrentUser(signedInRequest(invented), db), invented).toBeUndefined();
    }
  });

  it("is nobody once the session is signed out", () => {
    const token = signIn();
    expect(getCurrentUser(signedInRequest(token), db)).toBeDefined();

    auth.signOut(token, accountId);
    expect(getCurrentUser(signedInRequest(token), db)).toBeUndefined();
  });

  it("is nobody once the session has expired", () => {
    const token = signIn();
    db.prepare("UPDATE auth_session SET expires_at = '2000-01-01T00:00:00.000Z'").run();

    expect(getCurrentUser(signedInRequest(token), db)).toBeUndefined();
  });

  /* Suspending somebody has to take effect now, not when their session
     happens to lapse. */
  it("is nobody the moment the account is suspended", () => {
    const token = signIn();
    auth.setAccountStatus(accountId, "suspended");

    expect(getCurrentUser(signedInRequest(token), db)).toBeUndefined();
  });

  it("is nobody when the person has been deactivated", () => {
    const token = signIn();
    organization.updatePerson(personId, { active: false });

    expect(getCurrentUser(signedInRequest(token), db)).toBeUndefined();
  });

  it("is nobody when the person no longer exists", () => {
    const token = signIn();
    db.prepare("DELETE FROM person WHERE id = ?").run(personId);

    expect(getCurrentUser(signedInRequest(token), db)).toBeUndefined();
  });
});

describe("what a principal carries", () => {
  it("names the account and the person, and nothing about privileges", () => {
    const token = signIn();
    const principal = principalFor(signedInRequest(token), db);

    expect(principal?.accountId).toBe(accountId);
    expect(principal?.personId).toBe(personId);
    /* No roles, no capabilities, no memberships. Those are resolved from the
       organisation when they are needed, not carried in a session.

       `sessionId` is an identifier, not a privilege: it is the stored id of
       this session — the token's hash — so the account page can say which
       device is the one being used and keep it when ending the others. */
    expect(Object.keys(principal ?? {}).sort()).toEqual([
      "accountId",
      "personId",
      "sessionId",
      "sessionStartedAt",
    ]);

    /* And it is not the token. Somebody reading it cannot sign in with it. */
    expect(principal?.sessionId).not.toBe(token);
  });

  /**
   * A role changed a minute ago takes effect on the next request.
   *
   * Capabilities come from the person's record read now, never from the
   * session — so a session issued before a change carries no stale privilege,
   * in either direction.
   */
  it("reflects a role change without a new session", () => {
    const token = signIn();
    expect(getCurrentUser(signedInRequest(token), db)?.persona.capabilities).toEqual([]);

    organization.updatePerson(personId, { accessRole: "admin" });

    expect(getCurrentUser(signedInRequest(token), db)?.persona.capabilities).toEqual([
      "administration",
    ]);
  });
});

/**
 * Ending every session but the one asking.
 *
 * The account page carried a permanently disabled "Sign out of all other
 * devices" while `revokeAllSessions` — which ends *every* session including
 * the current one — already existed. Keeping one alive is a different
 * operation, and getting it wrong in either direction is bad: ending the
 * current session signs somebody out of the button they just pressed, and
 * failing to end the others is a control that does nothing.
 */
describe("signing out every other device", () => {
  it("ends the others and keeps the one asking", () => {
    const mine = signIn();
    const phone = signIn();
    const laptop = signIn();

    const principal = principalFor(signedInRequest(mine), db)!;
    const ended = accounts.revokeSessionsExcept(accountId, principal.sessionId);

    expect(ended).toBe(2);
    expect(getCurrentUser(signedInRequest(mine), db)).toBeDefined();
    expect(getCurrentUser(signedInRequest(phone), db)).toBeUndefined();
    expect(getCurrentUser(signedInRequest(laptop), db)).toBeUndefined();
  });

  it("reports nothing ended when this is the only session", () => {
    const only = signIn();
    const principal = principalFor(signedInRequest(only), db)!;

    expect(accounts.revokeSessionsExcept(accountId, principal.sessionId)).toBe(0);
    expect(getCurrentUser(signedInRequest(only), db)).toBeDefined();
  });

  /* Revoked once stays revoked, and is not counted a second time. */
  it("does not re-end a session that is already revoked", () => {
    const mine = signIn();
    const other = signIn();
    const principal = principalFor(signedInRequest(mine), db)!;

    expect(accounts.revokeSessionsExcept(accountId, principal.sessionId)).toBe(1);
    expect(accounts.revokeSessionsExcept(accountId, principal.sessionId)).toBe(0);
    expect(getCurrentUser(signedInRequest(other), db)).toBeUndefined();
  });

  /* Sessions are listed per account, so another account's are untouched. */
  it("leaves another account's sessions alone", () => {
    const other = organization.insertPerson({ name: "Tobias Wren" } as never);
    const otherAccount = accounts.create({
      personId: other.id,
      email: "tobias@example.org",
      status: "active",
    });
    auth.setPassword(otherAccount.id, "a long enough passphrase");
    const theirs = auth.signInWithPassword({
      email: "tobias@example.org",
      password: "a long enough passphrase",
    }).token;

    const mine = signIn();
    const principal = principalFor(signedInRequest(mine), db)!;
    accounts.revokeSessionsExcept(accountId, principal.sessionId);

    expect(getCurrentUser(signedInRequest(theirs), db)).toBeDefined();
  });
});

/**
 * Ending one device.
 *
 * The account page could end every other session and not a single named one,
 * so somebody who recognised one unfamiliar device had to sign out everywhere
 * to be rid of it.
 */
describe("signing out one device", () => {
  it("ends the one named and leaves the rest", () => {
    const mine = signIn();
    const phone = signIn();
    const laptop = signIn();

    const phoneId = principalFor(signedInRequest(phone), db)!.sessionId;
    expect(accounts.revokeSessionById(accountId, phoneId)).toBe(true);

    expect(getCurrentUser(signedInRequest(phone), db)).toBeUndefined();
    expect(getCurrentUser(signedInRequest(mine), db)).toBeDefined();
    expect(getCurrentUser(signedInRequest(laptop), db)).toBeDefined();
  });

  it("says so when there was nothing to end", () => {
    const only = signIn();
    const id = principalFor(signedInRequest(only), db)!.sessionId;

    expect(accounts.revokeSessionById(accountId, id)).toBe(true);
    expect(accounts.revokeSessionById(accountId, id)).toBe(false);
  });

  /* Knowing another account's session id is not a way to end it. */
  it("refuses a session that belongs to another account", () => {
    const other = organization.insertPerson({ name: "Tobias Wren" } as never);
    const otherAccount = accounts.create({
      personId: other.id,
      email: "tobias@example.org",
      status: "active",
    });
    auth.setPassword(otherAccount.id, "a long enough passphrase");
    const theirs = auth.signInWithPassword({
      email: "tobias@example.org",
      password: "a long enough passphrase",
    }).token;
    const theirSessionId = principalFor(signedInRequest(theirs), db)!.sessionId;

    expect(accounts.revokeSessionById(accountId, theirSessionId)).toBe(false);
    expect(getCurrentUser(signedInRequest(theirs), db)).toBeDefined();
  });
});

/**
 * Keeping the audit trail from becoming the largest thing in the database.
 */
describe("pruning the audit trail", () => {
  it("removes what is older than the cutoff and keeps the rest", () => {
    signIn();
    expect(accounts.events(50).length).toBeGreaterThan(0);

    /* A cutoff before anything happened removes nothing. */
    expect(accounts.pruneEvents("2000-01-01T00:00:00.000Z")).toBe(0);

    const before = accounts.events(500).length;
    const removed = accounts.pruneEvents(new Date(Date.now() + 60_000).toISOString());
    expect(removed).toBe(before);
    expect(accounts.events(50)).toEqual([]);
  });
});
