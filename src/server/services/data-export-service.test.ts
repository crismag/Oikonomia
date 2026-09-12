import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { LocalStorage } from "../data/storage";
import { createDataJobRepository } from "../repositories/data-job-repository";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createDataExportService } from "./data-export-service";
import { createOrganizationService } from "./organization-service";
import { createLeadershipReportService } from "./leadership-report-service";
import { viewerOf } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Taking an authorized copy.
 *
 * An export crosses every page boundary at once, which makes it the easiest
 * place in a product to lose an access model. Almost everything here asserts an
 * **absence**: that a scope was refused, or that a record did not come back.
 *
 * The two gates are tested separately, because passing the first has never
 * implied the second: the scope decides what may be *asked for*, and the
 * modules decide what actually comes back.
 */

let dir: string;
let db: Db;
let jobs: ReturnType<typeof createDataJobRepository>;
let service: ReturnType<typeof createDataExportService>;
let organization: ReturnType<typeof createOrganizationService>;
let reports: ReturnType<typeof createLeadershipReportService>;
let repo: ReturnType<typeof createOrganizationRepository>;

let admin: ReturnType<typeof viewerOf>;
let bishop: ReturnType<typeof viewerOf>;
let maria: ReturnType<typeof viewerOf>;
let joel: ReturnType<typeof viewerOf>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-export-"));
  db = openDatabase(join(dir, "test.db"));

  repo = createOrganizationRepository(db);
  organization = createOrganizationService(repo);
  jobs = createDataJobRepository(db);

  const reportRepo = createLeadershipReportRepository(db);
  reports = createLeadershipReportService(reportRepo, repo);

  service = createDataExportService(jobs, {
    organization: repo,
    reports: reportRepo,
    meetings: createMeetingRepository(db),
  });

  admin = viewerOf(repo.insertPerson({ name: "Perpetua Okonkwo", accessRole: "admin" }));
  bishop = viewerOf(repo.insertPerson({ name: "Tobias Wren", accessRole: "bishop" }));
  maria = viewerOf(repo.insertPerson({ name: "Delphine Arceneaux", accessRole: "leader" }));
  joel = viewerOf(repo.insertPerson({ name: "Ignatius Bekele", accessRole: "leader" }));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what may be asked for", () => {
  it("lets anybody export their own records", () => {
    expect(() => service.run(maria, { scope: { type: "owned" }, format: "json" })).not.toThrow();
  });

  it("refuses a site export to somebody who does not administer", () => {
    for (const viewer of [maria, bishop]) {
      expect(() => service.run(viewer, { scope: { type: "site" }, format: "json" })).toThrow(
        ApiError,
      );
    }
  });

  it("refuses a campus export without campus oversight", () => {
    expect(() =>
      service.run(maria, { scope: { type: "campus", id: "cmp-1" }, format: "json" }),
    ).toThrow(ApiError);
  });

  it("refuses a ministry that is not theirs", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    expect(() =>
      service.run(maria, { scope: { type: "ministry", id: ministry.id }, format: "json" }),
    ).toThrow(ApiError);
  });

  it("lets whoever leads a ministry export it", () => {
    const ministry = organization.addMinistry(admin, { name: "Music", leadId: maria.person.id });
    expect(() =>
      service.run(maria, { scope: { type: "ministry", id: ministry.id }, format: "json" }),
    ).not.toThrow();
  });

  /* A claim is not membership, here as everywhere. */
  it("refuses a ministry somebody has only claimed", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    organization.claimAssignment(maria, { scope: "ministry", targetId: ministry.id });

    expect(() =>
      service.run(maria, { scope: { type: "ministry", id: ministry.id }, format: "json" }),
    ).toThrow(ApiError);
  });

  /* An unresolved scope is a refusal, not an empty export. "I could not work
     out what you asked for, so here is everything" is the failure that matters. */
  it("refuses a scope it does not recognise", () => {
    expect(() =>
      service.run(admin, { scope: { type: "everything" as never }, format: "json" }),
    ).toThrow(ApiError);
  });

  it("refuses a ministry that does not exist", () => {
    expect(() =>
      service.run(admin, { scope: { type: "ministry", id: "min-invented" }, format: "json" }),
    ).toThrow(ApiError);
  });
});

/**
 * The second gate. This is the one that matters most: an administrator may
 * legitimately export the site and still be entitled to none of the pastoral
 * material inside it.
 */
describe("what actually comes back", () => {
  const privateReport = () =>
    reports.create(maria, {
      reportType: "pastoral",
      title: "A private matter",
      visibility: "private",
    });

  it("leaves a private report out of somebody else's site export", () => {
    privateReport();

    const result = service.run(admin, { scope: { type: "site" }, format: "json" });
    const artifact = service.download(admin, result.job.id).body.toString("utf8");

    expect(artifact).not.toContain("A private matter");
    expect(result.withheldCount).toBe(1);
  });

  it("includes it in its own author's export", () => {
    privateReport();

    const result = service.run(maria, { scope: { type: "owned" }, format: "json" });
    expect(service.download(maria, result.job.id).body.toString("utf8")).toContain(
      "A private matter",
    );
  });

  /* Saying which records were withheld describes records the requester was not
     allowed to know exist. A count does not. */
  it("says how many were withheld without saying which", () => {
    privateReport();
    reports.create(maria, { reportType: "pastoral", title: "Another one", visibility: "private" });

    const result = service.run(admin, { scope: { type: "site" }, format: "json" });
    expect(result.withheldCount).toBe(2);

    const artifact = service.download(admin, result.job.id).body.toString("utf8");
    expect(artifact).not.toContain("Another one");
  });

  it("exports nothing when the scope is empty, rather than failing", () => {
    const result = service.run(joel, { scope: { type: "owned" }, format: "json" });
    expect(result.recordCount).toBe(0);
    expect(result.job.status).toBe("completed");
  });
});

