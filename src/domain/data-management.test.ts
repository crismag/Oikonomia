import { describe, expect, it } from "vitest";

import { continuityConcerns, type ContinuityStatus, type DataJob } from "./data-management";

/** A completed job, in as few fields as the type allows. */
const job = (): DataJob => ({
  id: "job-1",
  operation: "backup",
  executionActor: "system",
  scope: { type: "site" },
  destination: "local",
  status: "completed",
  progress: 100,
  requestedAt: "2026-09-12T02:00:00.000Z",
  withheldCount: 0,
});

const base: Pick<ContinuityStatus, "failedJobs" | "lastSuccessfulBackup" | "lastVerifiedRestore"> =
  {
    failedJobs: [],
    lastSuccessfulBackup: job(),
    lastVerifiedRestore: job(),
  };

/**
 * The three states a second backup destination can be in.
 *
 * Collapsing them is how somebody believes they have a backup they do not:
 * nothing configured, a copy sharing a disk with the database, and a copy an
 * operator has asserted is elsewhere are genuinely different situations.
 */
describe("what an administrator is told about the second copy", () => {
  it("says every copy is on this server when nothing is configured", () => {
    const concerns = continuityConcerns({ ...base, offsiteMissing: true });
    expect(concerns.join(" ")).toContain("Every backup is on this server");
  });

  /* Configured but not declared: better than nothing, still not enough, and
     the message says what to do about it. */
  it("names the directory and what is still missing", () => {
    const concerns = continuityConcerns({
      ...base,
      offsiteMissing: true,
      secondaryCopy: {
        directory: "/mnt/backup",
        declaredOffsite: false,
        separateDevice: true,
      },
    });

    expect(concerns.join(" ")).toContain("/mnt/backup");
    expect(concerns.join(" ")).toContain("OIKONOMIA_BACKUP_OFFSITE");
    expect(concerns.join(" ")).not.toContain("Every backup is on this server");
  });

  /* The mistake people actually make, and the one thing measurable. */
  it("warns when the backup directory shares a disk with the database", () => {
    const concerns = continuityConcerns({
      ...base,
      offsiteMissing: false,
      secondaryCopy: {
        directory: "/var/oikonomia/backups",
        declaredOffsite: true,
        separateDevice: false,
      },
    });

    expect(concerns.join(" ")).toContain("same disk as the database");
  });

  it("is quiet once a declared, separate destination is configured", () => {
    expect(
      continuityConcerns({
        ...base,
        offsiteMissing: false,
        secondaryCopy: {
          directory: "/mnt/offsite",
          declaredOffsite: true,
          separateDevice: true,
        },
      }),
    ).toEqual([]);
  });
});
