import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type {
  ActivityEntry,
  BinderLink,
  Comment,
  ContentSource,
  DiscussionPolicy,
  LeadershipReport,
  MeetingBlock,
  ReportRevision,
  ReportStatus,
  ReportType,
  ReportVisibility,
} from "@/domain/types";

/**
 * Leadership Report rows.
 *
 * Reads, writes, and the row ⇄ domain translation. **It authorizes nothing.**
 *
 * That is a departure from the other guarded modules, where the filter is SQL.
 * Whether a viewer may know a report exists is `canDiscover`, which resolves an
 * audience policy from the visibility, the named audience, the viewer's persona
 * and their group memberships — and which treats "you may know this exists" as
 * *no discovery*, because knowing a confidential report about you exists is
 * itself disclosure. That is the subtlest rule in the application and the worst
 * one to get slightly wrong in a second language. It stays in one place, in the
 * domain, and the service applies it before anything leaves.
 *
 * The Meeting Notes argument for SQL does not apply here: that list pages and a
 * `COUNT(*)` would have leaked how many notes a leader may not read. This module
 * *deliberately says* how many reports were withheld — "3 reports are held to an
 * audience you are not part of" — so the count is a product decision already
 * made, not a leak to prevent.
 */

interface ReportRow {
  id: string;
  title: string;
  report_type: string;
  author_id: string;
  subject_text: string | null;
  subject_id: string | null;
  reporting_period: string | null;
  context_type: LeadershipReport["contextType"] | null;
  context_id: string | null;
  category: string | null;
  status: ReportStatus;
  visibility: ReportVisibility;
  discussion_policy: DiscussionPolicy;
  content_source: ContentSource;
  audience_ids: string;
  commenter_ids: string | null;
  blocks: string | null;
  primary_document_id: string | null;
  related_document_ids: string;
  related_text: string | null;
  links: string;
  tags: string;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
}

interface RevisionRow {
  report_id: string;
  revision: number;
  blocks: string;
  actor_id: string;
  at: string;
  note: string | null;
}

interface ActivityRow {
  id: string;
  report_id: string;
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
export const REPORT_PARENT = "leadership-report";

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined || value === "" ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);

const pack = (value: unknown[] | undefined) => JSON.stringify(value ?? []);

function toReport(
  row: ReportRow,
  comments: Comment[],
  activity: ActivityEntry[],
  revisions: ReportRevision[],
): LeadershipReport {
  return {
    id: row.id,
    title: row.title,
    reportType: row.report_type as ReportType,
    authorId: row.author_id,
    status: row.status,
    visibility: row.visibility,
    discussionPolicy: row.discussion_policy,
    contentSource: row.content_source,
    audienceIds: list<string>(row.audience_ids),
    relatedDocumentIds: list<string>(row.related_document_ids),
    links: list<BinderLink>(row.links),
    tags: list<string>(row.tags),
    comments,
    activity,
    revisions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...has(row.subject_text, "subjectText"),
    ...has(row.subject_id, "subjectId"),
    ...has(row.reporting_period, "reportingPeriod"),
    ...has(row.context_type, "contextType"),
    ...has(row.context_id, "contextId"),
    category: row.category ?? "general",
    ...has(row.related_text, "relatedText"),
    ...has(row.primary_document_id, "primaryDocumentId"),
    ...(row.commenter_ids ? { commenterIds: list<string>(row.commenter_ids) } : {}),
    ...(row.blocks ? { blocks: JSON.parse(row.blocks) as MeetingBlock[] } : {}),
    ...has(row.published_at, "publishedAt"),
    ...has(row.archived_at, "archivedAt"),
  } as LeadershipReport;
}

/** Everything a report carries that a writer may set. */
export type ReportValues = Writable<
  Omit<
    LeadershipReport,
    "id" | "comments" | "activity" | "revisions" | "createdAt" | "updatedAt" | "version"
  >
>;

const columns = (values: ReportValues) => ({
  title: values.title ?? "",
  report_type: values.reportType,
  author_id: values.authorId,
  subject_text: values.subjectText ?? null,
  subject_id: values.subjectId ?? null,
  reporting_period: values.reportingPeriod ?? null,
  /* Where it was written, and what kind of thing it is. Neither decides who
     may read it — `visibility` and `audience_ids` do, alone. */
  context_type: values.contextType ?? null,
  context_id: values.contextId ?? null,
  category: values.category ?? "general",
  status: values.status,
  visibility: values.visibility,
  discussion_policy: values.discussionPolicy,
  content_source: values.contentSource,
  audience_ids: pack(values.audienceIds),
  commenter_ids: values.commenterIds ? pack(values.commenterIds) : null,
  blocks: values.blocks ? JSON.stringify(values.blocks) : null,
  primary_document_id: values.primaryDocumentId ?? null,
  related_document_ids: pack(values.relatedDocumentIds),
  related_text: values.relatedText ?? null,
  links: pack(values.links),
  tags: pack(values.tags),
  published_at: values.publishedAt ?? null,
  archived_at: values.archivedAt ?? null,
});

