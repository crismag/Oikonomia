/**
 * Decrypt an encrypted Oikonomia backup (`*.db.enc`) for a restore.
 *
 *   OIKONOMIA_BACKUP_KEY=... node scripts/ops/decrypt-backup.mjs <backup.db.enc> <restored.db>
 *
 * The key is read from the environment — or from `OIKONOMIA_ENV_FILE`'s
 * variables, once loaded into the shell — and never from the command line,
 * where it would land in shell history and in every process listing.
 *
 * It writes a new file readable by this account alone, refuses to overwrite
 * one, and removes what it wrote if the key does not open the backup. It does
 * not put the database in place: that is step 4 of the restore procedure in
 * docs/architecture/deployment.md, after the checksum has been compared.
 *
 * The format is the one `src/server/data/backup-crypto.ts` writes; this file
 * repeats it so an operator needs nothing but Node to recover, and
 * `src/server/data/backup-crypto.test.ts` holds the two to each other.
 */

import { createDecipheriv } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 32 bytes, as 64 hex characters or base64 — the same rule the server applies. */
export function parseKey(raw) {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length === 32) return key;
  }
  return undefined;
}

export function decryptBackup(from, to, key) {
  if (existsSync(to)) throw new Error(`${to} already exists. Refusing to overwrite it.`);

  const input = openSync(from, "r");
  try {
    const header = Buffer.alloc(36);
    if (readSync(input, header, 0, 36, 0) < 36 || header.toString("ascii", 0, 7) !== "OIKOBAK") {
      throw new Error(`${from} is not an encrypted Oikonomia backup.`);
    }
    if (header[7] !== 1) throw new Error(`${from} was encrypted by a newer version of Oikonomia.`);

    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8, 20));
    decipher.setAAD(header.subarray(0, 20));
    decipher.setAuthTag(header.subarray(20, 36));

    const output = openSync(to, "wx", 0o600);
    let finished = false;
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      let position = 36;
      let read;
      while ((read = readSync(input, chunk, 0, chunk.length, position)) > 0) {
        position += read;
        writeSync(output, decipher.update(chunk.subarray(0, read)));
      }
      try {
        writeSync(output, decipher.final());
      } catch {
        throw new Error(
          "That key does not open this backup. It was taken with a different key, or the file is damaged.",
        );
      }
      finished = true;
    } finally {
      closeSync(output);
      if (!finished) rmSync(to, { force: true });
    }
  } finally {
    closeSync(input);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [from, to] = process.argv.slice(2);
  const fail = (message) => {
    console.error(`decrypt-backup: ${message}`);
    process.exit(1);
  };

  if (!from || !to)
    fail("usage: OIKONOMIA_BACKUP_KEY=... decrypt-backup.mjs <backup.db.enc> <restored.db>");
  const key = parseKey(process.env["OIKONOMIA_BACKUP_KEY"]);
  if (!key)
    fail("OIKONOMIA_BACKUP_KEY is not set to a 32-byte key (64 hex characters, or base64).");

  try {
    decryptBackup(resolve(from), resolve(to), key);
    console.log(`decrypted to ${resolve(to)}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
