import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";
import { hashToken, newToken, type StoredSecret } from "../auth/secrets";

/**
 * Accounts, credentials, sessions and the tokens that create them.
 *
 * One repository because they are written together — signing in reads a
 * credential, creates a session and records an event — and splitting them would
 * put one transaction across three files.
 *
 * Nothing here decides anything. Whether a password is right, whether an
 * account may sign in, what happens on a failure: all of that is the service's,
 * because it is policy rather than storage.
 */

export type AccountStatus = "invited" | "active" | "suspended";

export interface Account {
  id: string;
  personId: string;
  email?: string;
  emailVerified: boolean;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Credential extends Partial<StoredSecret> {
  id: string;
  accountId: string;
  provider: "password" | "google";
  subject?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  accountId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
  userAgent?: string;
}

interface AccountRow {
  id: string;
  person_id: string;
  email: string | null;
  email_verified: number;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export function createAccountRepository(db: Db) {
  const toAccount = (row: AccountRow): Account => ({
    id: row.id,
    personId: row.person_id,
    ...(row.email ? { email: row.email } : {}),
    emailVerified: row.email_verified === 1,
    status: row.status as AccountStatus,
    createdAt: row.created_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
  });

  return {
    /* ---------------------------------------------------------- accounts */

    find(id: string): Account | undefined {
      const row = db.prepare("SELECT * FROM account WHERE id = ?").get(id) as
        AccountRow | undefined;
      return row ? toAccount(row) : undefined;
    },

    findByPerson(personId: string): Account | undefined {
      const row = db.prepare("SELECT * FROM account WHERE person_id = ?").get(personId) as
        AccountRow | undefined;
      return row ? toAccount(row) : undefined;
    },

    /** Case-insensitively: nobody types their address the same way twice. */
    findByEmail(email: string): Account | undefined {
      const row = db
        .prepare("SELECT * FROM account WHERE lower(email) = lower(?)")
        .get(email.trim()) as AccountRow | undefined;
      return row ? toAccount(row) : undefined;
    },

    create(values: {
      personId: string;
      email?: string | undefined;
      emailVerified?: boolean;
      status?: AccountStatus;
    }): Account {
      const id = newId("acc");
      db.prepare(
        `INSERT INTO account (id, person_id, email, email_verified, status, created_at)
         VALUES (@id, @person, @email, @verified, @status, @at)`,
      ).run({
        id,
        person: values.personId,
        email: values.email ?? null,
        verified: values.emailVerified ? 1 : 0,
        status: values.status ?? "invited",
        at: nowIso(),
      });
      return this.find(id)!;
    },

    update(
      id: string,
      values: Partial<{
        email: string | null;
        emailVerified: boolean;
        status: AccountStatus;
        lastLoginAt: string;
      }>,
    ): Account | undefined {
      const current = this.find(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE account SET email = @email, email_verified = @verified,
                            status = @status, last_login_at = @lastLogin
          WHERE id = @id`,
      ).run({
        id,
        email: "email" in values ? values.email : (current.email ?? null),
        verified: (values.emailVerified ?? current.emailVerified) ? 1 : 0,
        status: values.status ?? current.status,
        lastLogin: values.lastLoginAt ?? current.lastLoginAt ?? null,
      });
      return this.find(id);
    },

    /* ------------------------------------------------------- credentials */

    credential(accountId: string, provider: "password" | "google"): Credential | undefined {
      const row = db
        .prepare("SELECT * FROM account_credential WHERE account_id = ? AND provider = ?")
        .get(accountId, provider) as Record<string, string | null> | undefined;
      if (!row) return undefined;

      return {
        id: String(row["id"]),
        accountId: String(row["account_id"]),
        provider: row["provider"] as "password" | "google",
        createdAt: String(row["created_at"]),
        updatedAt: String(row["updated_at"]),
        ...(row["subject"] ? { subject: String(row["subject"]) } : {}),
        ...(row["secret"] ? { secret: String(row["secret"]) } : {}),
        ...(row["salt"] ? { salt: String(row["salt"]) } : {}),
        ...(row["algorithm"] ? { algorithm: String(row["algorithm"]) } : {}),
        ...(row["parameters"] ? { parameters: String(row["parameters"]) } : {}),
      };
    },

    /** Which account a provider's subject belongs to. Never matched on email. */
    findBySubject(provider: "google", subject: string): Account | undefined {
      const row = db
        .prepare(
          `SELECT account.* FROM account
             JOIN account_credential ON account_credential.account_id = account.id
            WHERE account_credential.provider = ? AND account_credential.subject = ?`,
        )
        .get(provider, subject) as AccountRow | undefined;
      return row ? toAccount(row) : undefined;
    },

    setCredential(values: {
      accountId: string;
      provider: "password" | "google";
      subject?: string | undefined;
      stored?: StoredSecret | undefined;
    }): void {
      const at = nowIso();
      db.prepare(
        `INSERT INTO account_credential
           (id, account_id, provider, subject, secret, salt, algorithm, parameters,
            created_at, updated_at)
         VALUES (@id, @account, @provider, @subject, @secret, @salt, @algorithm, @parameters,
                 @at, @at)
         ON CONFLICT (account_id, provider) DO UPDATE SET
           subject = excluded.subject,
           secret = excluded.secret,
           salt = excluded.salt,
           algorithm = excluded.algorithm,
           parameters = excluded.parameters,
           updated_at = excluded.updated_at`,
      ).run({
        id: newId("cred"),
        account: values.accountId,
        provider: values.provider,
        subject: values.subject ?? null,
        secret: values.stored?.secret ?? null,
        salt: values.stored?.salt ?? null,
        algorithm: values.stored?.algorithm ?? null,
        parameters: values.stored?.parameters ?? null,
        at,
      });
    },

    removeCredential(accountId: string, provider: "password" | "google"): void {
      db.prepare("DELETE FROM account_credential WHERE account_id = ? AND provider = ?").run(
        accountId,
        provider,
      );
    },

    /* ---------------------------------------------------------- sessions */

    /**
     * Begin a session, and hand back the only copy of its token.
     *
     * The token goes in the cookie; its hash is what is stored. Losing the
     * token means signing in again, which is the correct consequence.
     */
    openSession(values: {
      accountId: string;
      lifetimeMs: number;
      userAgent?: string | undefined;
    }): { token: string; session: Session } {
      const { token, hash } = newToken();
      const at = nowIso();
      const expires = new Date(Date.now() + values.lifetimeMs).toISOString();

      db.prepare(
        `INSERT INTO auth_session
           (id, account_id, created_at, last_seen_at, expires_at, user_agent)
         VALUES (@id, @account, @at, @at, @expires, @agent)`,
      ).run({
        id: hash,
        account: values.accountId,
        at,
        expires,
        agent: values.userAgent ?? null,
      });

      return { token, session: this.session(token)! };
    },

    /** The session a token names, whatever state it is in. */
    session(token: string): Session | undefined {
      const row = db.prepare("SELECT * FROM auth_session WHERE id = ?").get(hashToken(token)) as
        Record<string, string | null> | undefined;
      if (!row) return undefined;

      return {
        id: String(row["id"]),
        accountId: String(row["account_id"]),
        createdAt: String(row["created_at"]),
        lastSeenAt: String(row["last_seen_at"]),
        expiresAt: String(row["expires_at"]),
        ...(row["revoked_at"] ? { revokedAt: String(row["revoked_at"]) } : {}),
        ...(row["user_agent"] ? { userAgent: String(row["user_agent"]) } : {}),
      };
    },

    touchSession(token: string): void {
      db.prepare("UPDATE auth_session SET last_seen_at = ? WHERE id = ?").run(
        nowIso(),
        hashToken(token),
      );
    },

    revokeSession(token: string): void {
      db.prepare("UPDATE auth_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(
        nowIso(),
        hashToken(token),
      );
    },

    /** Sign out everywhere. What a password change does. */
    revokeAllSessions(accountId: string): void {
      db.prepare(
        "UPDATE auth_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL",
      ).run(nowIso(), accountId);
    },

    /**
     * End one named session.
     *
     * By its stored id — the token's hash — because that is what this layer
     * holds and what the account page can safely be given. Scoped to the
     * account as well, so knowing another account's session id is not a way to
     * end it.
     */
    revokeSessionById(accountId: string, sessionId: string): boolean {
      return (
        db
          .prepare(
            `UPDATE auth_session SET revoked_at = ?
              WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
          )
          .run(nowIso(), sessionId, accountId).changes > 0
      );
    },

    /**
     * Sign out everywhere else, keeping one session alive.
     *
     * The session kept is named by its stored id — the token's hash — because
     * that is what this layer holds. Passing a raw token in would mean the
     * caller had one to pass, and the only caller is a request whose own token
     * is already resolved into a principal.
     */
    revokeSessionsExcept(accountId: string, keepSessionId: string): number {
      const result = db
        .prepare(
          `UPDATE auth_session SET revoked_at = ?
            WHERE account_id = ? AND id <> ? AND revoked_at IS NULL`,
        )
        .run(nowIso(), accountId, keepSessionId);
      return result.changes;
    },

    sessionsFor(accountId: string): Session[] {
      const rows = db
        .prepare("SELECT * FROM auth_session WHERE account_id = ? ORDER BY created_at DESC")
        .all(accountId) as Record<string, string | null>[];

      return rows.map((row) => ({
        id: String(row["id"]),
        accountId: String(row["account_id"]),
        createdAt: String(row["created_at"]),
        lastSeenAt: String(row["last_seen_at"]),
        expiresAt: String(row["expires_at"]),
        ...(row["revoked_at"] ? { revokedAt: String(row["revoked_at"]) } : {}),
        ...(row["user_agent"] ? { userAgent: String(row["user_agent"]) } : {}),
      }));
    },

    /* ------------------------------------------------------------ tokens */

    /** Issue a magic link or a reset. Only the hash is kept. */
    issueToken(values: {
      accountId: string;
      purpose: "magic-link" | "password-reset";
      lifetimeMs: number;
    }): string {
      const { token, hash } = newToken();
      db.prepare(
        `INSERT INTO auth_token (id, account_id, purpose, created_at, expires_at)
         VALUES (@id, @account, @purpose, @at, @expires)`,
      ).run({
        id: hash,
        account: values.accountId,
        purpose: values.purpose,
        at: nowIso(),
        expires: new Date(Date.now() + values.lifetimeMs).toISOString(),
      });
      return token;
    },

    findToken(
      token: string,
      purpose: "magic-link" | "password-reset",
    ): { accountId: string; expiresAt: string; usedAt?: string } | undefined {
      const row = db
        .prepare("SELECT * FROM auth_token WHERE id = ? AND purpose = ?")
        .get(hashToken(token), purpose) as Record<string, string | null> | undefined;
      if (!row) return undefined;

      return {
        accountId: String(row["account_id"]),
        expiresAt: String(row["expires_at"]),
        ...(row["used_at"] ? { usedAt: String(row["used_at"]) } : {}),
      };
    },

    /**
     * Spend a token, and say whether it was this call that spent it.
     *
     * The update is conditional on it being unspent, so two simultaneous
     * requests with the same link cannot both succeed — single use has to be
     * decided by the database, not by a read followed by a write.
     */
    consumeToken(token: string, purpose: "magic-link" | "password-reset"): boolean {
      const result = db
        .prepare(
          "UPDATE auth_token SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL",
        )
        .run(nowIso(), hashToken(token), purpose);
      return result.changes === 1;
    },

    /* ------------------------------------------------------------- audit */

    record(values: {
      accountId?: string | undefined;
      identifier?: string | undefined;
      action: string;
      method?: string | undefined;
      result?: string;
      metadata?: Record<string, unknown>;
    }): void {
      db.prepare(
        `INSERT INTO auth_event (id, at, account_id, identifier, action, method, result, metadata)
         VALUES (@id, @at, @account, @identifier, @action, @method, @result, @metadata)`,
      ).run({
        id: newId("ae"),
        at: nowIso(),
        account: values.accountId ?? null,
        identifier: values.identifier ?? null,
        action: values.action,
        method: values.method ?? null,
        result: values.result ?? "ok",
        metadata: JSON.stringify(values.metadata ?? {}),
      });
    },

    /**
     * Delete audit events older than a cutoff, and say how many.
     *
     * An audit trail that grows without bound eventually becomes the largest
     * thing in the database and is still never read past its first page. A
     * year is long enough to investigate anything anybody investigates, and
     * short enough that it does not accumulate forever.
     *
     * Deliberately not "keep the last N": a busy week would then evict a quiet
     * year, and the question an audit answers is "what happened around then",
     * not "what happened recently".
     */
    pruneEvents(before: string): number {
      return db.prepare("DELETE FROM auth_event WHERE at < ?").run(before).changes;
    },

    events(limit = 50): {
      at: string;
      accountId?: string;
      action: string;
      method?: string;
      result: string;
    }[] {
      const rows = db
        .prepare("SELECT * FROM auth_event ORDER BY at DESC LIMIT ?")
        .all(limit) as Record<string, string | null>[];

      return rows.map((row) => ({
        at: String(row["at"]),
        ...(row["account_id"] ? { accountId: String(row["account_id"]) } : {}),
        action: String(row["action"]),
        ...(row["method"] ? { method: String(row["method"]) } : {}),
        result: String(row["result"]),
      }));
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
