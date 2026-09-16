import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptBackupFile,
  encryptBackupFile,
  isEncryptedBackup,
  nodeDeps,
  parseBackupKey,
} from "./backup-crypto";

/**
 * Encrypted backups.
 *
 * The promise: a key that opens the file gets the database back byte for
 * byte; anything else gets a plain refusal and no half-decrypted file.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-backup-crypto-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reading the key", () => {
  it("is off when nothing is set", () => {
    expect(parseBackupKey(undefined).state).toBe("off");
    expect(parseBackupKey("   ").state).toBe("off");
  });

  it("accepts 32 bytes as hex or base64", () => {
    const key = randomBytes(32);
    const hex = parseBackupKey(key.toString("hex"));
    const base64 = parseBackupKey(key.toString("base64"));
    const url = parseBackupKey(key.toString("base64url"));

    for (const parsed of [hex, base64, url]) {
      expect(parsed.state).toBe("on");
      expect(parsed.state === "on" && parsed.key.equals(key)).toBe(true);
    }
  });

  /* Set but unusable is not the same as unset: quietly writing plain backups
     would leave an operator believing theirs are encrypted. */
  it("calls a key of the wrong size invalid rather than off", () => {
    expect(parseBackupKey(randomBytes(16).toString("hex")).state).toBe("invalid");
    expect(parseBackupKey("correct horse battery staple").state).toBe("invalid");
  });
});

describe("the encrypted file", () => {
  const plain = () => {
    /* Bigger than one chunk, so the streaming path is the one exercised. */
    const content = Buffer.concat([Buffer.from("SQLite format 3\0"), randomBytes(2_500_000)]);
    const path = join(dir, "plain.db");
    writeFileSync(path, content);
    return { path, content };
  };

  it("round-trips byte for byte", () => {
    const { path, content } = plain();
    const key = randomBytes(32);

    encryptBackupFile(nodeDeps, path, join(dir, "backup.db.enc"), key);
    const stored = readFileSync(join(dir, "backup.db.enc"));
    expect(stored.includes(Buffer.from("SQLite format 3"))).toBe(false);
    expect(isEncryptedBackup(nodeDeps, join(dir, "backup.db.enc"))).toBe(true);
    expect(isEncryptedBackup(nodeDeps, path)).toBe(false);

    decryptBackupFile(nodeDeps, join(dir, "backup.db.enc"), join(dir, "out.db"), key);
    expect(readFileSync(join(dir, "out.db")).equals(content)).toBe(true);
  });

  it("refuses the wrong key plainly and leaves nothing behind", () => {
    const { path } = plain();
    encryptBackupFile(nodeDeps, path, join(dir, "backup.db.enc"), randomBytes(32));

    expect(() =>
      decryptBackupFile(nodeDeps, join(dir, "backup.db.enc"), join(dir, "out.db"), randomBytes(32)),
    ).toThrow(/does not open that backup/);
    expect(existsSync(join(dir, "out.db"))).toBe(false);
  });

  it("refuses a file whose header has been altered", () => {
    const { path } = plain();
    const key = randomBytes(32);
    encryptBackupFile(nodeDeps, path, join(dir, "backup.db.enc"), key);

    const stored = readFileSync(join(dir, "backup.db.enc"));
    stored[10] = stored[10]! ^ 0xff;
    writeFileSync(join(dir, "backup.db.enc"), stored);

    expect(() =>
      decryptBackupFile(nodeDeps, join(dir, "backup.db.enc"), join(dir, "out.db"), key),
    ).toThrow(/does not open that backup/);
  });

  /* The operator's recovery script repeats the format so a restore needs only
     Node. This is what keeps the two from drifting apart. */
  it("is opened by the operator's decrypt script, with the same key rules", async () => {
    // @ts-expect-error — a plain .mjs operator script, without type declarations
    const script = (await import("../../../scripts/ops/decrypt-backup.mjs")) as {
      parseKey: (raw: string) => Buffer | undefined;
      decryptBackup: (from: string, to: string, key: Buffer) => void;
    };
    const { path, content } = plain();
    const key = randomBytes(32);
    encryptBackupFile(nodeDeps, path, join(dir, "backup.db.enc"), key);

    const parsed = script.parseKey(key.toString("base64"))!;
    script.decryptBackup(join(dir, "backup.db.enc"), join(dir, "restored.db"), parsed);
    expect(readFileSync(join(dir, "restored.db")).equals(content)).toBe(true);

    expect(() =>
      script.decryptBackup(join(dir, "backup.db.enc"), join(dir, "other.db"), randomBytes(32)),
    ).toThrow(/does not open this backup/);
    expect(existsSync(join(dir, "other.db"))).toBe(false);
  });

  it("says when a file is not an encrypted backup at all", () => {
    const { path } = plain();
    expect(() => decryptBackupFile(nodeDeps, path, join(dir, "out.db"), randomBytes(32))).toThrow(
      /not an encrypted Oikonomia backup/,
    );
  });
});
