import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOrganizationRepository } from "../repositories/organization-repository";
import { openDatabase } from "../db/connection";
import { seedAll } from "@/test/seeds";
import { createCalendarRepository } from "../repositories/calendar-repository";
import { createGoalsRepository } from "../repositories/goals-repository";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { createLifegroupRepository } from "../repositories/lifegroup-repository";
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createReachOutRepository } from "../repositories/reach-out-repository";
import { createWorkRepository } from "../repositories/work-repository";
import { createDashboardService } from "./dashboard-service";
import { createTeamOverviewService } from "./team-overview-service";
import { canDiscover } from "@/domain/leadership-report";
import { statusLabel } from "@/domain/obligations";
import { viewerFor } from "@/test/viewer";
import { personById } from "@/test/fixtures";
import type { Database as Db } from "better-sqlite3";

/**
 * The team overview.
 *
 * Every test here guards one of three promises: **aggregation does not walk
 * around a permission**, **workflow state travels but content does not**, and
 * **this is not a ranking**.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createTeamOverviewService>;
let reports: ReturnType<typeof createLeadershipReportRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");
const TODAY = "2026-09-11";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The same shortening the service uses for a period label. */
const shorten = (period: string) => {
  const [month, year] = period.split(" ");
  return `${month!.slice(0, 3)} ${year!.slice(2)}`;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-team-"));
  db = openDatabase(join(dir, "test.db"));
  seedAll(db);

  reports = createLeadershipReportRepository(db);
  const lifegroup = createLifegroupRepository(db);
  const work = createWorkRepository(db);
  const organization = createOrganizationRepository(db);
  const dashboard = createDashboardService({
    calendar: createCalendarRepository(db),
    meetings: createMeetingRepository(db),
    lifegroup,
    reachOut: createReachOutRepository(db),
    reports,
    goals: createGoalsRepository(db),
    work,
    organization,
  });
  service = createTeamOverviewService(dashboard, { reports, lifegroup, work, organization });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what it shows", () => {
  it("counts leaders, not everybody in the church", () => {
    const overview = service.build(bishop, TODAY);
    expect(overview.leaderCount).toBeGreaterThan(0);
    /* There are ninety-odd people in the fixtures; most are members and guests
       and the binder expects no leadership work from them. */
    expect(overview.leaderCount).toBeLessThan(30);
  });

  it("summarizes each leader's sections and how many are outstanding", () => {
    const overview = service.build(bishop, TODAY);
    expect(overview.leaders.length).toBe(overview.leaderCount);
    for (const leader of overview.leaders) {
      expect(Object.keys(leader.areas).length).toBeGreaterThan(0);
      expect(leader.outstanding).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts what is overdue above what is merely due", () => {
    const overview = service.build(bishop, TODAY);
    const weight = { blocked: 0, warning: 1 } as Record<string, number>;
    for (let i = 1; i < overview.attention.length; i += 1) {
      expect(weight[overview.attention[i]!.status] ?? 2).toBeGreaterThanOrEqual(
        weight[overview.attention[i - 1]!.status] ?? 2,
      );
    }
  });

  it("sends every attention item somewhere a reader can actually go", () => {
    for (const item of service.build(bishop, TODAY).attention) {
      expect(item.destination).toMatch(/^\//);
    }
  });

  /** Never written and submitted-but-unread are different problems. */
  /**
   * Reporting completion is not review completion.
   *
   * "Not submitted" is a leader who has not written. "Unread" is information
   * this viewer has not opened — a reading state, never a queue. The counts
   * must stay apart, and submitted + outstanding must still account for
   * everything expected.
   */
  it("keeps not-submitted apart from not-yet-read", () => {
    const { reporting } = service.build(bishop, TODAY);
    expect(reporting).toHaveProperty("outstanding");
    expect(reporting).toHaveProperty("unread");
    expect(reporting).not.toHaveProperty("awaitingReview");
    expect(reporting.submitted + reporting.outstanding).toBe(reporting.expected);
  });
});

/**
 * The promise that would do real harm if broken.
 */
describe("aggregation does not walk around a permission", () => {
  /**
   * Maria's private development notes are hers. Nothing about them may reach
   * this page — not the title, not the id, not a number they were added into.
   */
  it("puts no part of a withheld report into anyone else's overview", () => {
    const priv = reports.find("lr-a-private")!;
    for (const viewer of [joel, bishop, admin]) {
      const serialized = JSON.stringify(service.build(viewer, TODAY));
      expect(serialized, viewer.person.id).not.toContain(priv.title);
      expect(serialized, viewer.person.id).not.toContain(priv.id);
    }
  });

  /**
   * Workflow state travels; content does not. A report's title can name what
   * it is about — "Concern raised about a Music Ministry volunteer" — so the
   * summary is built from the module and the state and nothing the leader
   * wrote.
   */
  it("carries no titles into what it says about other people", () => {
    const overview = service.build(bishop, TODAY);
    /* Vacuously true if nothing is flagged, so the premise is asserted too. */
    expect(overview.attention.length).toBeGreaterThan(0);

    const serialized = JSON.stringify({
      attention: overview.attention,
      leaders: overview.leaders,
    });

    /*
     * Both kinds of title: what a report is called, and what the obligation
     * projection calls the work. Either would be describing somebody else's
     * business to everyone in scope.
     */
    for (const title of reports
      .allUnguarded()
      .map((r) => r.title)
      .filter((t) => t.length > 12)) {
      expect(serialized, title).not.toContain(title);
    }
    for (const item of overview.attention) {
      expect(item.summary, item.id).toBe(`${item.module} · ${statusLabel[item.status]}`);
    }
  });

  /**
   * Summing withheld records into a public number is a slower way of
   * disclosing them, so the reporting figures are counted through the module's
   * own gate. This pins the figure to exactly what the viewer may discover.
   */
  it("counts only reports the viewer could have discovered anyway", () => {
    for (const viewer of [bishop, joel]) {
      const overview = service.build(viewer, TODAY);
      const leaderIds = new Set(overview.leaders.map((l) => l.personId));
      const periods = new Set(overview.heatmap.periods);

      const discoverable = new Set(
        reports
          .allUnguarded()
          .filter((r) => canDiscover(r, viewer.persona, viewer.person))
          .filter((r) => r.reportingPeriod && leaderIds.has(r.authorId))
          .filter((r) => periods.has(shorten(r.reportingPeriod!)))
          .map((r) => `${r.authorId}:${r.reportingPeriod}`),
      );

      expect(overview.reporting.submitted, viewer.person.id).toBe(discoverable.size);
    }
  });

  /**
   * The decisive case, constructed rather than hoped for: a report the viewer
   * may not discover, authored by a leader they *can* see, in a period the
   * page counts. If the gate were dropped, this would be added into a figure
   * shown to somebody who may not know it exists.
   */
  it("does not count a withheld report even when its author is in scope", () => {
    const overview = service.build(bishop, TODAY);
    const before = overview.reporting.submitted;

    /*
     * A leader-and-period pair with nothing filed, so the new row genuinely
     * changes the count if it is counted. An earlier version of this test used
     * any leader and any period, and the deduplication by pair hid the effect.
     */
    const filed = new Set(
      reports
        .allUnguarded()
        .filter((r) => r.reportingPeriod)
        .map((r) => `${r.authorId}:${r.reportingPeriod}`),
    );
    const slot = overview.leaders
      .flatMap((leader) =>
        overview.heatmap.periods.map((period) => ({ leader: leader.personId, period })),
      )
      .map(({ leader, period }) => {
        const [month, yy] = period.split(" ");
        const full = `${MONTHS.find((m) => m.startsWith(month!))} 20${yy}`;
        return { leader, full };
      })
      .find(({ leader, full }) => !filed.has(`${leader}:${full}`));

    expect(slot, "the fixtures left no empty leader-period to test with").toBeDefined();
    const author = slot!.leader;
    reports.insert({
      title: "Something private",
      reportType: "leadership-development",
      authorId: author,
      /* Author-only: the bishop is not an audience for this. */
      visibility: "private",
      status: "published",
      reportingPeriod: slot!.full,
      audienceIds: [],
      discussionPolicy: "viewers",
      contentSource: "native",
      relatedDocumentIds: [],
      links: [],
      tags: [],
    } as never);

    const after = service.build(bishop, TODAY);
    expect(after.reporting.submitted).toBe(before);
    expect(JSON.stringify(after)).not.toContain("Something private");
  });

  it("gives a leader with no oversight the figures and no names", () => {
    /* Maria leads Music Ministry, so she has oversight of it. A leader with
       none is the ordinary case this rule exists for. */
    const overview = service.build(viewerFor("leader"), TODAY);
    if (!overview.scope.namesVisible) {
      expect(overview.leaders).toEqual([]);
      expect(overview.attention.every((item) => item.personId === undefined)).toBe(true);
      expect(overview.heatmap.cells).toEqual([]);
    }
    expect(overview.scope.reason).toBeTruthy();
  });

  /**
   * Joel is a campus leader as well as a ministry head, so he gets the campus.
   * The narrower case is somebody who only leads a ministry.
   */
  it("narrows a ministry lead who has no wider oversight to their ministry", () => {
    const esther: typeof joel = {
      persona: joel.persona,
      person: personById("p-esther"),
    };
    const forEsther = service.build(esther, TODAY);
    const forBishop = service.build(bishop, TODAY);

    expect(forEsther.scope.namesVisible).toBe(true);
    expect(forEsther.scope.label).toContain("Victuals");
    expect(forEsther.leaderCount).toBeLessThan(forBishop.leaderCount);
  });

  it("gives a campus leader their campus, because that is the oversight they hold", () => {
    const overview = service.build(joel, TODAY);
    expect(overview.scope.namesVisible).toBe(true);
    expect(overview.scope.label).toMatch(/leaders$/);
  });
});

/**
 * Not a leaderboard.
 */
describe("it does not rank people", () => {
  it("attaches no score or position to any leader", () => {
    for (const leader of service.build(bishop, TODAY).leaders) {
      expect(leader).not.toHaveProperty("score");
      expect(leader).not.toHaveProperty("rank");
      expect(leader).not.toHaveProperty("percentile");
    }
  });

  /**
   * Attention items describe an observable workflow condition and a period.
   * Nothing here is a judgement about a person.
   */
  it("gives every attention item an observable reason", () => {
    const allowed = new Set([
      "overdue",
      "due-soon",
      "incomplete",
      "awaiting-review",
      "repeated-late",
      "blocked",
    ]);
    for (const item of service.build(bishop, TODAY).attention) {
      expect(allowed.has(item.reason), item.reason).toBe(true);
      expect(item.period).toBeTruthy();
    }
  });
});
