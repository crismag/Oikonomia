import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { forgetProviders, localStorageProvider } from "../data/storage";
import { createDataJobRepository } from "../repositories/data-job-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createContinuityService } from "./continuity-service";
import { OPK_FORMAT, OPK_VERSION, continuityConcerns, mayDelete } from "@/domain/data-management";
import { viewerOf } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Backup, verification, import and retention.
 *
 * The promise underneath: **nothing claims to have worked until it has**. A
 * backup is not complete because a function returned; a package is not
 * importable because it parsed; an installation is not protected because a
 * file exists on the machine that would be lost with it.
 */

let dir: string;
let db: Db;
let jobs: ReturnType<typeof createDataJobRepository>;
let service: ReturnType<typeof createContinuityService>;

let admin: ReturnType<typeof viewerOf>;
let leader: ReturnType<typeof viewerOf>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-continuity-"));
  /* Artifacts go somewhere disposable, not into the working tree. */
  process.env["OIKONOMIA_ARTIFACTS"] = join(dir, "artifacts");

  db = openDatabase(join(dir, "test.db"));
  const repo = createOrganizationRepository(db);
  jobs = createDataJobRepository(db);
  service = createContinuityService(db, jobs);

  admin = viewerOf(repo.insertPerson({ name: "Perpetua Okonkwo", accessRole: "admin" }));
  leader = viewerOf(repo.insertPerson({ name: "Delphine Arceneaux", accessRole: "leader" }));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env["OIKONOMIA_ARTIFACTS"];
  /* The provider remembers its directory; the next test has a new one. */
  forgetProviders();
});

describe("taking a backup", () => {
  it("is an administrator's to do", () => {
    expect(() => service.runBackup(leader)).toThrow(ApiError);
  });

  it("produces a real copy, with a checksum", () => {
    const job = service.runBackup(admin);

    expect(job.status).toBe("completed");
    expect(job.artifactRef).toBeTruthy();
    expect(job.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(job.artifactBytes ?? 0).toBeGreaterThan(0);
  });

  /* A scheduled backup is not somebody's action, and recording it as one would
     make the audit trail lie about who did what. */
  it("can run as the system, with no person attached", () => {
    const job = service.runBackup(null);

    expect(job.executionActor).toBe("system");
    expect(job.requestedBy).toBeUndefined();

    const event = jobs.auditTrail().find((entry) => entry.action === "backup.completed");
    expect(event?.actorType).toBe("system");
    expect(event?.actorId).toBeUndefined();
  });

  it("leaves no scratch copy of the database lying about", () => {
    service.runBackup(admin);

    const leftovers = localStorageProvider()
      .list()
      .filter((artifact) => artifact.reference.includes("scratch"));
    expect(leftovers).toEqual([]);
  });
});

describe("proving a backup would restore", () => {
  it("opens the copy and checks it is a coherent database", () => {
    const backup = service.runBackup(admin);
    const verification = service.verifyBackup(admin, backup.id);

    expect(verification.status).toBe("completed");
    /* It counted the people in the copy, which means it really opened it. */
    expect(verification.recordCount).toBe(2);
    expect(verification.schemaVersion ?? 0).toBeGreaterThan(0);
  });

  it("fails safely when the copy has been damaged", () => {
    const backup = service.runBackup(admin);
    jobs.update(backup.id, { checksum: "0".repeat(64) });

    const verification = service.verifyBackup(admin, backup.id);
    expect(verification.status).toBe("failed");
    expect(verification.errorSummary).toMatch(/checksum/i);
  });

  it("fails safely when the copy has gone missing", () => {
    const backup = service.runBackup(admin);
    localStorageProvider().delete(backup.artifactRef!);

    expect(service.verifyBackup(admin, backup.id).status).toBe("failed");
  });

  it("is an administrator's to do", () => {
    const backup = service.runBackup(admin);
    expect(() => service.verifyBackup(leader, backup.id)).toThrow(ApiError);
  });

  it("refuses a job that is not a backup", () => {
    const other = jobs.open({ operation: "export", scope: { type: "owned" } });
    expect(() => service.verifyBackup(admin, other.id)).toThrow(ApiError);
  });
});

/**
 * A package is a file somebody sent. Everything here treats it that way.
 */
describe("checking a package", () => {
  const valid = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      manifest: {
        format: OPK_FORMAT,
        formatVersion: OPK_VERSION,
        createdAt: new Date().toISOString(),
        applicationVersion: "0.1.0",
        schemaVersion: 31,
        scope: { type: "owned" },
        includes: [],
        recordCounts: {},
        generator: "Oikonomia",
        ...(over["manifest"] as object),
      },
      data: over["data"] ?? { reports: [] },
      checksums: over["checksums"] ?? {},
    });

  it("accepts one this installation can read, and writes nothing", () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number };
    const result = service.validatePackage(admin, valid());

    expect(result.ok).toBe(true);
    expect(result.job.status).toBe("preview_ready");

    /* Validation has zero authoritative writes. That is the whole difference
       between a preview and an import. */
    const after = db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it("refuses a file that is not a package at all", () => {
    const result = service.validatePackage(admin, "just some text");
    expect(result.ok).toBe(false);
    expect(result.job.status).toBe("validation_failed");
  });

  /* Never best-guess an unknown schema: half-reading a package writes nonsense
     into a church's records. */
  it("refuses a version it does not know", () => {
    const result = service.validatePackage(admin, valid({ manifest: { formatVersion: "9.9" } }));
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/9\.9/);
  });

  it("refuses one with no version at all", () => {
    const result = service.validatePackage(admin, valid({ manifest: { formatVersion: "" } }));
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/version/i);
  });

  it("refuses one whose contents do not match their checksums", () => {
    const result = service.validatePackage(
      admin,
      valid({ data: { reports: [{ id: "r1" }] }, checksums: { reports: "0".repeat(64) } }),
    );

    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/damaged/i);
  });

  it("refuses one too large to be reasonable", () => {
    const result = service.validatePackage(admin, "x".repeat(33 * 1024 * 1024));
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/larger/i);
  });

  it("is an administrator's to do", () => {
    expect(() => service.validatePackage(leader, valid())).toThrow(ApiError);
  });

  it("records every outcome, refusals included", () => {
    service.validatePackage(admin, "nonsense");
    expect(jobs.auditTrail().some((event) => event.action === "import.uploaded")).toBe(true);
  });
});

