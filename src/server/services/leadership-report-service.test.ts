import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { seedReports } from "@/test/seeds";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { createLeadershipReportService } from "./leadership-report-service";
import { canDiscover } from "@/domain/leadership-report";
import { leadershipReports } from "@/test/fixtures";
import { viewerFor } from "@/test/viewer";
import { applyOverrides, resetOverrides } from "@/config";
import type { Database as Db } from "better-sqlite3";

/**
 * Leadership Reports.
 *
 * The most guarded records in the binder, and the two things worth testing
 * hardest are the two that would do real harm if wrong:
 *
 * - **Withholding**, including that a withheld report is *not found* rather
 *   than forbidden — "you may not see this" still says a report about somebody
 *   exists.
 * - **Capabilities**, because the prototype gated discovery and nothing else.
 *   A subject reading an evaluation about themselves could have published it,
 *   rewritten it or changed its audience; the only thing stopping them was that
 *   no button was drawn.
 */

let dir: string;
let db: Db;
let repo: ReturnType<typeof createLeadershipReportRepository>;
let service: ReturnType<typeof createLeadershipReportService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-reports-"));
  db = openDatabase(join(dir, "test.db"));
  seedReports(db);
  repo = createLeadershipReportRepository(db);
  service = createLeadershipReportService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ids = (viewer: typeof maria) => service.list(viewer).reports.map((r) => r.id);

describe("what the fixtures shipped survives the round trip", () => {
  it("keeps every report", () => {
    expect(repo.allUnguarded()).toHaveLength(leadershipReports.length);
  });

  it("keeps what a report says, who it is about, and who may read it", () => {
    const evaluation = repo.find("lr-d-evaluation")!;
    expect(evaluation.subjectId).toBe("p-maria");
    expect(evaluation.visibility).toBe("restricted");
    expect(evaluation.blocks?.[0]?.html).toBe("Strengths");
  });

  it("keeps its comments, its activity and what it said before publication", () => {
    const source = leadershipReports.find((r) => r.revisions.length > 0);
    if (!source) return;
    const stored = repo.find(source.id)!;
    expect(stored.revisions).toHaveLength(source.revisions.length);
    expect(stored.comments).toHaveLength(source.comments.length);
    expect(stored.activity).toHaveLength(source.activity.length);
  });
});

/**
 * Boundary one.
 */
