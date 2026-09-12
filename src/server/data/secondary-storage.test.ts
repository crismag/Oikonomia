import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DirectoryStorage,
  forgetProviders,
  hasOffsiteProvider,
  onSeparateDevice,
  providers,
  secondaryStorageProvider,
} from "./storage";

/**
 * The copy meant to survive this machine.
 *
 * The readiness audit's gap 3: every backup sat on the disk holding the
 * database, so one hardware failure took the data and every copy together.
 */

let dir: string;
const original = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-secondary-"));
  forgetProviders();
});

afterEach(() => {
  process.env = { ...original };
  forgetProviders();
  rmSync(dir, { recursive: true, force: true });
});

describe("configuring a second destination", () => {
  it("has none until one is configured", () => {
    delete process.env["OIKONOMIA_BACKUP_DIR"];
    expect(secondaryStorageProvider()).toBeUndefined();
    expect(providers()).toHaveLength(1);
    expect(hasOffsiteProvider()).toBe(false);
  });

  it("writes to the configured directory", () => {
    process.env["OIKONOMIA_BACKUP_DIR"] = dir;
    const second = secondaryStorageProvider()!;

    const stored = second.put("backup.db", Buffer.from("contents"));
    expect(second.exists(stored.reference)).toBe(true);
    expect(second.get(stored.reference).toString()).toBe("contents");
    expect(providers()).toHaveLength(2);
  });

  /**
   * The honesty rule. A process cannot tell a mounted volume in another
   * building from a folder on its own disk, so it must not claim to know.
   */
  it("is not offsite merely because it is configured", () => {
    process.env["OIKONOMIA_BACKUP_DIR"] = dir;
    delete process.env["OIKONOMIA_BACKUP_OFFSITE"];

    expect(secondaryStorageProvider()!.offsite).toBe(false);
    expect(hasOffsiteProvider()).toBe(false);
  });

  it("is offsite only when an operator says so, in those words", () => {
    process.env["OIKONOMIA_BACKUP_DIR"] = dir;

    for (const [value, expected] of [
      ["true", true],
      ["TRUE", true],
      ["yes", false],
      ["1", false],
      ["", false],
    ] as const) {
      forgetProviders();
      process.env["OIKONOMIA_BACKUP_OFFSITE"] = value;
      expect(secondaryStorageProvider()!.offsite, value).toBe(expected);
    }
  });

  it("treats a blank directory as nothing configured", () => {
    process.env["OIKONOMIA_BACKUP_DIR"] = "   ";
    expect(secondaryStorageProvider()).toBeUndefined();
  });
});

describe("what can actually be measured", () => {
  it("sees a directory sharing a device with the database", () => {
    const database = join(dir, "oikonomia.db");
    writeFileSync(database, "");
    expect(onSeparateDevice(dir, database)).toBe(false);
  });

  /* Unreadable or missing paths answer "not separate" — the cautious reading,
     which keeps the warning up rather than silencing it. */
  it("does not claim separation it cannot confirm", () => {
    expect(onSeparateDevice(join(dir, "nowhere"), join(dir, "also-nowhere"))).toBe(false);
  });
});

describe("the provider's own claim", () => {
  it("carries the directory so an administrator can check it", () => {
    const second = new DirectoryStorage(dir, true);
    expect(second.directory).toBe(dir);
    expect(second.id).toBe("directory");
    expect(second.offsite).toBe(true);
  });
});