describe("fetching what an export produced", () => {
  it("refuses somebody else's export, as though it were not there", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "json" });
    expect(() => service.download(joel, result.job.id)).toThrow(ApiError);
  });

  it("refuses an expired one", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "json" });
    jobs.update(result.job.id, { expiresAt: "2000-01-01T00:00:00.000Z" });

    expect(() => service.download(maria, result.job.id)).toThrow(ApiError);
  });

  /* A damaged artifact should be a clear failure rather than a file somebody
     tries to import next week. */
  it("refuses one whose checksum no longer matches", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "json" });
    jobs.update(result.job.id, { checksum: "0".repeat(64) });

    expect(() => service.download(maria, result.job.id)).toThrow(ApiError);
  });

  it("refuses a job that is not an export", () => {
    const backup = jobs.open({ operation: "backup", scope: { type: "site" } });
    expect(() => service.download(admin, backup.id)).toThrow(ApiError);
  });
});

describe("the record of what happened", () => {
  it("records who exported what, and how much", () => {
    service.run(maria, { scope: { type: "owned" }, format: "json" });

    const trail = jobs.auditTrail();
    expect(trail.some((event) => event.action === "export.requested")).toBe(true);
    expect(trail.some((event) => event.action === "export.completed")).toBe(true);
    expect(trail.every((event) => event.actorId === maria.person.id)).toBe(true);
  });

  it("records a download separately from the export itself", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "json" });
    service.download(maria, result.job.id);

    expect(jobs.auditTrail().some((event) => event.action === "export.downloaded")).toBe(true);
  });

  /* An audit row quoting the report it exported has widened the disclosure it
     exists to record. */
  it("keeps no exported content in the audit trail", () => {
    reports.create(maria, {
      reportType: "pastoral",
      title: "A private matter",
      visibility: "private",
    });
    service.run(maria, { scope: { type: "owned" }, format: "json" });

    expect(JSON.stringify(jobs.auditTrail())).not.toContain("A private matter");
  });
});

describe("the package format", () => {
  it("writes a manifest saying what it is and what it holds", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "opk" });
    const pkg = JSON.parse(service.download(maria, result.job.id).body.toString("utf8"));

    expect(pkg.manifest.format).toBe("oikonomia-portable-package");
    expect(pkg.manifest.formatVersion).toBe("1.0");
    expect(pkg.manifest.scope.type).toBe("owned");
    expect(pkg.manifest.schemaVersion).toBeGreaterThan(0);
  });

  it("checksums every section, so damage is detectable", () => {
    const result = service.run(maria, { scope: { type: "owned" }, format: "opk" });
    const pkg = JSON.parse(service.download(maria, result.job.id).body.toString("utf8"));

    expect(Object.keys(pkg.checksums).length).toBeGreaterThan(0);
    for (const value of Object.values(pkg.checksums)) {
      expect(String(value)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("puts no credentials or secrets in the manifest", () => {
    const result = service.run(admin, { scope: { type: "site" }, format: "opk" });
    const manifest = JSON.parse(
      service.download(admin, result.job.id).body.toString("utf8"),
    ).manifest;

    expect(JSON.stringify(manifest)).not.toMatch(/password|secret|token|key/i);
  });
});

/**
 * An artifact reference is an id, not a path.
 *
 * A store that followed a reference out of its own directory would turn every
 * download into a way to read the server's filesystem.
 */
describe("the artifact store", () => {
  it("refuses a reference that climbs out of itself", () => {
    const storage = new LocalStorage(join(dir, "artifacts"));

    for (const reference of ["../escape", "../../etc/passwd"]) {
      expect(() => storage.get(reference), reference).toThrow(/outside/);
    }
  });

  /**
   * An absolute reference is contained rather than refused.
   *
   * `join` makes `/etc/passwd` mean `<root>/etc/passwd`, which is inside the
   * store and does not exist — so the read fails rather than succeeding
   * somewhere it should not. This proves the outcome that matters: a file that
   * genuinely exists outside the store cannot be fetched by naming it.
   */
  it("cannot be made to read a file outside itself", () => {
    const outside = join(dir, "secret.txt");
    writeFileSync(outside, "the church's private key");

    const storage = new LocalStorage(join(dir, "artifacts"));

    for (const reference of [outside, "../secret.txt", "../../secret.txt"]) {
      let content = "";
      try {
        content = storage.get(reference).toString("utf8");
      } catch {
        /* Refused or absent; both are correct. */
      }
      expect(content, reference).not.toContain("private key");
    }
  });

  it("never hands back a reference containing a path separator", () => {
    const storage = new LocalStorage(join(dir, "artifacts"));
    const stored = storage.put("../../sneaky.json", "{}");

    expect(stored.reference).not.toContain("/");
    expect(storage.exists(stored.reference)).toBe(true);
  });
});
