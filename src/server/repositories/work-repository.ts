import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type {
  ActivityEntry,
  AudiencePolicy,
  Comment,
  Decision,
  WorkContext,
  WorkKind,
  WorkStatus,
} from "@/domain/types";

/**
 * Work / review rows.
 *
 * Reads, writes, and the row ⇄ domain translation. It authorizes nothing: the
 * audience policy travels with the row and `domain/access.ts` resolves it,
 * because that resolver returns four outcomes — full, limited, metadata and
 * denied — and a SQL predicate can only express the last one.
 *
 * `metadata` is the reason this matters. It is not a refusal: it is a real
 * surface that shows the routing information policy permits and withholds
 * everything else. A query that simply excluded those rows would turn a
 * deliberate product state into a disappearance.
 */

interface WorkRow {
  id: string;
  kind: WorkKind;
  subject: string;
  context_label: string;
  context_path: string;
  status: WorkStatus;
  current_state: string;
  ministry_id: string | null;
  campus_id: string;
  owner_id: string;
  assignee_ids: string;
  reviewer_ids: string;
  review_required: number;
  participant_ids: string;
  due: string | null;
  period: string | null;
  report_type: string | null;
  sections: string | null;
  artifact_ids: string;
  open_questions: string;
  policy: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: string;
  work_id: string;
  summary: string;
  decided_by_id: string;
  at: string;
  state: Decision["state"];
}

interface ActivityRow {
  id: string;
  work_id: string;
  at: string;
  actor_id: string | null;
  kind: string;
  summary: string;
}

interface CommentRow {
  id: string;
  parent_id: string;
  author_id: string;
  body: string;
  target: string | null;
  system: number;
  created_at: string;
}

/** The only `parent_type` this module writes. */
export const WORK_PARENT = "work";

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined || value === "" ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);
const pack = (value: unknown[] | undefined) => JSON.stringify(value ?? []);

function toWork(
  row: WorkRow,
  decisions: Decision[],
  comments: Comment[],
  activity: ActivityEntry[],
): WorkContext {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    contextLabel: row.context_label,
    contextPath: row.context_path,
    status: row.status,
    reviewRequired: row.review_required === 1,
    currentState: row.current_state,
    campusId: row.campus_id,
    ownerId: row.owner_id,
    assigneeIds: list<string>(row.assignee_ids),
    reviewerIds: list<string>(row.reviewer_ids),
    participantIds: list<string>(row.participant_ids),
    artifactIds: list<string>(row.artifact_ids),
    openQuestions: list<string>(row.open_questions),
    decisions,
    comments,
    activity,
    policy: JSON.parse(row.policy) as AudiencePolicy,
    ...has(row.ministry_id, "ministryId"),
    ...has(row.due, "due"),
    ...has(row.period, "period"),
    ...has(row.report_type, "reportType"),
    ...(row.sections ? { sections: JSON.parse(row.sections) as WorkContext["sections"] } : {}),
  } as WorkContext;
}

export type WorkValues = Writable<
  Omit<WorkContext, "id" | "decisions" | "comments" | "activity" | "version">
>;

const columns = (values: WorkValues) => ({
  kind: values.kind,
  subject: values.subject,
  context_label: values.contextLabel ?? "",
  context_path: values.contextPath ?? "",
  status: values.status,
  current_state: values.currentState ?? "",
  ministry_id: values.ministryId ?? null,
  campus_id: values.campusId ?? "",
  owner_id: values.ownerId,
  assignee_ids: pack(values.assigneeIds),
  reviewer_ids: pack(values.reviewerIds),
  review_required: values.reviewRequired ? 1 : 0,
  participant_ids: pack(values.participantIds),
  due: values.due ?? null,
  period: values.period ?? null,
  report_type: values.reportType ?? null,
  sections: values.sections ? JSON.stringify(values.sections) : null,
  artifact_ids: pack(values.artifactIds),
  open_questions: pack(values.openQuestions),
  policy: JSON.stringify(values.policy),
});

