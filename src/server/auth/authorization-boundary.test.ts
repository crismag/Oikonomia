import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createDataJobRepository } from "../repositories/data-job-repository";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "../services/auth-service";
import { createDataExportService } from "../services/data-export-service";
import { createLeadershipReportService } from "../services/leadership-report-service";
import { createOrganizationService } from "../services/organization-service";
import { getCurrentUser, SESSION_COOKIE } from "./current-user";
import type { Database as Db } from "better-sqlite3";

/**
 * The authorization boundary, under a real identity.
 *
 * Every rule tested elsewhere in this repository was already enforced
 * server-side — and all of it was evaluated against a person id the browser
 * supplied. This file is the revalidation: the same rules, reached the way a
 * request actually reaches them, from a session the server issued.
 *
 * The question each test asks is the one an attacker asks: **can I change
 * something I control and get something I should not have?**
 */

let dir: string;
let db: Db;

let organization: ReturnType<typeof createOrganizationService>;
let repo: ReturnType<typeof createOrganizationRepository>;
let accounts: ReturnType<typeof createAccountRepository>;
let auth: ReturnType<typeof createAuthService>;
let reports: ReturnType<typeof createLeadershipReportService>;
let exports: ReturnType<typeof createDataExportService>;

/** A signed-in person: their ids, and the session cookie a request would send. */
interface SignedIn {
  personId: string;
  accountId: string;
  cookie: string;
}

function enrol(name: string, email: string, accessRole?: string): SignedIn {
  const person = repo.insertPerson({
    name,
    ...(accessRole ? { accessRole } : {}),
  } as never);
  const account = accounts.create({ personId: person.id, email, status: "active" });
  auth.setPassword(account.id, "a long enough passphrase");

  const { token } = auth.signInWithPassword({ email, password: "a long enough passphrase" });
  return { personId: person.id, accountId: account.id, cookie: `${SESSION_COOKIE}=${token}` };
}

const asRequest = (who: SignedIn) =>
  new Request("https://oikonomia.test/", { headers: { cookie: who.cookie } });

/** The viewer a request resolves to — what every API module works from. */
const viewerOf = (who: SignedIn) => getCurrentUser(asRequest(who), db)!;

let admin: SignedIn;
let bishop: SignedIn;
let maria: SignedIn;
let joel: SignedIn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-boundary-"));
  db = openDatabase(join(dir, "test.db"));

  repo = createOrganizationRepository(db);
  organization = createOrganizationService(repo);
  accounts = createAccountRepository(db);
  auth = createAuthService(accounts, repo);

  const reportRepo = createLeadershipReportRepository(db);
  reports = createLeadershipReportService(reportRepo, repo);
  exports = createDataExportService(createDataJobRepository(db), {
    organization: repo,
    reports: reportRepo,
    meetings: createMeetingRepository(db),
  });

  admin = enrol("Perpetua Okonkwo", "perpetua@example.org", "admin");
  bishop = enrol("Tobias Wren", "tobias@example.org", "bishop");
  maria = enrol("Delphine Arceneaux", "delphine@example.org");
  joel = enrol("Ignatius Bekele", "ignatius@example.org");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the principal is the server's, not the client's", () => {
  it("resolves the person the session names, whatever else the request says", () => {
    /* Every identity-shaped value an attacker might set, set to the bishop. */
    const request = new Request("https://oikonomia.test/?personId=" + bishop.personId, {
      headers: {
        cookie: `${maria.cookie}; oikonomia_person=${bishop.personId}; oikonomia_viewer=${bishop.personId}`,
        "x-person-id": bishop.personId,
        "x-account-id": bishop.accountId,
      },
    });

    const viewer = getCurrentUser(request, db)!;
    expect(viewer.person.id).toBe(maria.personId);
    expect(viewer.persona.capabilities).toEqual([]);
  });

  /**
   * No cookie, and every other way of asserting identity tried at once.
   *
   * The previous test proves a session wins over a client's claim; this proves
   * a client's claim alone is worth nothing — which is the property that
   * actually matters, and the one a careless refactor would lose.
   */
  it("is nobody when the only identity offered is one the client wrote", () => {
    const request = new Request("https://oikonomia.test/?personId=" + admin.personId, {
      headers: {
        cookie: `oikonomia_person=${admin.personId}; oikonomia_viewer=${admin.personId}; oikonomia_persona=admin`,
        "x-person-id": admin.personId,
        "x-account-id": admin.accountId,
        "x-oikonomia-person": admin.personId,
        authorization: `Bearer ${admin.personId}`,
      },
    });

    expect(getCurrentUser(request, db)).toBeUndefined();
  });

  it("cannot be obtained by naming an account or a person", () => {
    for (const guess of [maria.personId, maria.accountId, admin.accountId]) {
      const request = new Request("https://oikonomia.test/", {
        headers: { cookie: `${SESSION_COOKIE}=${guess}` },
      });
      expect(getCurrentUser(request, db), guess).toBeUndefined();
    }
  });
});