describe("what an administrator is told about continuity", () => {
  it("says plainly that nothing has ever been backed up", () => {
    expect(service.status(admin).concerns.join(" ")).toMatch(/no backup has ever/i);
  });

  /**
   * The one that must not be softened.
   *
   * A local-only backup is genuinely useful for a bad deploy and genuinely
   * useless for a dead machine. Reporting it as sufficient would leave a church
   * one hardware failure from losing everything while believing otherwise.
   */
  it("still reports a concern after a successful local backup", () => {
    service.runBackup(admin);

    const status = service.status(admin);
    expect(status.lastSuccessfulBackup).toBeTruthy();
    expect(status.offsiteMissing).toBe(true);
    expect(status.concerns.join(" ")).toMatch(/this server/i);
  });

  it("says when no restore has ever been verified", () => {
    service.runBackup(admin);
    expect(service.status(admin).concerns.join(" ")).toMatch(/no restore/i);
  });

  it("stops saying so once one has been", () => {
    const backup = service.runBackup(admin);
    service.verifyBackup(admin, backup.id);

    expect(service.status(admin).concerns.join(" ")).not.toMatch(/no restore/i);
  });

  it("surfaces failures rather than leaving them in a log", () => {
    jobs.update(jobs.open({ operation: "export", scope: { type: "owned" } }).id, {
      status: "failed",
    });

    expect(service.status(admin).concerns.join(" ")).toMatch(/failed/i);
  });

  it("is an administrator's to see", () => {
    expect(() => service.status(leader)).toThrow(ApiError);
  });
});

describe("retention", () => {
  it("deletes a staged export once it is past its policy", () => {
    const job = jobs.open({ operation: "export", scope: { type: "owned" } });
    const stored = localStorageProvider().put("old.json", "{}");

    jobs.update(job.id, {
      status: "completed",
      artifactRef: stored.reference,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    /* Requested long ago, so it is older than the one-day export policy. */
    db.prepare("UPDATE data_job SET requested_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(
      job.id,
    );

    expect(service.runRetention(admin).deleted).toBe(1);
    expect(localStorageProvider().exists(stored.reference)).toBe(false);
    expect(jobs.find(job.id)?.status).toBe("expired");
  });

  /* Deleting a backup early is the one mistake here that cannot be undone. */
  it("keeps a backup that is not old enough, however expired the artifact says", () => {
    const backup = service.runBackup(admin);
    jobs.update(backup.id, { expiresAt: "2000-01-01T00:00:00.000Z" });

    expect(service.runRetention(admin).deleted).toBe(0);
    expect(localStorageProvider().exists(backup.artifactRef!)).toBe(true);
  });

  it("keeps everything in a class that is on hold", () => {
    service.setRetention(admin, "export", { onHold: true });

    const job = jobs.open({ operation: "export", scope: { type: "owned" } });
    const stored = localStorageProvider().put("held.json", "{}");
    jobs.update(job.id, {
      status: "completed",
      artifactRef: stored.reference,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    db.prepare("UPDATE data_job SET requested_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(
      job.id,
    );

    expect(service.runRetention(admin).deleted).toBe(0);
    expect(localStorageProvider().exists(stored.reference)).toBe(true);
  });

  it("records who changed a policy", () => {
    service.setRetention(admin, "backup", { retentionDays: 90 });

    const policy = service.status(admin).policies.find((p) => p.artifactClass === "backup");
    expect(policy?.retentionDays).toBe(90);
    expect(policy?.updatedBy).toBe(admin.person.id);
    expect(jobs.auditTrail().some((event) => event.action === "retention.changed")).toBe(true);
  });

  it("is an administrator's to change", () => {
    expect(() => service.setRetention(leader, "backup", { retentionDays: 1 })).toThrow(ApiError);
  });
});

describe("the retention rule itself", () => {
  const policy = {
    artifactClass: "export" as const,
    retentionDays: 7,
    enabled: true,
    onHold: false,
    updatedAt: "",
  };

  it("deletes only what is old enough", () => {
    expect(mayDelete(policy, 8)).toBe(true);
    expect(mayDelete(policy, 6)).toBe(false);
  });

  it("deletes nothing when the policy is off, on hold, or missing", () => {
    expect(mayDelete({ ...policy, enabled: false }, 999)).toBe(false);
    expect(mayDelete({ ...policy, onHold: true }, 999)).toBe(false);
    expect(mayDelete(undefined, 999)).toBe(false);
  });
});

describe("how continuity is summarised", () => {
  it("says everything that is wrong, not only the first thing", () => {
    const concerns = continuityConcerns({ failedJobs: [], offsiteMissing: true });
    expect(concerns.length).toBeGreaterThan(1);
  });

  it("says nothing when there is nothing to say", () => {
    const job = { id: "j" } as never;
    expect(
      continuityConcerns({
        lastSuccessfulBackup: job,
        lastVerifiedRestore: job,
        failedJobs: [],
        offsiteMissing: false,
      }),
    ).toEqual([]);
  });
});
