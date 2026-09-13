/**
 * Give somebody a way in, from a terminal.
 *
 * ## Why this exists rather than a screen
 *
 * A fresh installation has people and no credentials — deliberately, because a
 * migration that issued passwords would be the hole the authentication work
 * closed. Somebody has to set the first one, and it cannot be a request,
 * because there is nobody authorized to make it yet.
 *
 * **Explicit development and operations tooling.** It needs a shell on the
 * server and the database file; it is not reachable over HTTP, and there is no
 * endpoint that does this without an authenticated administrator.
 *
 *   npm run auth:set-password -- somebody@example.org "a long passphrase"
 */
import Database from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: npm run auth:set-password -- <email> <password>");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use at least 12 characters. A passphrase is easier and stronger.");
  process.exit(1);
}

const path = process.env.OIKONOMIA_DB ?? join(process.cwd(), ".data", "oikonomia.db");
/* An account can only exist in a database that does; a wrong or missing
   OIKONOMIA_DB must not quietly create an empty one somewhere else. */
if (!existsSync(path)) {
  console.error(`No database at ${path}. Set OIKONOMIA_DB to the installation's database file.`);
  process.exit(1);
}
const db = new Database(path);

const account = db
  .prepare(
    `SELECT account.*, person.name FROM account
       JOIN person ON person.id = account.person_id
      WHERE lower(account.email) = lower(?)`,
  )
  .get(email.trim());

if (!account) {
  console.error(`No account has the address ${email}.`);
  console.error("Set the person's email in Administration first, or add an account for them.");
  process.exit(1);
}

/* The same parameters as the application. Kept in step deliberately: a hash
   written here has to verify there. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const salt = randomBytes(16).toString("hex");
const secret = scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT).toString("hex");
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO account_credential
     (id, account_id, provider, secret, salt, algorithm, parameters, created_at, updated_at)
   VALUES (@id, @account, 'password', @secret, @salt, 'scrypt', @parameters, @at, @at)
   ON CONFLICT (account_id, provider) DO UPDATE SET
     secret = excluded.secret, salt = excluded.salt,
     algorithm = excluded.algorithm, parameters = excluded.parameters,
     updated_at = excluded.updated_at`,
).run({
  id: `cred-${randomBytes(8).toString("hex")}`,
  account: account.id,
  secret,
  salt,
  parameters: JSON.stringify(SCRYPT),
  at: now,
});

db.prepare("UPDATE account SET status = 'active' WHERE id = ?").run(account.id);

/* Any session that existed is ended, exactly as a password change does in the
   application. */
db.prepare(
  "UPDATE auth_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL",
).run(now, account.id);
db.prepare(
  `INSERT INTO auth_event (id, at, account_id, action, method, result, metadata)
   VALUES (?, ?, ?, 'auth.password.changed', 'password', 'ok', '{"by":"cli"}')`,
).run(`ae-${randomBytes(8).toString("hex")}`, now, account.id);

console.log(`Set a password for ${account.name} <${email}>. The account is now active.`);
db.close();
