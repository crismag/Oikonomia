import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { createWorkContentRepository } from "../repositories/work-content-repository";
import { createWorkRepository } from "../repositories/work-repository";
import { createJournalService } from "./journal-service";
import { createWorkService } from "./work-service";
import { createLeadershipReportService } from "./leadership-report-service";
import { resolveAccess } from "@/domain/access";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * The leadership journal.
 *
 * Everything here is about one boundary: **an entry is private, a summary is a
 * copy, and a derived report is not a door.** The tests are arranged so that
 * any change which opens that boundary fails one of them.
 */

let dir: string;
let db: Db;
let work: ReturnType<typeof createWorkRepository>;
let content: ReturnType<typeof createWorkContentRepository>;
let reports: ReturnType<typeof createLeadershipReportRepository>;
let journal: ReturnType<typeof createJournalService>;
let workService: ReturnType<typeof createWorkService>;
let reportService: ReturnType<typeof createLeadershipReportService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-journal-"));
  db = openDatabase(join(dir, "test.db"));
  work = createWorkRepository(db);
  content = createWorkContentRepository(db);
  reports = createLeadershipReportRepository(db);
  journal = createJournalService(work, content, reports);
  workService = createWorkService(work);
  reportService = createLeadershipReportService(reports);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const started = (title = "September reflections") => journal.create(maria, { title });

const wrote = (id: string, lines: string[]) =>
  journal.write(maria, {
    id,
    blocks: lines.map((html, i) => ({ id: `b${i + 1}`, type: "paragraph", html })),
  });

