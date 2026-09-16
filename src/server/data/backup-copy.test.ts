import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/connection";
import { runBackupCopy } from "./backup-copy";
import { isEncryptedBackup, nodeDeps } from "./backup-crypto";
import { sha256 } from "./storage";

/**
 * The copy, in its own process.
 *
 * The failure this guards against: a destination that neither succeeds nor
 * fails used to hold the thread that answers every request. A FIFO nobody
 * reads is that destination, on demand — opening it waits forever, exactly as
 * a hung mount does.
 */

let dir: string;
let database: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-backup-copy-"));
  database = join(dir, "live.db");
  openDatabase(database).close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const request = (over: Partial<Parameters<typeof runBackupCopy>[0]> = {}) => ({
  database,
  scratch: join(dir, "artifacts", "scratch.db"),
  artifactRoot: join(dir, "artifacts"),
  localPath: join(dir, "artifacts", "backup.db"),
  timeoutMs: 20_000,
  ...over,
});

/** Count event-loop turns while `work` runs: a frozen server counts none. */
async function whileCounting<T>(work: Promise<T>): Promise<{ result: T; ticks: number }> {
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 20);
  try {
    return { result: await work, ticks };
  } finally {
    clearInterval(timer);
  }
}

describe("taking the copy", () => {
  it("stores a consistent SQLite copy, and a second one", async () => {
    const result = await runBackupCopy(
      request({ secondary: { root: join(dir, "second"), path: join(dir, "second", "backup.db") } }),
    );

    expect(result.status).toBe("stored");
    const local = readFileSync(join(dir, "artifacts", "backup.db"));
    expect(local.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(result.status === "stored" && result.checksum).toBe(sha256(local));
    expect(readFileSync(join(dir, "second", "backup.db")).equals(local)).toBe(true);
    expect(readdirSync(join(dir, "artifacts"))).toEqual(["backup.db"]);
  });

  it("encrypts what it writes when given a key, and the checksum is of that file", async () => {
    const result = await runBackupCopy(request({ key: randomBytes(32) }));

    expect(result.status).toBe("stored");
    const path = join(dir, "artifacts", "backup.db");
    expect(isEncryptedBackup(nodeDeps, path)).toBe(true);
    expect(result.status === "stored" && result.checksum).toBe(sha256(readFileSync(path)));
  });

  it("reports a failure it can see, with the reason", async () => {
    const result = await runBackupCopy(request({ database: join(dir, "missing.db") }));
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.reason).toBeTruthy();
    expect(existsSync(join(dir, "artifacts", "backup.db"))).toBe(false);
  });
});

describe("a destination that stops answering", () => {
  it("keeps the event loop turning, stops the copy, and leaves nothing that looks finished", async () => {
    /* Opening a FIFO nobody writes to waits forever — the hung mount. */
    const hung = join(dir, "hung.db");
    execFileSync("mkfifo", [hung]);

    const started = Date.now();
    const { result, ticks } = await whileCounting(
      runBackupCopy(request({ database: hung, timeoutMs: 1_500 })),
    );

    expect(result.status).toBe("timed-out");
    expect(result.status === "timed-out" && result.reason).toMatch(
      /did not finish within 2 seconds/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    /* ~75 turns at 20 ms over 1.5 s; far more than none is the point. */
    expect(ticks).toBeGreaterThan(30);
    expect(existsSync(join(dir, "artifacts", "backup.db"))).toBe(false);
  }, 15_000);

  it("keeps a finished local copy when only the second destination hangs, and says so", async () => {
    const second = join(dir, "second");
    mkdirSync(second);
    execFileSync("mkfifo", [join(second, "backup.db.partial")]);

    const { result, ticks } = await whileCounting(
      runBackupCopy(
        request({ secondary: { root: second, path: join(second, "backup.db") }, timeoutMs: 1_500 }),
      ),
    );

    expect(result.status).toBe("stored");
    expect(result.status === "stored" && result.copyFailed).toMatch(/second destination/);
    expect(ticks).toBeGreaterThan(30);
    expect(existsSync(join(dir, "artifacts", "backup.db"))).toBe(true);
    expect(existsSync(join(second, "backup.db"))).toBe(false);
  }, 15_000);
});
