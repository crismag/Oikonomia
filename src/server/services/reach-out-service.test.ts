import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createReachOutRepository } from "../repositories/reach-out-repository";
import { createReachOutService } from "./reach-out-service";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Reach-Out persistence and rules.
 *
 * The rule worth testing here is the one the module is built around:
 * **authorship is not ownership.** Any leader may continue any report, doing so
 * records them as a contributor, and none of that lets them delete somebody
 * else's account of what happened.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createReachOutService>;
let repo: ReturnType<typeof createReachOutRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-reachout-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createReachOutRepository(db);
  service = createReachOutService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const report = (over: Record<string, unknown> = {}) => ({
  title: "Weekly reach-out",
  reportDate: "2026-09-10",
  content: "Visited two families after the service.",
  ...over,
});

describe("writing a report", () => {
  it("persists it and gives it an id", () => {
    const created = service.createReport(maria, report());
    expect(created.id).toMatch(/^ro-/);
    expect(repo.find(created.id)?.content).toBe("Visited two families after the service.");
  });

  it("records who wrote it first", () => {
    expect(service.createReport(maria, report()).authorId).toBe(maria.person.id);
  });

  /** "Weekly reach-out" is a perfectly good title, and so is none yet. */
  it("accepts a report with no title and no content", () => {
    const created = service.createReport(maria, { reportDate: "2026-09-10" });
    expect(created.title).toBe("");
    expect(created.content).toBe("");
  });

  it("refuses one with no date, because the date is what it is about", () => {
    expect(() => service.createReport(maria, { title: "Something" })).toThrow(ApiError);
  });

  it("keeps the date it is about apart from when it was written", () => {
    const created = service.createReport(maria, report({ reportDate: "2026-08-01" }));
    expect(created.reportDate).toBe("2026-08-01");
    expect(created.createdAt).not.toBe("2026-08-01");
  });
});

/**
 * The rule the module is built around.
 */