describe("writing an entry", () => {
  it("creates the record and the thing it records", () => {
    const entry = started();
    expect(entry.work.kind).toBe("development-record");
    expect(content.find(entry.work.id)).toBeDefined();
  });

  it("accepts one with no title yet", () => {
    expect(journal.create(maria, { title: "" }).work.subject).toBe("");
  });

  it("saves what it says", () => {
    const entry = started();
    wrote(entry.work.id, ["I found the rota harder than I expected."]);
    expect(content.find(entry.work.id)?.blocks[0]?.html).toBe(
      "I found the rota harder than I expected.",
    );
  });

  it("lets its owner rename and remove it", () => {
    const entry = started();
    expect(journal.rename(maria, { id: entry.work.id, title: "September" }).subject).toBe(
      "September",
    );
    journal.remove(maria, entry.work.id);
    expect(work.find(entry.work.id)).toBeUndefined();
    expect(content.find(entry.work.id)).toBeUndefined();
  });

  it("refuses a save against a version another tab has moved past", () => {
    const entry = started();
    const opened = content.find(entry.work.id)!.version;
    journal.write(maria, {
      id: entry.work.id,
      blocks: [{ id: "b1", type: "paragraph", html: "First" }],
      expectedVersion: opened,
    });
    expect(() =>
      journal.write(maria, {
        id: entry.work.id,
        blocks: [{ id: "b1", type: "paragraph", html: "Second" }],
        expectedVersion: opened,
      }),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
  });
});

/**
 * The rule the module exists for.
 */
describe("an entry is private — not private unless somebody senior asks", () => {
  it("is private from the first keystroke, with no step at which it is not", () => {
    const entry = started();
    expect(entry.work.policy.classification).toBe("pastoral-private");
    expect(entry.work.policy.ownerId).toBe(maria.person.id);
    expect(entry.work.policy.audience ?? []).toEqual([]);
    expect(entry.work.reviewerIds).toEqual([]);
  });

  it("is denied to every other leader by the audience resolver itself", () => {
    const entry = started();
    for (const other of [joel, bishop, admin]) {
      const decision = resolveAccess(other.persona, other.person, entry.work.policy);
      expect(decision.level, other.person.id).toBe("denied");
    }
  });

  /** Seniority does not open a journal. Neither does administration. */
  it("cannot be opened, written, renamed, removed or summarized by anyone else", () => {
    const entry = started();
    wrote(entry.work.id, ["Something I would not say out loud yet."]);

    for (const other of [joel, bishop, admin]) {
      const attempts = [
        () => journal.open(other, entry.work.id),
        () => journal.write(other, { id: entry.work.id, blocks: [] }),
        () => journal.rename(other, { id: entry.work.id, title: "theirs" }),
        () => journal.remove(other, entry.work.id),
        () => journal.summarize(other, { entryId: entry.work.id, blockIds: ["b1"] }),
      ];
      for (const attempt of attempts) {
        expect(attempt, other.person.id).toThrow(expect.objectContaining({ code: "not-found" }));
      }
    }
    expect(content.find(entry.work.id)?.blocks[0]?.html).toBe(
      "Something I would not say out loud yet.",
    );
  });

  /**
   * That somebody keeps a journal and what is in it are the same secret, so
   * withholding is not-found rather than forbidden.
   */
  it("does not appear in anyone else's journal", () => {
    started();
    for (const other of [joel, bishop, admin]) {
      expect(journal.list(other), other.person.id).toEqual([]);
    }
    expect(journal.list(maria)).toHaveLength(1);
  });

  /**
   * The review shell reads the same table. An entry must not become reachable
   * through it — that would be the boundary leaking sideways.
   */
  it("is not reachable through the work / review shell either", () => {
    const entry = started();
    for (const other of [joel, bishop, admin]) {
      expect(() => workService.get(other, entry.work.id), other.person.id).toThrow(
        expect.objectContaining({ code: "not-found" }),
      );
      expect(workService.list(other).work.map((w) => w.id)).not.toContain(entry.work.id);
      expect(workService.list(other, { scope: "development" }).work.map((w) => w.id)).not.toContain(
        entry.work.id,
      );
    }
  });
});

/**
 * A derived report is not a door.
 */
describe("selecting what belongs in a summary", () => {
  const withThreeLines = () => {
    const entry = started();
    wrote(entry.work.id, [
      "The rota went well.",
      "I am struggling with a volunteer conversation.",
      "I want coaching on difficult conversations.",
    ]);
    return entry.work.id;
  };

  it("produces a Leadership Report carrying only the chosen lines", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, {
      entryId: id,
      blockIds: ["b1", "b3"],
      title: "Q3 development summary",
    });

    expect(report.blocks?.map((b) => b.html)).toEqual([
      "The rota went well.",
      "I want coaching on difficult conversations.",
    ]);
  });

  /** The line they did not choose is the whole point. */
  it("does not carry a line that was not chosen", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, { entryId: id, blockIds: ["b1"] });
    expect(JSON.stringify(report)).not.toContain("struggling with a volunteer conversation");
  });

  /**
   * Copies, with fresh ids. Sharing an id would make the journal line and the
   * report line the same thing in two places.
   */
  it("copies the lines rather than referencing them", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, { entryId: id, blockIds: ["b1"] });

    expect(report.blocks?.[0]?.id).not.toBe("b1");

    /* Editing the journal afterwards does not rewrite the submitted summary. */
    wrote(id, ["Rewritten.", "x", "y"]);
    expect(reports.find(report.id)?.blocks?.[0]?.html).toBe("The rota went well.");
  });

  it("leaves nothing on the report pointing back into the journal", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, { entryId: id, blockIds: ["b1"] });

    expect(report.links).toEqual([]);
    expect(report.relatedDocumentIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(id);
  });

  /**
   * Choosing what to say and choosing who hears it are two decisions.
   * Collapsing them is how private reflection ends up in front of somebody by
   * accident.
   */
  it("starts the report private, so sharing is still a second act", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, { entryId: id, blockIds: ["b1"] });

    expect(report.visibility).toBe("private");
    expect(report.status).toBe("draft");
    for (const other of [joel, bishop, admin]) {
      expect(reportService.list(other).reports.map((r) => r.id)).not.toContain(report.id);
    }
  });

  it("removing the entry afterwards does not empty the summary", () => {
    const id = withThreeLines();
    const report = journal.summarize(maria, { entryId: id, blockIds: ["b1"] });
    journal.remove(maria, id);

    expect(reports.find(report.id)?.blocks?.[0]?.html).toBe("The rota went well.");
  });

  it("records on the entry what was taken from it", () => {
    const id = withThreeLines();
    journal.summarize(maria, { entryId: id, blockIds: ["b1", "b2"] });
    expect(work.find(id)?.activity.map((a) => a.summary)).toContain("took 2 lines into a summary");
  });

  it("refuses a summary of nothing", () => {
    const id = withThreeLines();
    expect(() => journal.summarize(maria, { entryId: id, blockIds: [] })).toThrow(ApiError);
  });

  it("refuses lines that are not in the entry", () => {
    const id = withThreeLines();
    expect(() => journal.summarize(maria, { entryId: id, blockIds: ["nope"] })).toThrow(
      expect.objectContaining({ code: "validation" }),
    );
  });
});