export function createLeadershipReportRepository(db: Db) {
  const names = Object.keys(
    columns({
      title: "",
      reportType: "x",
      authorId: "x",
      status: "draft",
      visibility: "leadership",
      discussionPolicy: "viewers",
      contentSource: "native",
      audienceIds: [],
      relatedDocumentIds: [],
      links: [],
      tags: [],
    } as ReportValues),
  );

  const childrenFor = (ids: string[]) => {
    const comments = new Map<string, Comment[]>();
    const activity = new Map<string, ActivityEntry[]>();
    const revisions = new Map<string, ReportRevision[]>();
    if (ids.length === 0) return { comments, activity, revisions };

    const holes = ids.map(() => "?").join(", ");

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
      .all(REPORT_PARENT, ...ids) as CommentRow[]) {
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
      .prepare(`SELECT * FROM report_activity WHERE report_id IN (${holes}) ORDER BY at, id`)
      .all(...ids) as ActivityRow[]) {
      activity.set(row.report_id, [
        ...(activity.get(row.report_id) ?? []),
        {
          id: row.id,
          at: row.at,
          kind: row.kind,
          summary: row.summary,
          ...has(row.actor_id, "actorId"),
        } as ActivityEntry,
      ]);
    }

    for (const row of db
      .prepare(`SELECT * FROM report_revision WHERE report_id IN (${holes}) ORDER BY revision`)
      .all(...ids) as RevisionRow[]) {
      revisions.set(row.report_id, [
        ...(revisions.get(row.report_id) ?? []),
        {
          revision: row.revision,
          blocks: JSON.parse(row.blocks) as MeetingBlock[],
          actorId: row.actor_id,
          at: row.at,
          ...has(row.note, "note"),
        } as ReportRevision,
      ]);
    }

    return { comments, activity, revisions };
  };

  const attach = (rows: ReportRow[]): LeadershipReport[] => {
    const { comments, activity, revisions } = childrenFor(rows.map((r) => r.id));
    return rows.map((row) =>
      toReport(
        row,
        comments.get(row.id) ?? [],
        activity.get(row.id) ?? [],
        revisions.get(row.id) ?? [],
      ),
    );
  };

  return {
    /**
     * Every report, unfiltered.
     *
     * Never render this. The service applies `canDiscover` before anything
     * leaves, and the name says plainly what this is so a future caller cannot
     * mistake it for a safe list.
     */
    allUnguarded(): LeadershipReport[] {
      const rows = db
        .prepare("SELECT * FROM leadership_report ORDER BY updated_at DESC, created_at DESC")
        .all() as ReportRow[];
      return attach(rows);
    },

    /** Also unguarded. The service decides whether the viewer may have it. */
    find(id: string): LeadershipReport | undefined {
      const row = db.prepare("SELECT * FROM leadership_report WHERE id = ?").get(id) as
        ReportRow | undefined;
      return row ? attach([row])[0] : undefined;
    },

    insert(values: ReportValues, id = newId("lr")): LeadershipReport {
      const at = nowIso();
      db.prepare(
        `INSERT INTO leadership_report (id, ${names.join(", ")}, created_at, updated_at)
         VALUES (@id, ${names.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
      ).run({ id, ...columns(values), created_at: at, updated_at: at });
      return this.find(id)!;
    },

    /**
     * Save, if nobody else has saved since.
     *
     * The version is part of the WHERE, so the check and the write are one
     * statement. `"stale"` means somebody else moved it on; `undefined` means
     * it is gone.
     */
    save(
      id: string,
      values: ReportValues,
      version: number,
    ): LeadershipReport | "stale" | undefined {
      const result = db
        .prepare(
          `UPDATE leadership_report
              SET ${names.map((c) => `${c} = @${c}`).join(", ")},
                  updated_at = @updated_at, version = version + 1
            WHERE id = @id AND version = @version`,
        )
        .run({ id, ...columns(values), updated_at: nowIso(), version });

      if (result.changes === 0) return this.find(id) ? "stale" : undefined;
      return this.find(id);
    },

    /** The stored version, for a caller that needs it without the whole report. */
    versionOf(id: string): number | undefined {
      const row = db.prepare("SELECT version FROM leadership_report WHERE id = ?").get(id) as
        { version: number } | undefined;
      return row?.version;
    },

    delete(id: string): boolean {
      /* Revisions and activity cascade; comments live in the generic table,
         which has no foreign key because its parent could be anything. */
      const drop = db.transaction(() => {
        db.prepare("DELETE FROM comment WHERE parent_type = ? AND parent_id = ?").run(
          REPORT_PARENT,
          id,
        );
        return db.prepare("DELETE FROM leadership_report WHERE id = ?").run(id).changes > 0;
      });
      return drop();
    },

    addActivity(
      reportId: string,
      entry: { actorId?: string | undefined; kind: string; summary: string; at?: string },
      id = newId("lra"),
    ): void {
      db.prepare(
        `INSERT INTO report_activity (id, report_id, at, actor_id, kind, summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, reportId, entry.at ?? nowIso(), entry.actorId ?? null, entry.kind, entry.summary);
    },

    addRevision(
      reportId: string,
      revision: {
        revision: number;
        blocks: MeetingBlock[];
        actorId: string;
        note?: string;
        at?: string;
      },
      id = newId("lrv"),
    ): void {
      db.prepare(
        `INSERT INTO report_revision (id, report_id, revision, blocks, actor_id, at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        reportId,
        revision.revision,
        JSON.stringify(revision.blocks),
        revision.actorId,
        revision.at ?? nowIso(),
        revision.note ?? null,
      );
    },

    insertComment(
      values: { reportId: string; authorId: string; body: string; target?: string | undefined },
      id = newId("c"),
    ): Comment {
      db.prepare(
        `INSERT INTO comment (id, parent_type, parent_id, author_id, body, target, system, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        id,
        REPORT_PARENT,
        values.reportId,
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
      if (!row) return undefined;
      return {
        id: row.id,
        authorId: row.author_id,
        at: row.created_at,
        body: row.body,
        ...has(row.target, "target"),
      } as Comment;
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM leadership_report").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type LeadershipReportRepository = ReturnType<typeof createLeadershipReportRepository>;