export function createWorkRepository(db: Db) {
  const names = Object.keys(
    columns({
      kind: "report",
      subject: "",
      contextLabel: "",
      contextPath: "",
      currentState: "",
      campusId: "",
      status: "draft",
      ownerId: "x",
      assigneeIds: [],
      reviewerIds: [],
      participantIds: [],
      artifactIds: [],
      openQuestions: [],
      policy: { classification: "open", ownerId: "x" },
    } as WorkValues),
  );

  const childrenFor = (ids: string[]) => {
    const decisions = new Map<string, Decision[]>();
    const comments = new Map<string, Comment[]>();
    const activity = new Map<string, ActivityEntry[]>();
    if (ids.length === 0) return { decisions, comments, activity };

    const holes = ids.map(() => "?").join(", ");

    for (const row of db
      .prepare(`SELECT * FROM work_decision WHERE work_id IN (${holes}) ORDER BY at, id`)
      .all(...ids) as DecisionRow[]) {
      decisions.set(row.work_id, [
        ...(decisions.get(row.work_id) ?? []),
        {
          id: row.id,
          summary: row.summary,
          decidedById: row.decided_by_id,
          at: row.at,
          state: row.state,
        },
      ]);
    }

    /*
     * A conversation is ordered by when each thing was said, and the row order
     * is exactly that. The stored timestamp is a display value — some fixtures
     * write it conversationally, "Sun, 22:40" — so ordering by it would sort a
     * real reply above a seeded one.
     */
    for (const row of db
      .prepare(
        `SELECT * FROM comment WHERE parent_type = ? AND parent_id IN (${holes})
          -- Insertion order, deliberately: see the note above this query.
          ORDER BY rowid`,
      )
      .all(WORK_PARENT, ...ids) as CommentRow[]) {
      comments.set(row.parent_id, [
        ...(comments.get(row.parent_id) ?? []),
        {
          id: row.id,
          authorId: row.author_id,
          at: row.created_at,
          body: row.body,
          ...has(row.target, "target"),
          ...(row.system ? { system: true } : {}),
        } as Comment,
      ]);
    }

    for (const row of db
      .prepare(`SELECT * FROM work_activity WHERE work_id IN (${holes}) ORDER BY at, id`)
      .all(...ids) as ActivityRow[]) {
      activity.set(row.work_id, [
        ...(activity.get(row.work_id) ?? []),
        {
          id: row.id,
          at: row.at,
          kind: row.kind,
          summary: row.summary,
          ...has(row.actor_id, "actorId"),
        } as ActivityEntry,
      ]);
    }

    return { decisions, comments, activity };
  };

  const attach = (rows: WorkRow[]): WorkContext[] => {
    const { decisions, comments, activity } = childrenFor(rows.map((r) => r.id));
    return rows.map((row) =>
      toWork(
        row,
        decisions.get(row.id) ?? [],
        comments.get(row.id) ?? [],
        activity.get(row.id) ?? [],
      ),
    );
  };

  return {
    /**
     * Every work item, unfiltered.
     *
     * Never render this. The service resolves each one's policy and returns
     * either the record, a metadata-only projection, or nothing at all.
     */
    allUnguarded(kind?: WorkKind): WorkContext[] {
      const rows = (
        kind
          ? db
              .prepare("SELECT * FROM work_context WHERE kind = ? ORDER BY updated_at DESC")
              .all(kind)
          : db.prepare("SELECT * FROM work_context ORDER BY updated_at DESC").all()
      ) as WorkRow[];
      return attach(rows);
    },

    /** Also unguarded. The service decides what the viewer may have of it. */
    find(id: string): WorkContext | undefined {
      const row = db.prepare("SELECT * FROM work_context WHERE id = ?").get(id) as
        WorkRow | undefined;
      return row ? attach([row])[0] : undefined;
    },

    insert(values: WorkValues, id = newId("wk")): WorkContext {
      const at = nowIso();
      db.prepare(
        `INSERT INTO work_context (id, ${names.join(", ")}, created_at, updated_at)
         VALUES (@id, ${names.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
      ).run({ id, ...columns(values), created_at: at, updated_at: at });
      return this.find(id)!;
    },

    /** Save, if nobody else has saved since. */
    save(id: string, values: WorkValues, version: number): WorkContext | "stale" | undefined {
      const result = db
        .prepare(
          `UPDATE work_context
              SET ${names.map((c) => `${c} = @${c}`).join(", ")},
                  updated_at = @updated_at, version = version + 1
            WHERE id = @id AND version = @version`,
        )
        .run({ id, ...columns(values), updated_at: nowIso(), version });

      if (result.changes === 0) return this.find(id) ? "stale" : undefined;
      return this.find(id);
    },

    versionOf(id: string): number | undefined {
      const row = db.prepare("SELECT version FROM work_context WHERE id = ?").get(id) as
        { version: number } | undefined;
      return row?.version;
    },

    /**
     * Remove a record.
     *
     * Decisions, activity and content cascade; comments live in the generic
     * table, which has no foreign key because its parent could be anything.
     */
    delete(id: string): boolean {
      const drop = db.transaction(() => {
        db.prepare("DELETE FROM comment WHERE parent_type = ? AND parent_id = ?").run(
          WORK_PARENT,
          id,
        );
        return db.prepare("DELETE FROM work_context WHERE id = ?").run(id).changes > 0;
      });
      return drop();
    },

    addDecision(
      workId: string,
      decision: { summary: string; decidedById: string; state?: Decision["state"]; at?: string },
      id = newId("dec"),
    ): Decision {
      db.prepare(
        `INSERT INTO work_decision (id, work_id, summary, decided_by_id, at, state)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        workId,
        decision.summary,
        decision.decidedById,
        decision.at ?? nowIso(),
        decision.state ?? "recorded",
      );
      const row = db.prepare("SELECT * FROM work_decision WHERE id = ?").get(id) as DecisionRow;
      return {
        id: row.id,
        summary: row.summary,
        decidedById: row.decided_by_id,
        at: row.at,
        state: row.state,
      };
    },

    /** A requested decision becomes a recorded one; it is not duplicated. */
    resolveDecision(id: string, summary: string, decidedById: string): boolean {
      return (
        db
          .prepare(
            `UPDATE work_decision SET state = 'recorded', summary = ?, decided_by_id = ?, at = ?
              WHERE id = ? AND state = 'requested'`,
          )
          .run(summary, decidedById, nowIso(), id).changes > 0
      );
    },

    addActivity(
      workId: string,
      entry: { actorId?: string | undefined; kind: string; summary: string; at?: string },
      id = newId("act"),
    ): void {
      db.prepare(
        `INSERT INTO work_activity (id, work_id, at, actor_id, kind, summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, workId, entry.at ?? nowIso(), entry.actorId ?? null, entry.kind, entry.summary);
    },

    insertComment(
      values: {
        workId: string;
        authorId: string;
        body: string;
        target?: string | undefined;
        system?: boolean;
        at?: string;
      },
      id = newId("c"),
    ): Comment {
      db.prepare(
        `INSERT INTO comment (id, parent_type, parent_id, author_id, body, target, system, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        WORK_PARENT,
        values.workId,
        values.authorId,
        values.body,
        values.target ?? null,
        values.system ? 1 : 0,
        values.at ?? nowIso(),
      );
      return this.findComment(id)!;
    },

    findComment(id: string): Comment | undefined {
      const row = db.prepare("SELECT * FROM comment WHERE id = ?").get(id) as
        CommentRow | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        authorId: row.author_id,
        at: row.created_at,
        body: row.body,
        ...has(row.target, "target"),
        ...(row.system ? { system: true } : {}),
      } as Comment;
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM work_context").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type WorkRepository = ReturnType<typeof createWorkRepository>;
