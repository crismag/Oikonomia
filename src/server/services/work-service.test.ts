import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { seedWork } from "@/test/seeds";
import { createWorkRepository } from "../repositories/work-repository";
import { createWorkService } from "./work-service";
import { resolveAccess } from "@/domain/access";
import { workContexts } from "@/test/fixtures";
import { viewerFor } from "@/test/viewer";
import { viewerOf } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * The work / review context.
 *
 * Three things carry this module:
 *
 * - **Four outcomes, not a boolean.** `metadata` is a real surface and must not
 *   behave like `denied`.
 * - **Redaction happens on the server.** A `limited` viewer must not receive the
 *   text of a section they may not read — hiding it while rendering leaves it
 *   in the browser.
 * - **The owner submits; the reviewers decide.** Being able to read a record is
 *   not authority over its state.
 */

let dir: string;
let db: Db;
let repo: ReturnType<typeof createWorkRepository>;
let service: ReturnType<typeof createWorkService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");

/* Maria's development report: she owns it, the bishop reviews it, and its
   pastoral section is stricter than the report itself. */
const REPORT = "w-lead-dev-report";
const PASTORAL = "Pastoral notes";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-work-"));
  db = openDatabase(join(dir, "test.db"));
  seedWork(db);
  repo = createWorkRepository(db);
  service = createWorkService(repo);

  /*
   * The development report is one of the few records a process really does
   * review — an assessment of a leader, read and answered by the bishop. It is
   * turned on here because it is no longer inherited: an ordinary report is
   * information, and the block below asserts that.
   */
  db.prepare("UPDATE work_context SET review_required = 1 WHERE id = ?").run(REPORT);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what the fixtures shipped survives the round trip", () => {
  it("keeps every record, with its policy", () => {
    expect(repo.allUnguarded()).toHaveLength(workContexts.length);
    expect(repo.find(REPORT)?.policy.classification).toBe("leadership-confidential");
  });

  it("keeps its conversation, its decisions and its history", () => {
    const source = workContexts.find((w) => w.decisions.length > 0 && w.comments.length > 0)!;
    const stored = repo.find(source.id)!;
    expect(stored.decisions).toHaveLength(source.decisions.length);
    expect(stored.comments).toHaveLength(source.comments.length);
    expect(stored.activity).toHaveLength(source.activity.length);
  });

  it("keeps a system comment marked as one", () => {
    const source = workContexts.find((w) => w.comments.some((c) => c.system));
    if (!source) return;
    expect(repo.find(source.id)?.comments.some((c) => c.system)).toBe(true);
  });
});

/**
 * The distinction the whole access model turns on.
 */
