/**
 * Encrypting a backup at rest, when the installation has a key for it.
 *
 * ## Off unless somebody chose it
 *
 * `OIKONOMIA_BACKUP_KEY` unset means a backup is the SQLite file itself,
 * exactly as before. Encryption that turns itself on would be a backup nobody
 * can restore the day the key turns out to have been lost — so it is a
 * decision an operator makes, with the custody that comes with it
 * (`docs/architecture/data.md`).
 *
 * ## The file
 *
 * ```
 * offset  0  "OIKOBAK"            7 bytes, so a file says what it is
 * offset  7  version               1 byte  (1)
 * offset  8  IV                   12 bytes
 * offset 20  GCM auth tag         16 bytes, written once the body is done
 * offset 36  AES-256-GCM ciphertext of the database file
 * ```
 *
 * The first 20 bytes are authenticated as associated data, so a header that
 * has been altered is refused along with a body that has. The body is
 * streamed in chunks: a church database is small, and a backup is the one
 * thing that must not fail because a machine was short of memory that night.
 *
 * ## Why the helpers take their modules as an argument
 *
 * The backup copy runs in a child process whose program is these functions'
 * own source text (`backup-copy.ts`). A function serialised that way cannot
 * see this module's imports or constants, so each one is self-contained and
 * is handed `fs` and `crypto` by whoever calls it — the child, or the server
 * verifying a backup.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

export interface CryptoDeps {
  fs: typeof import("node:fs");
  crypto: typeof import("node:crypto");
}

export const nodeDeps: CryptoDeps = { fs, crypto };

/** The extension an encrypted backup carries, so nobody mistakes it for SQLite. */
export const ENCRYPTED_EXTENSION = ".db.enc";

export type BackupKeyState =
  { state: "off" } | { state: "on"; key: Buffer } | { state: "invalid"; problem: string };

/**
 * Read the key from its variable.
 *
 * A key that is set but unusable is **not** treated as unset. Quietly writing
 * plain backups because a character was lost in a paste would leave an
 * operator believing their copies are encrypted when they are not.
 */
export function parseBackupKey(raw: string | undefined): BackupKeyState {
  const value = raw?.trim();
  if (!value) return { state: "off" };

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return { state: "on", key: Buffer.from(value, "hex") };
  }
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length === 32) return { state: "on", key };
  }

  return {
    state: "invalid",
    problem:
      "OIKONOMIA_BACKUP_KEY is set but is not a 32-byte key (64 hex characters, or 44 characters of base64).",
  };
}

export const backupKey = (): BackupKeyState => parseBackupKey(process.env["OIKONOMIA_BACKUP_KEY"]);

/** Encrypt `from` into `to`. `to` is overwritten. */
export function encryptBackupFile(deps: CryptoDeps, from: string, to: string, key: Buffer): void {
  const { fs: files, crypto: cipherLib } = deps;
  const writeAll = (fd: number, data: Buffer, position?: number) => {
    let offset = 0;
    while (offset < data.length) {
      offset += files.writeSync(
        fd,
        data,
        offset,
        data.length - offset,
        position === undefined ? null : position + offset,
      );
    }
  };

  const iv = cipherLib.randomBytes(12);
  const head = Buffer.concat([Buffer.from("OIKOBAK", "ascii"), Buffer.from([1]), iv]);
  const cipher = cipherLib.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(head);

  const input = files.openSync(from, "r");
  try {
    const output = files.openSync(to, "w");
    try {
      writeAll(output, head);
      /* The tag's place, filled in once the whole body has been through. */
      writeAll(output, Buffer.alloc(16));
      const chunk = Buffer.alloc(1024 * 1024);
      let read: number;
      while ((read = files.readSync(input, chunk, 0, chunk.length, null)) > 0) {
        const out = cipher.update(chunk.subarray(0, read));
        if (out.length > 0) writeAll(output, out);
      }
      const last = cipher.final();
      if (last.length > 0) writeAll(output, last);
      writeAll(output, cipher.getAuthTag(), 20);
      files.fsyncSync(output);
    } finally {
      files.closeSync(output);
    }
  } finally {
    files.closeSync(input);
  }
}

/** Whether a stored file is in the encrypted format, by its first bytes. */
export function isEncryptedBackup(deps: CryptoDeps, path: string): boolean {
  const { fs: files } = deps;
  const fd = files.openSync(path, "r");
  try {
    const magic = Buffer.alloc(7);
    const read = files.readSync(fd, magic, 0, 7, 0);
    return read === 7 && magic.toString("ascii") === "OIKOBAK";
  } finally {
    files.closeSync(fd);
  }
}

/**
 * Decrypt `from` into `to`, or throw an error whose message can be shown as
 * the reason.
 *
 * A wrong key and a damaged file are indistinguishable to GCM, and the
 * message says both rather than guessing. What was written to `to` before the
 * tag was checked is removed: plaintext that failed authentication is not a
 * database anybody should open.
 */
export function decryptBackupFile(deps: CryptoDeps, from: string, to: string, key: Buffer): void {
  const { fs: files, crypto: cipherLib } = deps;
  const input = files.openSync(from, "r");
  try {
    const header = Buffer.alloc(36);
    const got = files.readSync(input, header, 0, 36, 0);
    if (got < 36 || header.subarray(0, 7).toString("ascii") !== "OIKOBAK") {
      throw new Error("That file is not an encrypted Oikonomia backup.");
    }
    if (header[7] !== 1) {
      throw new Error("That backup was encrypted by a newer version of Oikonomia.");
    }

    const decipher = cipherLib.createDecipheriv("aes-256-gcm", key, header.subarray(8, 20));
    decipher.setAAD(header.subarray(0, 20));
    decipher.setAuthTag(header.subarray(20, 36));

    const output = files.openSync(to, "w");
    let finished = false;
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      let position = 36;
      let read: number;
      while ((read = files.readSync(input, chunk, 0, chunk.length, position)) > 0) {
        position += read;
        const out = decipher.update(chunk.subarray(0, read));
        if (out.length > 0) files.writeSync(output, out);
      }
      try {
        const last = decipher.final();
        if (last.length > 0) files.writeSync(output, last);
      } catch {
        throw new Error(
          "The backup key on this server does not open that backup. It was taken with a different key, or the file is damaged.",
        );
      }
      finished = true;
    } finally {
      files.closeSync(output);
      if (!finished) files.rmSync(to, { force: true });
    }
  } finally {
    files.closeSync(input);
  }
}

/** SHA-256 of a file, read in chunks. */
export function sha256File(deps: CryptoDeps, path: string): string {
  const { fs: files, crypto: hashLib } = deps;
  const hash = hashLib.createHash("sha256");
  const fd = files.openSync(path, "r");
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let read: number;
    while ((read = files.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    files.closeSync(fd);
  }
  return hash.digest("hex");
}
