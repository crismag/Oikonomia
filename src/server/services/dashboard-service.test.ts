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
import { needsAttention } from "@/domain/obligations";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * The obligation projection.
 *
 * The dashboard's one job is to describe the binder accurately. These tests
 * guard the two ways it could lie: by reporting something finished that is not,
 * and by showing a leader a record the owning section would have withheld.
 */

let db: Db;
let dir: string;
let service: ReturnType<typeof createDashboardService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const TODAY = "2026-09-11";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-dashboard-"));
  db = openDatabase(join(dir, "test.db"));
  seedAll(db);
  service = createDashboardService({
    calendar: createCalendarRepository(db),
    meetings: createMeetingRepository(db),
    lifegroup: createLifegroupRepository(db),
    reachOut: createReachOutRepository(db),
    reports: createLeadershipReportRepository(db),
    goals: createGoalsRepository(db),
    work: createWorkRepository(db),
    organization: createOrganizationRepository(db),
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what it projects", () => {
  it("covers the week and the month separately", () => {
    const board = service.build(maria, TODAY);
    expect(board.weekly.obligations.length).toBeGreaterThan(0);
    expect(board.monthly.obligations.length).toBeGreaterThan(0);

    /* A leader must never confuse something due Friday with something due at
       month end, so the two cycles never share an obligation. */
    const weekIds = new Set(board.weekly.obligations.map((o) => o.id));
    for (const monthly of board.monthly.obligations) {
      expect(weekIds.has(monthly.id)).toBe(false);
    }
  });

  it("names a real route for every action", () => {
    const board = service.build(maria, TODAY);
    for (const obligation of [...board.weekly.obligations, ...board.monthly.obligations]) {
      expect(obligation.destination, obligation.id).toMatch(/^\//);
      expect(obligation.nextAction, obligation.id).toBeTruthy();
    }
  });

  it("says which cadence each responsibility runs on", () => {
    const board = service.build(maria, TODAY);
    const cadences = new Set(
      [...board.weekly.obligations, ...board.monthly.obligations].map((o) => o.cadence),
    );
    /* Not everything is weekly with a deadline — forcing one rhythm onto all
       of them is the thing the brief warns against. */
    expect(cadences.size).toBeGreaterThan(1);
  });

  it("puts a problem before a deadline before work in hand", () => {
    const board = service.build(maria, TODAY);
    const ordered = needsAttention([...board.weekly.obligations, ...board.monthly.obligations]);
    const rank = { blocked: 0, warning: 1, in_progress: 2, not_started: 3, done: 4 };
    for (let i = 1; i < ordered.length; i += 1) {
      expect(rank[ordered[i]!.status]).toBeGreaterThanOrEqual(rank[ordered[i - 1]!.status]);
    }
  });

  it("leaves finished work out of what needs attention", () => {
    const board = service.build(maria, TODAY);
    const attention = needsAttention([...board.weekly.obligations, ...board.monthly.obligations]);
    expect(attention.some((o) => o.status === "done")).toBe(false);
  });
});

/**
 * "Done" must mean done.
 */
describe("it does not report a record as finished work", () => {
  it("calls a gathering with attendance and no report in progress, not done", () => {
    const lifegroup = createLifegroupRepository(db);
    const gathering = lifegroup
      .gatheringsInRange("2026-09-07", "2026-09-13")
      .find((g) => g.assignedLeaderIds.includes(maria.person.id));
    if (!gathering) return;

    const board = service.build(maria, TODAY);
    const obligation = board.weekly.obligations.find((o) => o.id === `lifegroup-${gathering.id}`);
    expect(obligation).toBeDefined();

    const report = obligation!.steps.find((s) => s.id === "report")!;
    if (!report.done) {
      expect(obligation!.status).not.toBe("done");
    }
  });

  /** Follow-ups are worth doing and must never hold the report open. */
  it("marks follow-up entries optional so they cannot hold a gathering open", () => {
    const board = service.build(maria, TODAY);
    const gathering = board.weekly.obligations.find((o) => o.id.startsWith("lifegroup-"));
    if (!gathering) return;

    const followUp = gathering.steps.find((s) => s.id === "follow-up");
    expect(followUp?.required).toBe(false);
  });
});

/**
 * The dashboard must not become a way around a module's own gate.
 */
describe("it cannot widen access", () => {
  it("shows a leader only their own leadership report", () => {
    const board = service.build(joel, TODAY);
    const report = board.monthly.obligations.find((o) => o.id === "leadership-report");
    expect(report).toBeDefined();

    const reports = createLeadershipReportRepository(db);
    const mariasPrivate = reports.find("lr-a-private")!;
    /* Maria's private development notes are hers. Nothing about them — not the
       title, not the fact of them — may reach Joel through this page. */
    expect(JSON.stringify(board)).not.toContain(mariasPrivate.title);
    expect(JSON.stringify(board)).not.toContain(mariasPrivate.id);
  });

  it("does not put another leader's gathering in this leader's week", () => {
    const board = service.build(joel, TODAY);
    const lifegroup = createLifegroupRepository(db);
    for (const obligation of board.weekly.obligations) {
      if (!obligation.id.startsWith("lifegroup-")) continue;
      const gathering = lifegroup.findGathering(obligation.id.replace("lifegroup-", ""))!;
      expect(gathering.assignedLeaderIds).toContain(joel.person.id);
    }
  });
});