describe("four outcomes, not a boolean", () => {
  it("agrees with the resolver for every viewer and every record", () => {
    for (const viewer of [maria, joel, bishop, admin]) {
      for (const work of repo.allUnguarded()) {
        const level = resolveAccess(viewer.persona, viewer.person, work.policy).level;
        if (level === "denied") {
          expect(() => service.get(viewer, work.id), `${work.id}/${viewer.person.id}`).toThrow(
            expect.objectContaining({ code: "not-found" }),
          );
        } else {
          expect(service.get(viewer, work.id).level, `${work.id}/${viewer.person.id}`).toBe(level);
        }
      }
    }
  });

  /** Denied is nothing at all, and it is not-found rather than forbidden. */
  it("answers not-found for a record closed to the viewer", () => {
    const closed = repo
      .allUnguarded()
      .find((w) => resolveAccess(admin.persona, admin.person, w.policy).level === "denied");
    expect(closed).toBeDefined();
    expect(() => service.get(admin, closed!.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  /**
   * Metadata is not a refusal. It says "this exists and is routed to you, and
   * you may not read it" — so it returns routing information and no content.
   */
  it("returns routing information only for a metadata decision", () => {
    const item = repo
      .allUnguarded()
      .map((w) => ({ w, level: resolveAccess(joel.persona, joel.person, w.policy).level }))
      .find(({ level }) => level === "metadata");
    if (!item) return;

    const seen = service.get(joel, item.w.id);
    expect(seen.level).toBe("metadata");
    if (seen.level !== "metadata") return;

    expect(seen.metadata.contextLabel).toBe(item.w.contextLabel);
    /* The subject, the body and the conversation are the content. None of it
       may travel with a metadata decision. */
    expect(JSON.stringify(seen)).not.toContain(item.w.subject);
    expect(Object.keys(seen.metadata).sort()).toEqual(
      ["classification", "contextLabel", "id", "kind", "lastActivity", "ownerId"].filter((k) =>
        k === "lastActivity" ? "lastActivity" in seen.metadata : true,
      ),
    );
  });

  /** The library is for reading records, so one that cannot be opened is not
      listed — and is counted instead. */
  it("counts what it does not list", () => {
    const { work, withheld } = service.list(admin, "report");
    const all = repo.allUnguarded("report");
    expect(work.length + withheld).toBe(all.length);
  });
});

/**
 * The strongest claim this slice makes.
 */
describe("a section a viewer may not read never reaches them", () => {
  it("sends the owner the whole report", () => {
    const seen = service.get(maria, REPORT);
    expect(seen.level).toBe("full");
    if (seen.level === "metadata") return;
    expect(seen.work.sections?.map((s) => s.title)).toContain(PASTORAL);
  });

  it("removes the stricter section for a reviewer, rather than hiding it", () => {
    const seen = service.get(bishop, REPORT);
    expect(seen.level).toBe("limited");
    if (seen.level === "metadata") return;

    expect(seen.decision.restrictedSections).toContain(PASTORAL);
    expect(seen.work.sections?.map((s) => s.title)).not.toContain(PASTORAL);

    /* The point: not merely absent from a list of titles — its text is not in
       the response at all. */
    const body = workContexts
      .find((w) => w.id === REPORT)!
      .sections!.find((s) => s.title === PASTORAL)!.body;
    expect(JSON.stringify(seen)).not.toContain(body);
  });

  it("leaves the other sections alone", () => {
    const seen = service.get(bishop, REPORT);
    if (seen.level === "metadata") return;
    expect(seen.work.sections?.map((s) => s.title)).toContain("Ministry summary");
  });

  it("redacts in the list as well as on the record", () => {
    const listed = service.list(bishop, "report").work.find((w) => w.id === REPORT);
    expect(listed).toBeDefined();
    expect(listed!.sections?.map((s) => s.title)).not.toContain(PASTORAL);
  });
});

/**
 * Being able to read a record is not authority over its state.
 */
describe("review is a process, not what happens to everything", () => {
  /*
   * The failure this guards against: forty leaders report weekly, forty
   * reviews appear, and leadership's job becomes processing a queue of
   * information nobody asked them to process.
   */
  const ORDINARY = "w-sws-rota";

  it("publishes an ordinary record instead of sending it to be reviewed", () => {
    db.prepare("UPDATE work_context SET status = 'draft' WHERE id = ?").run(ORDINARY);
    /* Whoever owns that record; submitting is theirs and nobody else's. */
    const owner = viewerOf({
      ...maria.person,
      id: repo.find(ORDINARY)!.ownerId,
      accessRole: "leader",
    });
    const published = service.transition(owner, { id: ORDINARY, action: "submit" });

    expect(published.status).toBe("submitted");
    expect(published.currentState).toContain("read it");
    expect(published.currentState).not.toMatch(/review|picked up/i);
  });

  it("refuses every review step on a record no process reviews", () => {
    for (const action of ["start-review", "request-changes", "acknowledge"] as const) {
      expect(() => service.transition(bishop, { id: ORDINARY, action, note: "Anything" })).toThrow(
        expect.objectContaining({ code: "conflict" }),
      );
    }
  });

  it("still reviews what a process says to review", () => {
    expect(service.transition(bishop, { id: REPORT, action: "start-review" }).status).toBe(
      "in-review",
    );
  });
});

describe("the owner submits, the reviewers decide", () => {
  it("lets the reviewer take it into review", () => {
    const moved = service.transition(bishop, { id: REPORT, action: "start-review" });
    expect(moved.status).toBe("in-review");
  });

  it("does not let the author take their own report into review", () => {
    expect(() => service.transition(maria, { id: REPORT, action: "start-review" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find(REPORT)?.status).toBe("submitted");
  });

  it("does not let the author acknowledge their own report", () => {
    expect(() => service.transition(maria, { id: REPORT, action: "acknowledge" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("does not let someone who cannot read it move it at all", () => {
    expect(() => service.transition(admin, { id: REPORT, action: "acknowledge" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  /**
   * "Changes requested" without saying what sends a leader back to reread the
   * whole thread, which is the thing this shell exists to prevent.
   */
  it("refuses to request changes without saying what needs changing", () => {
    expect(() => service.transition(bishop, { id: REPORT, action: "request-changes" })).toThrow(
      expect.objectContaining({ code: "validation" }),
    );
    expect(repo.find(REPORT)?.status).toBe("submitted");
  });

  it("puts the reviewer's words where the state is read, and in the thread", () => {
    const moved = service.transition(bishop, {
      id: REPORT,
      action: "request-changes",
      note: "Please add the Q2 carry-over.",
    });
    expect(moved.status).toBe("changes-requested");
    expect(moved.currentState).toBe("Please add the Q2 carry-over.");
    expect(moved.comments.at(-1)?.body).toBe("Please add the Q2 carry-over.");
  });

  it("lets the author submit again once changes were asked for", () => {
    service.transition(bishop, { id: REPORT, action: "request-changes", note: "More detail." });
    expect(service.transition(maria, { id: REPORT, action: "submit" }).status).toBe("submitted");
  });

  it("refuses a transition that does not follow from where it stands", () => {
    service.transition(bishop, { id: REPORT, action: "acknowledge" });
    expect(() => service.transition(bishop, { id: REPORT, action: "start-review" })).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  /**
   * Resolving your own submission would be closing it without the review you
   * asked for.
   */
  it("does not let the author resolve their own report while it is under review", () => {
    expect(() => service.transition(maria, { id: REPORT, action: "resolve" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find(REPORT)?.status).toBe("submitted");
  });

  it("lets whoever opened a concern resolve it, because it was sent to nobody", () => {
    const open = repo.allUnguarded().find((w) => w.status === "open" && w.reviewerIds.length === 0);
    if (!open) return;
    const owner = [maria, joel, bishop, admin].find((v) => v.person.id === open.ownerId);
    if (!owner) return;

    expect(service.transition(owner, { id: open.id, action: "resolve" }).status).toBe("resolved");
  });

  it("records every move in the history", () => {
    const before = repo.find(REPORT)!.activity.length;
    service.transition(bishop, { id: REPORT, action: "start-review" });
    expect(repo.find(REPORT)!.activity.length).toBe(before + 1);
  });
});

/**
 * The outcome belongs above the conversation, not inside it.
 */
describe("decisions", () => {
  it("records one, attributed", () => {
    const decision = service.recordDecision(bishop, {
      workId: REPORT,
      summary: "Carry the two growth areas into Q4.",
    });
    expect(decision.decidedById).toBe(bishop.person.id);
    expect(decision.state).toBe("recorded");
  });

  it("does not let a reader who is not a reviewer decide", () => {
    expect(() => service.recordDecision(maria, { workId: REPORT, summary: "Approved." })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  /** A requested decision becomes the recorded one rather than sitting beside it. */
  it("answers a request rather than adding a second card", () => {
    const asked = service.requestDecision(maria, {
      workId: REPORT,
      summary: "Should the pastoral section go to the campus leaders?",
    });
    expect(asked.state).toBe("requested");

    const before = repo.find(REPORT)!.decisions.length;
    service.recordDecision(bishop, {
      workId: REPORT,
      decisionId: asked.id,
      summary: "No — it stays with the named audience.",
    });

    const after = repo.find(REPORT)!.decisions;
    expect(after).toHaveLength(before);
    const answered = after.find((d) => d.id === asked.id)!;
    expect(answered.state).toBe("recorded");
    expect(answered.summary).toBe("No — it stays with the named audience.");
    expect(answered.decidedById).toBe(bishop.person.id);
  });
});

/**
 * A page about one kind of work needs its count to be of that kind.
 */
describe("scoping", () => {
  it("returns only development material, and counts only what it withheld of it", () => {
    const scoped = service.list(maria, { scope: "development" });
    const everything = service.list(maria);

    expect(scoped.work.length).toBeLessThan(everything.work.length);
    for (const work of scoped.work) {
      const development =
        work.kind === "development-record" ||
        work.contextLabel.startsWith("Leadership Development") ||
        work.policy.classification === "pastoral-private";
      expect(development, work.id).toBe(true);
    }
  });

  /*
   * The count has to be of the same set the list is of. A page that filtered
   * rows itself would say "3 development records are held by other leaders"
   * while counting every withheld record in the binder.
   */
  it("does not count withheld records from outside the scope", () => {
    const scoped = service.list(admin, { scope: "development" });
    const everything = service.list(admin);
    expect(scoped.withheld).toBeLessThan(everything.withheld);
  });
});

describe("discussion", () => {
  it("lets someone who may read it comment", () => {
    const comment = service.comment(bishop, { workId: REPORT, body: "Reading this today." });
    expect(comment.authorId).toBe(bishop.person.id);
  });

  it("refuses an empty comment", () => {
    expect(() => service.comment(bishop, { workId: REPORT, body: "  " })).toThrow(ApiError);
  });

  /** Commenting on something you may not read would disclose that you saw it. */
  it("refuses one from someone who may not read the record", () => {
    expect(() => service.comment(admin, { workId: REPORT, body: "hello" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});