describe("authorship is not ownership", () => {
  it("lets another leader continue a report", () => {
    const created = service.createReport(maria, report());
    const continued = service.updateReport(joel, created.id, {
      content: "Visited two families. Lita asked about the camp.",
    });
    expect(continued.content).toContain("Lita asked about the camp");
  });

  it("records the other leader as a contributor", () => {
    const created = service.createReport(maria, report());
    const continued = service.updateReport(joel, created.id, { content: "More" });
    expect(continued.contributorIds).toEqual([joel.person.id]);
  });

  it("does not add the first author to the contributors", () => {
    const created = service.createReport(maria, report());
    const own = service.updateReport(maria, created.id, { content: "More" });
    expect(own.contributorIds ?? []).not.toContain(maria.person.id);
  });

  it("records each contributor once, oldest first", () => {
    const created = service.createReport(maria, report());
    service.updateReport(joel, created.id, { content: "a" });
    service.updateReport(bishop, created.id, { content: "b" });
    const again = service.updateReport(joel, created.id, { content: "c" });

    expect(again.contributorIds).toEqual([joel.person.id, bishop.person.id]);
  });

  /** Provenance, never a gate: the contributors list says who, not who may. */
  it("names everyone who worked on it, the first author first", () => {
    const created = service.createReport(maria, report());
    service.updateReport(joel, created.id, { content: "a" });

    expect(service.contributors(repo.find(created.id)!)).toEqual([maria.person.id, joel.person.id]);
  });

  /**
   * Shared work means anyone may add to a report. It does not mean anyone may
   * delete somebody else's account of what happened.
   */
  it("does not let another leader delete it", () => {
    const created = service.createReport(maria, report());
    expect(() => service.deleteReport(joel, created.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find(created.id)).toBeDefined();
  });

  it("lets the first author delete it", () => {
    const created = service.createReport(maria, report());
    service.deleteReport(maria, created.id);
    expect(repo.find(created.id)).toBeUndefined();
  });
});

describe("listing", () => {
  it("returns newest first, by the date the report is about", () => {
    service.createReport(maria, report({ title: "Older", reportDate: "2026-08-01" }));
    service.createReport(maria, report({ title: "Newer", reportDate: "2026-09-01" }));

    expect(service.list(maria, {}).reports.map((r) => r.title)).toEqual(["Newer", "Older"]);
  });

  it("pages in the database", () => {
    for (let i = 0; i < 30; i += 1) {
      service.createReport(maria, report({ title: `Report ${i}` }));
    }
    const first = service.list(maria, { page: 1, pageSize: 25 });
    expect(first.reports).toHaveLength(25);
    expect(first.page).toMatchObject({ pageCount: 2, total: 30 });
  });

  it("searches the title and what the report says", () => {
    service.createReport(maria, report({ title: "Camp follow-up", content: "Nothing" }));
    service.createReport(maria, report({ title: "Weekly", content: "Lita asked about baptism." }));

    expect(service.list(maria, { search: "camp" }).reports.map((r) => r.title)).toEqual([
      "Camp follow-up",
    ]);
    expect(service.list(maria, { search: "baptism" }).reports.map((r) => r.title)).toEqual([
      "Weekly",
    ]);
  });

  it("narrows to one person: what they wrote first and what they worked on since", () => {
    service.createReport(maria, report({ title: "Maria's" }));
    const joels = service.createReport(joel, report({ title: "Joel's, continued by Maria" }));
    service.updateReport(maria, joels.id, { content: "Followed up." });
    service.createReport(bishop, report({ title: "Bishop's" }));

    const titles = service.list(bishop, { personId: maria.person.id }).reports.map((r) => r.title);
    expect(titles.sort()).toEqual(["Joel's, continued by Maria", "Maria's"]);
    expect(service.list(bishop, { personId: maria.person.id }).page.total).toBe(2);
  });

  /**
   * Every leader sees every report, and that is a **stated absence of a rule**
   * rather than a decision — sharing for Reach-Out is an open product question.
   * This test exists so the day someone adds a filter, it fails and they have
   * to come and say what the rule now is.
   */
  it("shows every report to every leader, because no sharing rule exists yet", () => {
    service.createReport(maria, report({ title: "Maria's" }));
    service.createReport(joel, report({ title: "Joel's" }));

    for (const viewer of [maria, joel, bishop]) {
      expect(service.list(viewer, {}).reports).toHaveLength(2);
    }
  });
});

describe("comments", () => {
  it("attaches to the report and is attributed", () => {
    const created = service.createReport(maria, report());
    const comment = service.addComment(joel, {
      reportId: created.id,
      body: "I can call the family on Thursday.",
    });

    expect(comment.authorId).toBe(joel.person.id);
    expect(repo.find(created.id)?.comments.map((c) => c.body)).toEqual([
      "I can call the family on Thursday.",
    ]);
  });

  it("keeps them in the order they were written", () => {
    const created = service.createReport(maria, report());
    service.addComment(maria, { reportId: created.id, body: "First" });
    service.addComment(joel, { reportId: created.id, body: "Second" });

    expect(repo.find(created.id)?.comments.map((c) => c.body)).toEqual(["First", "Second"]);
  });

  it("refuses an empty comment", () => {
    const created = service.createReport(maria, report());
    expect(() => service.addComment(maria, { reportId: created.id, body: "  " })).toThrow(ApiError);
  });

  it("refuses one on a report that does not exist", () => {
    expect(() => service.addComment(maria, { reportId: "ro-nope", body: "Hello" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("lets only its author remove it", () => {
    const created = service.createReport(maria, report());
    const comment = service.addComment(joel, { reportId: created.id, body: "Mine" });

    expect(() => service.removeComment(maria, comment.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    service.removeComment(joel, comment.id);
    expect(repo.findComment(comment.id)).toBeUndefined();
  });

  /** The generic table has no foreign key, so the service has to clean up. */
  it("goes with the report when the report is deleted", () => {
    const created = service.createReport(maria, report());
    const comment = service.addComment(maria, { reportId: created.id, body: "Something" });

    service.deleteReport(maria, created.id);
    expect(repo.findComment(comment.id)).toBeUndefined();
  });

  it("does not attach one report's comments to another", () => {
    const a = service.createReport(maria, report({ title: "A" }));
    const b = service.createReport(maria, report({ title: "B" }));
    service.addComment(maria, { reportId: a.id, body: "About A" });

    expect(repo.find(b.id)?.comments).toEqual([]);
  });
});

/**
 * Two leaders writing one report at once.
 *
 * Unlike Goals or LifeGroup, this is not an edge case in Reach-Out — shared
 * work is the point of the module. The second saver is told what happened
 * rather than quietly erasing the first.
 */
describe("two leaders writing at once", () => {
  it("refuses a save against a version somebody else has moved past", () => {
    const created = service.createReport(maria, report());
    const opened = created.version ?? 1;

    service.updateReport(joel, created.id, { content: "Joel got there first." }, opened);

    expect(() =>
      service.updateReport(maria, created.id, { content: "Maria's version." }, opened),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
  });

  it("keeps what the first leader wrote", () => {
    const created = service.createReport(maria, report());
    const opened = created.version ?? 1;

    service.updateReport(joel, created.id, { content: "Joel got there first." }, opened);
    try {
      service.updateReport(maria, created.id, { content: "Maria's version." }, opened);
    } catch {
      /* expected */
    }

    expect(repo.find(created.id)?.content).toBe("Joel got there first.");
  });

  it("lets the second leader save once they have reopened it", () => {
    const created = service.createReport(maria, report());
    const opened = created.version ?? 1;

    const first = service.updateReport(joel, created.id, { content: "Joel's." }, opened);
    const second = service.updateReport(
      maria,
      created.id,
      { content: "Joel's. And Maria's." },
      first.version ?? 1,
    );

    expect(second.content).toBe("Joel's. And Maria's.");
  });

  it("moves the version on with every save", () => {
    const created = service.createReport(maria, report());
    expect(created.version).toBe(1);
    expect(service.updateReport(joel, created.id, { content: "a" }).version).toBe(2);
    expect(service.updateReport(joel, created.id, { content: "b" }).version).toBe(3);
  });

  /**
   * A caller that states no version is saving what it last read, so the
   * report's own version is used. This keeps the older callers working; it does
   * not make them safe, and the pages all pass a version.
   */
  it("falls back to the report's own version when the caller states none", () => {
    const created = service.createReport(maria, report());
    expect(service.updateReport(joel, created.id, { content: "a" }).content).toBe("a");
  });

  /** Gone and stale are different things to tell a leader. */
  it("says not-found rather than conflict when the report was deleted", () => {
    const created = service.createReport(maria, report());
    service.deleteReport(maria, created.id);

    expect(() => service.updateReport(joel, created.id, { content: "a" }, 1)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});
