import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type { AudiencePolicy, Comment, ReachOutReport } from "@/domain/types";

/**
 * Reach-Out rows.
 *
 * Reads, writes, and the row ⇄ domain translation. It authorizes nothing —
 * though in this module there is currently nothing to authorize beyond being a
 * leader, which the service states plainly rather than implying.
 *
 * Comments live in the generic `comment` table (§14) and are attached to the
 * report they belong to on the way out, because every consumer expects them on
 * the record.
 */

interface ReportRow {
  id: string;
  title: string;
  report_date: string;
  content: string;
  author_id: string;
  contributors: string | null;
  policy: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  parent_type: string;
  parent_id: string;
  author_id: string;
  body: string;
  target: string | null;
  system: number;
  created_at: string;
  edited_at: string | null;
}

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);

const pack = (value: unknown[] | undefined) =>
  value === undefined || value.length === 0 ? null : JSON.stringify(value);

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    authorId: row.author_id,
    at: row.created_at,
    body: row.body,
    ...has(row.target, "target"),
    ...(row.system ? { system: true } : {}),
  } as Comment;
}

function toReport(row: ReportRow, comments: Comment[]): ReachOutReport {
  return {
    id: row.id,
    title: row.title,
    reportDate: row.report_date,
    content: row.content,
    authorId: row.author_id,
    comments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    ...(row.contributors ? { contributorIds: list<string>(row.contributors) } : {}),
    ...(row.policy ? { policy: JSON.parse(row.policy) as AudiencePolicy } : {}),
  } as ReachOutReport;
}

export interface ReportFilters {
  search?: string | undefined;
  personId?: string | undefined;
}

export type ReportValues = Writable<
  Omit<ReachOutReport, "id" | "comments" | "createdAt" | "updatedAt" | "version">
>;

/** The only `parent_type` written today. §14's table anticipates others. */
export const REACH_OUT_PARENT = "reach-out-report";

export function createReachOutRepository(db: Db) {
  const commentsFor = (parentIds: string[]): Map<string, Comment[]> => {
    const byParent = new Map<string, Comment[]>();
    if (parentIds.length === 0) return byParent;

    const holes = parentIds.map(() => "?").join(", ");
    /*
     * A conversation is ordered by when each thing was said, and the row order
     * is exactly that. The stored timestamp is a display value — some fixtures
     * write it conversationally, "Sun, 22:40" — so ordering by it would sort a
     * real reply above a seeded one.
     */
    const rows = db
      .prepare(
        `SELECT * FROM comment
          WHERE parent_type = ? AND parent_id IN (${holes})
          -- Insertion order, deliberately: see the note above this query.
          ORDER BY rowid`,
      )
      .all(REACH_OUT_PARENT, ...parentIds) as CommentRow[];

    for (const row of rows) {
      const existing = byParent.get(row.parent_id) ?? [];
      existing.push(toComment(row));
      byParent.set(row.parent_id, existing);
    }
    return byParent;
  };

  const attach = (rows: ReportRow[]): ReachOutReport[] => {
    const comments = commentsFor(rows.map((r) => r.id));
    return rows.map((row) => toReport(row, comments.get(row.id) ?? []));
  };

  function where({ search, personId }: ReportFilters) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      /* What it is called and what it says — the two a leader would mean. */
      clauses.push("(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)");
      params.push(q, q);
    }
    if (personId) {
      /* Who wrote it first, or who has worked on it since — `contributorsOf`. */
      clauses.push(
        "(author_id = ? OR EXISTS (SELECT 1 FROM json_each(IFNULL(contributors, '[]')) WHERE value = ?))",
      );
      params.push(personId, personId);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  return {
    count(filters: ReportFilters = {}): number {
      const { sql, params } = where(filters);
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM reach_out_report ${sql}`)
        .get(...params) as { n: number };
      return row.n;
    },

    /** Newest report first — the binder is read from the back. */
    list(filters: ReportFilters, limit: number, offset: number): ReachOutReport[] {
      const { sql, params } = where(filters);
      const rows = db
        .prepare(
          `SELECT * FROM reach_out_report ${sql}
            ORDER BY report_date DESC, created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as ReportRow[];
      return attach(rows);
    },

    find(id: string): ReachOutReport | undefined {
      const row = db.prepare("SELECT * FROM reach_out_report WHERE id = ?").get(id) as
        ReportRow | undefined;
      return row ? attach([row])[0] : undefined;
    },

    insert(values: ReportValues, id = newId("ro")): ReachOutReport {
      const at = nowIso();
      db.prepare(
        `INSERT INTO reach_out_report
           (id, title, report_date, content, author_id, contributors, policy, created_at, updated_at)
         VALUES (@id, @title, @report_date, @content, @author_id, @contributors, @policy, @created_at, @updated_at)`,
      ).run({
        id,
        title: values.title,
        report_date: values.reportDate,
        content: values.content,
        author_id: values.authorId,
        contributors: pack(values.contributorIds),
        policy: values.policy ? JSON.stringify(values.policy) : null,
        created_at: at,
        updated_at: at,
      });
      return this.find(id)!;
    },

    /**
     * Save, if nobody else has saved since.
     *
     * The version is part of the WHERE, so the check and the write are one
     * statement and two savers cannot both pass through a gap between them.
     * Returns `"stale"` when the row moved on and `undefined` when it is gone —
     * two different things to tell a leader.
     */
    save(id: string, values: ReportValues, version: number): ReachOutReport | "stale" | undefined {
      const result = db
        .prepare(
          `UPDATE reach_out_report
              SET title = @title, report_date = @report_date, content = @content,
                  contributors = @contributors, updated_at = @updated_at,
                  version = version + 1
            WHERE id = @id AND version = @version`,
        )
        .run({
          id,
          title: values.title,
          report_date: values.reportDate,
          content: values.content,
          contributors: pack(values.contributorIds),
          updated_at: nowIso(),
          version,
        });

      if (result.changes === 0) return this.find(id) ? "stale" : undefined;
      return this.find(id);
    },

    delete(id: string): boolean {
      /* Comments are not cascaded by the database — the generic table has no
         foreign key, because its parent could be anything — so they go here. */
      const drop = db.transaction(() => {
        db.prepare("DELETE FROM comment WHERE parent_type = ? AND parent_id = ?").run(
          REACH_OUT_PARENT,
          id,
        );
        return db.prepare("DELETE FROM reach_out_report WHERE id = ?").run(id).changes > 0;
      });
      return drop();
    },

    insertComment(
      values: { parentId: string; authorId: string; body: string; target?: string | undefined },
      id = newId("c"),
    ): Comment {
      db.prepare(
        `INSERT INTO comment (id, parent_type, parent_id, author_id, body, target, system, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        id,
        REACH_OUT_PARENT,
        values.parentId,
        values.authorId,
        values.body,
        values.target ?? null,
        nowIso(),
      );
      return this.findComment(id)!;
    },

    findComment(id: string): Comment | undefined {
      const row = db.prepare("SELECT * FROM comment WHERE id = ?").get(id) as
        CommentRow | undefined;
      return row ? toComment(row) : undefined;
    },

    deleteComment(id: string): boolean {
      return db.prepare("DELETE FROM comment WHERE id = ?").run(id).changes > 0;
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM reach_out_report").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type ReachOutRepository = ReturnType<typeof createReachOutRepository>;