describe("withholding", () => {
  it("agrees with the rule stated in the domain, for every viewer", () => {
    for (const viewer of [maria, joel, bishop, admin]) {
      const byService = ids(viewer);
      const byDomain = repo
        .allUnguarded()
        .filter((r) => canDiscover(r, viewer.persona, viewer.person))
        .map((r) => r.id);
      expect(byService, viewer.person.id).toEqual(byDomain);
    }
  });

  /** Maria's private development notes are hers alone. */
  it("keeps a private report to its author", () => {
    expect(ids(maria)).toContain("lr-a-private");
    for (const other of [joel, bishop, admin]) {
      expect(ids(other), other.person.id).not.toContain("lr-a-private");
    }
  });

  it("shows a restricted report to the leader it names and nobody else", () => {
    expect(ids(joel)).toContain("lr-b-supervisory");
    expect(ids(bishop)).not.toContain("lr-b-supervisory");
  });

  /** An administrator manages structure, not confidential content. */
  it("gives an administrator no reports at all", () => {
    expect(ids(admin)).toEqual([]);
  });

  /**
   * A deep link must not reveal what a list would not, and "you may not see
   * this" still says that a report about somebody exists.
   */
  it("is not-found rather than forbidden", () => {
    expect(() => service.get(bishop, "lr-a-private")).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("says how many were withheld without saying which", () => {
    const { reports, withheld } = service.list(bishop);
    expect(withheld).toBe(repo.allUnguarded().length - reports.length);
    expect(withheld).toBeGreaterThan(0);
  });

  it("refuses every write to a report the viewer cannot discover", () => {
    const blocked = [
      () => service.update(bishop, "lr-a-private", { title: "x" }),
      () => service.write(bishop, { id: "lr-a-private", blocks: [] }),
      () => service.transition(bishop, { id: "lr-a-private", to: "published" }),
      () => service.comment(bishop, { reportId: "lr-a-private", body: "hello" }),
      () => service.remove(bishop, "lr-a-private"),
    ];
    for (const attempt of blocked) {
      expect(attempt).toThrow(expect.objectContaining({ code: "not-found" }));
    }
    expect(repo.find("lr-a-private")?.title).toBe("Leadership Development — September");
  });
});

/**
 * Boundary two — and the whole of what the prototype did not do.
 */
describe("reading a report about yourself is not authority over it", () => {
  /* Joel's Q3 evaluation of Maria: published, and she is its subject. */
  const evaluation = "lr-d-evaluation";

  it("lets the subject read it", () => {
    expect(ids(maria)).toContain(evaluation);
  });

  it("does not let the subject rewrite it", () => {
    expect(() => service.write(maria, { id: evaluation, blocks: [] })).toThrow(ApiError);
    expect(repo.find(evaluation)?.blocks?.[0]?.html).toBe("Strengths");
  });

  /**
   * The case above is also refused by the publication freeze, so it does not
   * on its own prove that authorship is what matters. This one does: a report
   * still open for writing, and a reader who is not its author.
   */
  it("does not let a named reader rewrite a report that is still open", () => {
    /* Maria's, shared, and Joel is the leader it names. */
    const open = "lr-b-supervisory";
    expect(repo.find(open)?.status).toBe("shared");
    expect(ids(joel)).toContain(open);

    expect(() =>
      service.write(joel, {
        id: open,
        blocks: [{ id: "b1", type: "paragraph", html: "Joel's rewrite" }],
      }),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(repo.find(open)?.blocks?.[0]?.html).not.toBe("Joel's rewrite");
  });

  it("does not let a named reader retitle it either", () => {
    expect(() => service.update(joel, "lr-b-supervisory", { title: "Joel's title" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("does not let a named reader publish it", () => {
    expect(() => service.transition(joel, { id: "lr-b-supervisory", to: "published" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find("lr-b-supervisory")?.status).toBe("shared");
  });

  it("does not let the subject change who may read it", () => {
    expect(() =>
      service.update(maria, evaluation, { visibility: "shared", audienceIds: [] }),
    ).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(repo.find(evaluation)?.visibility).toBe("restricted");
  });

  it("does not let the subject archive or reopen it", () => {
    for (const to of ["archived", "shared"] as const) {
      expect(() => service.transition(maria, { id: evaluation, to })).toThrow(
        expect.objectContaining({ code: "forbidden" }),
      );
    }
    expect(repo.find(evaluation)?.status).toBe("published");
  });

  it("does not let the subject remove it", () => {
    expect(() => service.remove(maria, evaluation)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find(evaluation)).toBeDefined();
  });

  /** What the subject *may* do: say something about it. */
  it("lets the subject comment, because that is what the record is for", () => {
    const comment = service.comment(maria, {
      reportId: evaluation,
      body: "Thank you — I would value help with the rota.",
    });
    expect(comment.authorId).toBe(maria.person.id);
    expect(repo.find(evaluation)?.comments.map((c) => c.body)).toContain(
      "Thank you — I would value help with the rota.",
    );
  });
});

describe("writing a report", () => {
  const started = () => service.create(maria, { reportType: "leadership-development" });

  /** A report should never become visible because somebody forgot to narrow it. */
  it("starts private", () => {
    expect(started().visibility).toBe("private");
    expect(started().status).toBe("draft");
  });

  it("records who wrote it, and that they did", () => {
    const report = started();
    expect(report.authorId).toBe(maria.person.id);
    expect(report.activity.map((a) => a.summary)).toContain("created this report");
  });

  it("refuses one with no kind, because that is what shapes it", () => {
    expect(() => service.create(maria, { reportType: " " })).toThrow(ApiError);
  });

  it("saves what the report says", () => {
    const report = started();
    service.write(maria, {
      id: report.id,
      blocks: [{ id: "b1", type: "paragraph", html: "The rota held through September." }],
    });
    expect(repo.find(report.id)?.blocks?.[0]?.html).toBe("The rota held through September.");
  });

  it("lets its author remove a draft", () => {
    const report = started();
    service.remove(maria, report.id);
    expect(repo.find(report.id)).toBeUndefined();
  });
});

/**
 * A submitted report is a record of what was said at the time.
 */
describe("publication freezes the record", () => {
  const publish = () => {
    const report = service.create(maria, { reportType: "progress-report" });
    service.write(maria, {
      id: report.id,
      blocks: [{ id: "b1", type: "paragraph", html: "What I submitted." }],
    });
    return service.transition(maria, { id: report.id, to: "published" });
  };

  it("keeps what was submitted as a revision", () => {
    const published = publish();
    expect(published.revisions).toHaveLength(1);
    expect(published.revisions[0]?.blocks[0]?.html).toBe("What I submitted.");
  });

  it("refuses further writing until it is reopened", () => {
    const published = publish();
    expect(() =>
      service.write(maria, {
        id: published.id,
        blocks: [{ id: "b1", type: "paragraph", html: "Something else." }],
      }),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(repo.find(published.id)?.blocks?.[0]?.html).toBe("What I submitted.");
  });

  it("refuses removing it — archiving is how it stops being current", () => {
    const published = publish();
    expect(() => service.remove(maria, published.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  /** Reopening is not an erasure. */
  it("keeps the published revision when it is reopened", () => {
    const published = publish();
    const reopened = service.transition(maria, { id: published.id, to: "shared" });

    expect(reopened.status).toBe("shared");
    expect(reopened.publishedAt).toBeUndefined();
    expect(reopened.revisions).toHaveLength(1);
    expect(reopened.revisions[0]?.blocks[0]?.html).toBe("What I submitted.");
  });

  it("records each publication as its own revision", () => {
    const published = publish();
    service.transition(maria, { id: published.id, to: "shared" });
    service.write(maria, {
      id: published.id,
      blocks: [{ id: "b1", type: "paragraph", html: "The correction." }],
    });
    const again = service.transition(maria, { id: published.id, to: "published" });

    expect(again.revisions.map((r) => r.blocks[0]?.html)).toEqual([
      "What I submitted.",
      "The correction.",
    ]);
  });
});

/**
 * Not every report wants discussion, and being able to read one is not being
 * able to comment on it.
 */
describe("discussion", () => {
  it("refuses a comment when the report is closed to discussion", () => {
    /* Maria's private development notes have `discussionPolicy: "disabled"`. */
    expect(() => service.comment(maria, { reportId: "lr-a-private", body: "note" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("refuses an empty comment", () => {
    expect(() => service.comment(joel, { reportId: "lr-b-supervisory", body: "  " })).toThrow(
      ApiError,
    );
  });

  it("records that a comment happened in the report's activity", () => {
    service.comment(joel, { reportId: "lr-b-supervisory", body: "I can take the Thursday run." });
    expect(repo.find("lr-b-supervisory")?.activity.map((a) => a.kind)).toContain("comment");
  });
});

/**
 * Two people working one report.
 */
describe("two writers at once", () => {
  it("refuses a save against a version somebody else has moved past", () => {
    const report = service.create(maria, { reportType: "leadership-development" });
    const opened = repo.versionOf(report.id)!;

    service.write(maria, {
      id: report.id,
      blocks: [{ id: "b1", type: "paragraph", html: "First" }],
      expectedVersion: opened,
    });

    expect(() =>
      service.write(maria, {
        id: report.id,
        blocks: [{ id: "b1", type: "paragraph", html: "Second" }],
        expectedVersion: opened,
      }),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(repo.find(report.id)?.blocks?.[0]?.html).toBe("First");
  });
});

/**
 * Naming a person is not a label.
 *
 * `subject_id` does two things at once: it makes a report findable by that
 * person's name, and — in this module — it lets them read what was written
 * about them. On an evaluation both are the point. On a pastoral concern
 * written after a gathering, both are exactly backwards: the report would be
 * pulled into the person's record and opened by the person it concerns.
 *
 * So the structured subject exists only on the kinds of report the church
 * writes *about* somebody. Everywhere else, who a report concerns is a
 * sentence the leader wrote, not an index entry.
 */
describe("a structured subject is only for reports written about a person", () => {
  it("accepts one on an evaluation, which is what the field is for", () => {
    const report = service.create(maria, {
      reportType: "evaluation",
      subjectId: joel.person.id,
    });
    expect(report.subjectId).toBe(joel.person.id);
  });

  it("refuses one on a gathering report", () => {
    expect(() =>
      service.create(maria, { reportType: "Gathering report", subjectId: joel.person.id }),
    ).toThrow(ApiError);
  });

  it("refuses one added afterwards by an edit", () => {
    const report = service.create(maria, { reportType: "Gathering report" });
    expect(() => service.update(maria, report.id, { subjectId: joel.person.id })).toThrow(ApiError);
  });

  it("refuses one smuggled in by changing the type in the same patch", () => {
    const report = service.create(maria, { reportType: "Gathering report" });
    expect(() =>
      service.update(maria, report.id, {
        reportType: "Gathering report",
        subjectId: joel.person.id,
      }),
    ).toThrow(ApiError);
  });

  it("keeps a report about nobody out of anybody's reach", () => {
    /* The check that matters: with no subject there is no second reader, and
       nothing for a search by name to match. */
    const report = service.create(maria, {
      reportType: "Gathering report",
      visibility: "restricted",
    });
    expect(report.subjectId).toBeUndefined();
    expect(() => service.get(joel, report.id)).toThrow(ApiError);
  });
});

/**
 * A configured audience choice works end to end, or it is not configuration.
 *
 * The acceptance standard: an administrator adds a choice, a leader uses it,
 * the record stores it, the service enforces it — and no source file changed.
 * The name is one nothing could have been written against.
 */
describe("an audience choice an administrator added", () => {
  const ADDED = "pastoral-team-91827";

  beforeEach(() => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: ADDED,
        isAddition: true,
        value: { label: "Pastoral Team 91827", active: true, accessStrategy: "named-people" },
      } as never,
    ]);
  });

  afterEach(() => resetOverrides());

  it("is accepted by validation, stored, and read back", () => {
    const report = service.create(maria, { reportType: "pastoral", visibility: ADDED });
    expect(report.visibility).toBe(ADDED);

    const reloaded = service.get(maria, report.id);
    expect(reloaded.visibility).toBe(ADDED);
  });

  it("is enforced by the strategy it names, and by nothing else", () => {
    const report = service.create(maria, {
      reportType: "pastoral",
      visibility: ADDED,
      audienceIds: [joel.person.id],
    });
    service.transition(maria, { id: report.id, to: "published" });

    /* Named on it: may read. */
    expect(service.get(joel, report.id).id).toBe(report.id);
    /* Not named on it — and seniority does not help, because `named-people`
       is pastoral-private. */
    expect(() => service.get(bishop, report.id)).toThrow(ApiError);
    expect(() => service.get(admin, report.id)).toThrow(ApiError);
  });

  it("is refused once the administrator deactivates it", () => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: ADDED,
        isAddition: true,
        value: { label: "Pastoral Team 91827", active: false, accessStrategy: "named-people" },
      } as never,
    ]);

    expect(() => service.create(maria, { reportType: "pastoral", visibility: ADDED })).toThrow(
      ApiError,
    );
  });

  it("keeps enforcing records already filed under it after it is deactivated", () => {
    const report = service.create(maria, {
      reportType: "pastoral",
      visibility: ADDED,
      audienceIds: [joel.person.id],
    });

    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: ADDED,
        isAddition: true,
        value: { label: "Pastoral Team 91827", active: false, accessStrategy: "named-people" },
      } as never,
    ]);

    /* History stays readable and stays enforced — deactivation stops new use,
       it does not rewrite what already exists. */
    expect(service.get(joel, report.id).id).toBe(report.id);
    expect(() => service.get(bishop, report.id)).toThrow(ApiError);
  });

  it("refuses a visibility nobody has configured at all", () => {
    expect(() =>
      service.create(maria, { reportType: "pastoral", visibility: "invented-91827" }),
    ).toThrow(ApiError);
  });
});

/**
 * A stage an administrator added works end to end, or it is not configuration.
 *
 * The same acceptance standard as the audience choice above, applied to the
 * thing that used to be hardest: the four named actions were the workflow, so
 * a fifth stage was unreachable by construction. The name is one nothing could
 * have been written against.
 */
describe("a report stage an administrator added", () => {
  const ADDED = "with-the-elders-55031";

  beforeEach(() => {
    applyOverrides([
      {
        namespace: "reports.statuses",
        optionId: ADDED,
        isAddition: true,
        value: {
          label: "With The Elders 55031",
          active: true,
          semanticState: "info",
          terminal: false,
          behaviors: { editable: false, final: true, current: true, visibleToAudience: true },
        },
      } as never,
    ]);
  });

  afterEach(() => resetOverrides());

  it("can be moved to, and the record stores it", () => {
    const report = service.create(maria, { reportType: "pastoral", visibility: "leadership" });
    const moved = service.transition(maria, { id: report.id, to: ADDED });

    expect(moved.status).toBe(ADDED);
    expect(repo.find(report.id)?.status).toBe(ADDED);
  });

  /* The behaviours are what act, not the name: this stage freezes content, so
     it takes a snapshot and stamps the moment, exactly as publishing does. */
  it("freezes the content because its behaviour says so, not because of its name", () => {
    const report = service.create(maria, { reportType: "pastoral", visibility: "leadership" });
    service.transition(maria, { id: report.id, to: ADDED });

    const stored = repo.find(report.id)!;
    expect(stored.revisions).toHaveLength(1);
    expect(stored.publishedAt).toBeTruthy();
    expect(() => service.write(maria, { id: report.id, blocks: [] })).toThrow(ApiError);
  });

  it("is reopened by moving back to a stage that is still editable", () => {
    const report = service.create(maria, { reportType: "pastoral", visibility: "leadership" });
    service.transition(maria, { id: report.id, to: ADDED });
    const reopened = service.transition(maria, { id: report.id, to: "shared" });

    expect(reopened.publishedAt).toBeUndefined();
    /* Reopening is not an erasure. */
    expect(repo.find(report.id)?.revisions).toHaveLength(1);
  });

  it("is refused to somebody who only reads the report", () => {
    const report = service.create(maria, {
      reportType: "pastoral",
      visibility: "restricted",
      audienceIds: [joel.person.id],
    });

    expect(() => service.transition(joel, { id: report.id, to: ADDED })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.find(report.id)?.status).not.toBe(ADDED);
  });

  it("is refused a stage this church does not offer", () => {
    const report = service.create(maria, { reportType: "pastoral", visibility: "leadership" });
    expect(() => service.transition(maria, { id: report.id, to: "invented-99999" })).toThrow(
      ApiError,
    );
  });
});

/**
 * A report is confidential because its author marked it. That changes handling,
 * not access: anyone else who may read it gets it without content in lists and
 * replies, and opening it is recorded — who and which report, never its words.
 */
describe("a report its author marked confidential", () => {
  let reads: { actorId: string; reportId: string }[];
  let audited: ReturnType<typeof createLeadershipReportService>;

  beforeEach(() => {
    reads = [];
    audited = createLeadershipReportService(repo, undefined, {
      record: (actorId, reportId) => reads.push({ actorId, reportId }),
      of: (reportId) =>
        reads
          .filter((read) => read.reportId === reportId)
          .map((read) => ({ actorId: read.actorId, at: "2026-09-16T10:00:00Z" })),
    });
  });

  const confidentialFor = (readerId: string) => {
    const created = audited.create(maria, {
      reportType: "pastoral",
      visibility: "restricted",
      audienceIds: [readerId],
      confidential: true,
    });
    audited.write(maria, {
      id: created.id,
      blocks: [{ id: "b1", type: "paragraph", html: "The family asked for discretion." }],
    });
    return repo.find(created.id)!;
  };

  it("is marked only when its author says so", () => {
    const plain = audited.create(maria, { reportType: "pastoral", visibility: "restricted" });
    expect(repo.find(plain.id)?.confidential).toBeUndefined();
    expect(confidentialFor(joel.person.id).confidential).toBe(true);
  });

  it("reaches another reader without its content, and its author with it", () => {
    const report = confidentialFor(joel.person.id);
    const forJoel = audited.forBrowser(joel, report);
    expect(forJoel.contentWithheld).toBe(true);
    expect(JSON.stringify(forJoel)).not.toContain("discretion");
    expect(audited.forBrowser(maria, report).blocks?.[0]?.html).toContain("discretion");
  });

  it("records another reader opening it, but not its author", () => {
    const report = confidentialFor(joel.person.id);
    expect(audited.get(joel, report.id).blocks?.[0]?.html).toContain("discretion");
    audited.get(maria, report.id);
    expect(reads).toEqual([{ actorId: joel.person.id, reportId: report.id }]);
  });

  it("records nothing for a report that is not marked", () => {
    const plain = audited.create(maria, {
      reportType: "pastoral",
      visibility: "restricted",
      audienceIds: [joel.person.id],
    });
    audited.get(joel, plain.id);
    expect(reads).toEqual([]);
  });

  it("shows who opened it to its author, and to nobody else", () => {
    const report = confidentialFor(joel.person.id);
    audited.get(joel, report.id);
    expect(audited.confidentialReads(maria, report.id).map((r) => r.actorId)).toEqual([
      joel.person.id,
    ]);
    expect(() => audited.confidentialReads(joel, report.id)).toThrow(ApiError);
  });

  it("can be marked or unmarked only by its author", () => {
    const report = confidentialFor(joel.person.id);
    expect(() => audited.update(joel, report.id, { confidential: false })).toThrow(ApiError);
    expect(audited.update(maria, report.id, { confidential: false }).confidential).toBeUndefined();
  });
});
