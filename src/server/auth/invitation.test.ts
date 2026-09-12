import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService, LINK_LIFETIME_MS } from "../services/auth-service";
import type { Database as Db } from "better-sqlite3";

/**
 * Giving somebody a way in.
 *
 * Until this worked, **only the first person could ever sign in**: `/setup`
 * created one account, and adding anybody else to the directory created a
 * person and no account. `inviteAccount` existed and nothing called it.
 *
 * And when it was called, the invitation refused itself — the link checked
 * that the account was *active*, which an invited account is not until it has
 * a password, which is what the link is for.
 */

let dir: string;
let db: Db;
let organization: ReturnType<typeof createOrganizationRepository>;
let accounts: ReturnType<typeof createAccountRepository>;
let auth: ReturnType<typeof createAuthService>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-invite-"));
  db = openDatabase(join(dir, "test.db"));
  organization = createOrganizationRepository(db);
  accounts = createAccountRepository(db);
  auth = createAuthService(accounts, organization);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const invite = (name: string, email: string) => {
  const person = organization.insertPerson({ name, email } as never);
  const account = auth.inviteAccount(person.id, email);
  const token = accounts.issueToken({
    accountId: account.id,
    purpose: "password-reset",
    lifetimeMs: LINK_LIFETIME_MS,
  });
  return { person, account, token };
};

describe("inviting somebody", () => {
  it("creates an account they cannot yet sign in with", () => {
    const { account } = invite("Tobias Wren", "tobias@example.org");

    expect(account.status).toBe("invited");
    expect(accounts.credential(account.id, "password")).toBeUndefined();
    expect(() =>
      auth.signInWithPassword({ email: "tobias@example.org", password: "anything at all" }),
    ).toThrow(ApiError);
  });

  /**
   * The bug this file was written for. The link checked the account was
   * active; an invited account is not active until it has a password; the
   * password is what the link sets.
   */
  it("lets them set a first password from the link", () => {
    const { account, token } = invite("Tobias Wren", "tobias@example.org");

    expect(() => auth.resetPassword({ token, password: "a long enough passphrase" })).not.toThrow();

    expect(accounts.find(account.id)?.status).toBe("active");
    expect(() =>
      auth.signInWithPassword({
        email: "tobias@example.org",
        password: "a long enough passphrase",
      }),
    ).not.toThrow();
  });

  it("spends the link, so it cannot be used twice", () => {
    const { token } = invite("Tobias Wren", "tobias@example.org");
    auth.resetPassword({ token, password: "a long enough passphrase" });

    expect(() => auth.resetPassword({ token, password: "another passphrase entirely" })).toThrow(
      ApiError,
    );
  });

  /* Looser about "invited", and no looser about anything else. */
  it("refuses a suspended account's link", () => {
    const { account, token } = invite("Tobias Wren", "tobias@example.org");
    auth.setAccountStatus(account.id, "suspended");

    expect(() => auth.resetPassword({ token, password: "a long enough passphrase" })).toThrow(
      ApiError,
    );
  });

  it("refuses the link of somebody deactivated in the directory", () => {
    const { person, token } = invite("Tobias Wren", "tobias@example.org");
    organization.updatePerson(person.id, { active: false } as never);

    expect(() => auth.resetPassword({ token, password: "a long enough passphrase" })).toThrow(
      ApiError,
    );
  });

  it("grants no membership, no group and no capability", () => {
    const { person, token } = invite("Tobias Wren", "tobias@example.org");
    auth.resetPassword({ token, password: "a long enough passphrase" });

    const after = organization.findPerson(person.id)!;
    expect(after.ministryIds).toEqual([]);
    expect(after.groupIds ?? []).toEqual([]);
  });

  it("refuses an address somebody else already uses", () => {
    invite("Tobias Wren", "shared@example.org");
    const other = organization.insertPerson({ name: "Delphine Arceneaux" } as never);

    expect(() => auth.inviteAccount(other.id, "shared@example.org")).toThrow(ApiError);
  });

  it("re-inviting the same person reuses their account rather than making a second", () => {
    const { person, account } = invite("Tobias Wren", "tobias@example.org");
    const again = auth.inviteAccount(person.id, "tobias@example.org");

    expect(again.id).toBe(account.id);
    expect(accounts.findByPerson(person.id)?.id).toBe(account.id);
  });
});