/**
 * §15 — `canDiscover` under a real principal.
 */
describe("what a signed-in person may discover", () => {
  const privateReport = () =>
    reports.create(viewerOf(maria), {
      reportType: "pastoral",
      title: "A private matter",
      visibility: "private",
    });

  it("gives the author their own report", () => {
    const report = privateReport();
    expect(reports.get(viewerOf(maria), report.id).id).toBe(report.id);
  });

  it("refuses another leader", () => {
    const report = privateReport();
    expect(() => reports.get(viewerOf(joel), report.id)).toThrow(ApiError);
  });

  /* Seniority is not an audience, and administration is not readership. */
  it("refuses the bishop and the administrator alike", () => {
    const report = privateReport();
    expect(() => reports.get(viewerOf(bishop), report.id)).toThrow(ApiError);
    expect(() => reports.get(viewerOf(admin), report.id)).toThrow(ApiError);
  });

  it("gives nothing to somebody with no confirmed assignments", () => {
    privateReport();
    expect(reports.list(viewerOf(joel)).reports).toEqual([]);
  });
});

/**
 * §12 and §5 — the confirmation flow survives the authentication rewrite.
 */
describe("a claim still grants nothing", () => {
  it("does not become membership by being made while signed in", () => {
    const ministry = organization.addMinistry(viewerOf(admin), { name: "Music" });

    organization.claimAssignment(viewerOf(maria), {
      scope: "ministry",
      targetId: ministry.id,
    });

    expect(repo.findPerson(maria.personId)?.ministryIds).toEqual([]);
    /* And the scope it would have unlocked is still refused. */
    expect(() =>
      exports.run(viewerOf(maria), {
        scope: { type: "ministry", id: ministry.id },
        format: "json",
      }),
    ).toThrow(ApiError);
  });

  it("becomes membership when an administrator confirms it, and not before", () => {
    const ministry = organization.addMinistry(viewerOf(admin), { name: "Music" });
    organization.claimAssignment(viewerOf(maria), { scope: "ministry", targetId: ministry.id });

    organization.setAssignment(viewerOf(admin), {
      scope: "ministry",
      targetId: ministry.id,
      personId: maria.personId,
      status: "confirmed",
    });

    expect(repo.findPerson(maria.personId)?.ministryIds).toEqual([ministry.id]);
    expect(() =>
      exports.run(viewerOf(maria), {
        scope: { type: "ministry", id: ministry.id },
        format: "json",
      }),
    ).not.toThrow();
  });

  /* Administration decides where other people serve, never where the
     administrator does: otherwise one account could reach anything. */
  it("cannot be confirmed by an administrator who made it", () => {
    const ministry = organization.addMinistry(viewerOf(admin), { name: "Music" });
    organization.claimAssignment(viewerOf(admin), { scope: "ministry", targetId: ministry.id });

    expect(() =>
      organization.setAssignment(viewerOf(admin), {
        scope: "ministry",
        targetId: ministry.id,
        personId: admin.personId,
        status: "confirmed",
      }),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(repo.findPerson(admin.personId)?.ministryIds ?? []).not.toContain(ministry.id);

    /* Declining or ending their own claim narrows, so it is theirs to do. */
    expect(() =>
      organization.setAssignment(viewerOf(admin), {
        scope: "ministry",
        targetId: ministry.id,
        personId: admin.personId,
        status: "ended",
      }),
    ).not.toThrow();
  });

  it("refuses an administrator joining, leading or sitting in a group on their own say", () => {
    const self = viewerOf(admin);
    const ministry = organization.addMinistry(self, { name: "Music" });
    const group = organization.addGroup(self, { name: "Elders", leadershipAudience: true });
    const forbidden = expect.objectContaining({ code: "forbidden" });

    expect(() =>
      organization.setMembership(self, {
        ministryId: ministry.id,
        personId: admin.personId,
        member: true,
      }),
    ).toThrow(forbidden);
    expect(() =>
      organization.setGroupMembership(self, {
        groupId: group.id,
        personId: admin.personId,
        member: true,
      }),
    ).toThrow(forbidden);
    expect(() =>
      organization.updateMinistry(self, ministry.id, { leadId: admin.personId }),
    ).toThrow(forbidden);
    expect(() =>
      organization.addMinistry(self, { name: "Hospitality", leadId: admin.personId }),
    ).toThrow(forbidden);

    /* The same administrator still decides for somebody else. */
    expect(() =>
      organization.setGroupMembership(self, {
        groupId: group.id,
        personId: maria.personId,
        member: true,
      }),
    ).not.toThrow();
  });

  it("cannot be confirmed by the person who made it", () => {
    const ministry = organization.addMinistry(viewerOf(admin), { name: "Music" });
    organization.claimAssignment(viewerOf(maria), { scope: "ministry", targetId: ministry.id });

    expect(() =>
      organization.setAssignment(viewerOf(maria), {
        scope: "ministry",
        targetId: ministry.id,
        personId: maria.personId,
        status: "confirmed",
      }),
    ).toThrow(ApiError);
  });
});

/**
 * §16 — export security, re-run under real authentication.
 */
describe("export is still not an authorization bypass", () => {
  it("withholds what the requester may not read, without naming it", () => {
    reports.create(viewerOf(maria), {
      reportType: "pastoral",
      title: "A private matter",
      visibility: "private",
    });

    const result = exports.run(viewerOf(admin), { scope: { type: "site" }, format: "json" });
    const artifact = exports.download(viewerOf(admin), result.job.id).body.toString("utf8");

    expect(result.withheldCount).toBe(1);
    expect(artifact).not.toContain("A private matter");
  });

  it("still refuses a scope wider than the requester", () => {
    for (const who of [maria, bishop]) {
      expect(() => exports.run(viewerOf(who), { scope: { type: "site" }, format: "json" })).toThrow(
        ApiError,
      );
    }
  });

  /* An export artifact is somebody's. Knowing its id is not permission. */
  it("refuses somebody else's export artifact", () => {
    const result = exports.run(viewerOf(maria), { scope: { type: "owned" }, format: "json" });
    expect(() => exports.download(viewerOf(joel), result.job.id)).toThrow(ApiError);
  });
});

/**
 * §14 — knowing an identifier is not permission to use it.
 */
describe("identifiers are not keys", () => {
  it("refuses a report by id to somebody outside its audience", () => {
    const report = reports.create(viewerOf(maria), {
      reportType: "pastoral",
      title: "A private matter",
      visibility: "private",
    });

    /* Not "forbidden": saying so would confirm a report about somebody
       exists. */
    expect(() => reports.get(viewerOf(joel), report.id)).toThrow(ApiError);
  });

  it("refuses administrative writes to somebody who administers nothing", () => {
    const ministry = organization.addMinistry(viewerOf(admin), { name: "Music" });

    expect(() =>
      organization.updateMinistry(viewerOf(maria), ministry.id, { name: "Renamed" }),
    ).toThrow(ApiError);
    expect(() =>
      organization.updatePerson(viewerOf(maria), joel.personId, { accessRole: "admin" }),
    ).toThrow(ApiError);
    expect(() =>
      organization.addGroup(viewerOf(maria), { name: "Elders", leadershipAudience: true }),
    ).toThrow(ApiError);
  });

  it("does not let somebody raise their own role", () => {
    expect(() =>
      organization.updatePerson(viewerOf(maria), maria.personId, { accessRole: "admin" }),
    ).toThrow(ApiError);

    expect(viewerOf(maria).persona.capabilities).toEqual([]);
  });
});
