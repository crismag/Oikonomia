import type { Database as Db } from "better-sqlite3";

import { noteReadableParams, noteReadableSql } from "./note-readability";
import { newId, nowIso, type Writable } from "../db/records";
import { blockText } from "@/domain/meeting";
import type { BinderLink, MeetingBlock, MeetingNote, MeetingTask } from "@/domain/types";

/**
 * Meeting Notes rows.
 *
 * Reads, writes, and the translation between a SQLite row and a domain object.
 * **It authorizes nothing** — the service above decided the caller may have
 * what it asks for.
 *
 * The one piece of cleverness here is `body_text`: the plain text of every
 * block, recomputed on every write, so the list can search what a note *says*
 * and not only what it is called. It is derived, has exactly one writer, and is
 * never read back as content.
 */

interface NoteRow {
  id: string;
  title: string;
  note_type: string;
  date: string;
  time: string | null;
  location: string | null;
  meeting_type: string | null;
  facilitator_id: string | null;
  note_taker_id: string | null;
  participants: string | null;
  absentees: string | null;
  blocks: string;
  body_text: string;
  status: string;
  tags: string | null;
  related_text: string | null;
  links: string | null;
  author_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  meeting_id: string;
  block_id: string | null;
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/* NULL means *absent*, not `undefined`-valued — see calendar-repository.ts. */
const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);

const optionalList = <T>(raw: string | null, key: string) => {
  const parsed = list<T>(raw);
  return parsed.length === 0 ? {} : { [key]: parsed };
};

const pack = (value: unknown[] | undefined) =>
  value === undefined || value.length === 0 ? null : JSON.stringify(value);

function toNote(row: NoteRow): MeetingNote {
  return {
    id: row.id,
    title: row.title,
    noteType: row.note_type,
    date: row.date,
    participantIds: list<string>(row.participants),
    blocks: list<MeetingBlock>(row.blocks),
    status: row.status,
    tags: list<string>(row.tags),
    links: list<BinderLink>(row.links),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    ...has(row.time, "time"),
    ...has(row.location, "location"),
    ...has(row.meeting_type, "type"),
    ...has(row.facilitator_id, "facilitatorId"),
    ...has(row.note_taker_id, "noteTakerId"),
    ...optionalList<string>(row.absentees, "absenteeIds"),
    ...has(row.related_text, "relatedText"),
    ...has(row.author_id, "authorId"),
  } as MeetingNote;
}

function toTask(row: TaskRow): MeetingTask {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    ...has(row.block_id, "blockId"),
    ...has(row.assignee_id, "assigneeId"),
    ...has(row.due_date, "dueDate"),
  } as MeetingTask;
}

export type NoteValues = Writable<Omit<MeetingNote, "id" | "createdAt" | "updatedAt" | "version">>;
/* `createdAt` is accepted so the seed can keep the fixtures' own dates. */
export type TaskValues = Writable<Omit<MeetingTask, "id">>;

/** Everything the note says, flattened, for the list's search. */
function bodyText(blocks: MeetingBlock[] | undefined): string {
  return (blocks ?? []).map(blockText).filter(Boolean).join(" ").toLowerCase();
}

function noteColumns(values: NoteValues) {
  return {
    title: values.title,
    note_type: values.noteType,
    date: values.date,
    time: values.time ?? null,
    location: values.location ?? null,
    meeting_type: values.type ?? null,
    facilitator_id: values.facilitatorId ?? null,
    note_taker_id: values.noteTakerId ?? null,
    participants: pack(values.participantIds),
    absentees: pack(values.absenteeIds),
    blocks: JSON.stringify(values.blocks ?? []),
    body_text: bodyText(values.blocks),
    status: values.status,
    tags: pack(values.tags),
    related_text: values.relatedText ?? null,
    links: pack(values.links),
    author_id: values.authorId ?? null,
  };
}

export interface NoteFilters {
  search?: string | undefined;
  noteType?: string | undefined;
  tag?: string | undefined;
  ministryId?: string | undefined;
  /** Written or taken down by this person. */
  personId?: string | undefined;
  /**
   * Restrict to notes this person may read.
   *
   * Readability has to be part of the *query* rather than a pass over its
   * results: filtered-afterwards means a page shorter than it claims, and a
   * `COUNT(*)` that tells a viewer how many notes they may not read. The
   * rule itself is stated in `domain/authorize.ts`; this is the same rule
   * expressed as SQL, and `meeting-service.test.ts` asserts the two agree.
   */
  readableBy?: string | undefined;
  /** Same kind of meeting (`meeting_type`), which is what makes a series. */
  meetingType?: string | undefined;
  /** Held strictly before this ISO date. */
  before?: string | undefined;
  /** Leave this note out — a note is never its own previous meeting. */
  excludeId?: string | undefined;
}

export function createMeetingRepository(db: Db) {
  const columns = Object.keys(
    noteColumns({ title: "", noteType: "personal", date: "", status: "draft" } as NoteValues),
  );

  const insert = db.prepare(
    `INSERT INTO meeting_note (id, ${columns.join(", ")}, created_at, updated_at)
     VALUES (@id, ${columns.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
  );

  /*
   * The version is part of the WHERE, not of the SET check: a write against a
   * stale version matches no row and changes nothing, which is the refusal.
   * Doing it in one statement is what makes it atomic — reading the version
   * and then writing would leave a gap two savers can both pass through.
   */
  const replace = db.prepare(
    `UPDATE meeting_note
        SET ${columns.map((c) => `${c} = @${c}`).join(", ")},
            updated_at = @updated_at,
            version = version + 1
      WHERE id = @id AND version = @version`,
  );

  /**
   * Filters, as SQL rather than as an array pass.
   *
   * Paging has to happen *after* filtering (§19), which means the filter has
   * to be something the database understands. Tags and ministry links are JSON
   * columns, so they match on their serialized form — exact enough because the
   * writer is this file and the shape is known.
   */
  function where(filters: NoteFilters) {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.noteType) {
      clauses.push("note_type = ?");
      params.push(filters.noteType);
    }
    if (filters.tag) {
      clauses.push("tags LIKE ?");
      params.push(`%"${filters.tag}"%`);
    }
    if (filters.ministryId) {
      /* A context link, not a tag: `{"kind":"ministry","id":"min-music"}`. */
      clauses.push("links LIKE ?");
      params.push(`%"ministry"%"${filters.ministryId}"%`);
    }
    if (filters.personId) {
      clauses.push("(author_id = ? OR note_taker_id = ?)");
      params.push(filters.personId, filters.personId);
    }
    if (filters.readableBy) {
      /* One copy of this rule, shared with the document registry. */
      clauses.push(noteReadableSql("meeting_note"));
      params.push(...noteReadableParams(filters.readableBy));
    }
    if (filters.meetingType) {
      clauses.push("meeting_type = ?");
      params.push(filters.meetingType);
    }
    if (filters.before) {
      clauses.push("date < ?");
      params.push(filters.before);
    }
    if (filters.excludeId) {
      clauses.push("id <> ?");
      params.push(filters.excludeId);
    }
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      /* Title, what it says, and its tags — the three a leader would mean. */
      clauses.push("(LOWER(title) LIKE ? OR body_text LIKE ? OR LOWER(IFNULL(tags, '')) LIKE ?)");
      params.push(q, q, q);
    }

    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  return {
    countNotes(filters: NoteFilters): number {
      const { sql, params } = where(filters);
      const row = db.prepare(`SELECT COUNT(*) AS n FROM meeting_note ${sql}`).get(...params) as {
        n: number;
      };
      return row.n;
    },

    /** Newest meeting first — a notebook is read from the back. */
    listNotes(filters: NoteFilters, limit: number, offset: number): MeetingNote[] {
      const { sql, params } = where(filters);
      const rows = db
        .prepare(
          `SELECT * FROM meeting_note ${sql} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as NoteRow[];
      return rows.map(toNote);
    },

    findNote(id: string): MeetingNote | undefined {
      const row = db.prepare("SELECT * FROM meeting_note WHERE id = ?").get(id) as
        NoteRow | undefined;
      return row ? toNote(row) : undefined;
    },

    insertNote(values: NoteValues, id = newId("mn")): MeetingNote {
      const at = nowIso();
      insert.run({ id, ...noteColumns(values), created_at: at, updated_at: at });
      return this.findNote(id)!;
    },

    /**
     * Save, if nobody else has saved since.
     *
     * Returns `undefined` when the row is gone and `"stale"` when it moved on
     * — two different answers, because "deleted" and "somebody else got there
     * first" call for different things to be said to the leader.
     */
    saveNote(id: string, values: NoteValues, version: number): MeetingNote | "stale" | undefined {
      const result = replace.run({ id, ...noteColumns(values), updated_at: nowIso(), version });
      if (result.changes === 0) return this.findNote(id) ? "stale" : undefined;
      return this.findNote(id);
    },

    deleteNote(id: string): boolean {
      /* Tasks go with it — ON DELETE CASCADE. They were filed nowhere else. */
      return db.prepare("DELETE FROM meeting_note WHERE id = ?").run(id).changes > 0;
    },

    /* ------------------------------------------------------------- tasks */

    /** Every task of the given meetings, so a list can count them in one query. */
    tasksFor(meetingIds: string[]): MeetingTask[] {
      if (meetingIds.length === 0) return [];
      const holes = meetingIds.map(() => "?").join(", ");
      const rows = db
        .prepare(`SELECT * FROM meeting_task WHERE meeting_id IN (${holes}) ORDER BY created_at`)
        .all(...meetingIds) as TaskRow[];
      return rows.map(toTask);
    },

    /**
     * Every task assigned to one person, whatever meeting it came out of.
     *
     * Deliberately not gated by whether they can read the meeting. A task is a
     * responsibility somebody accepted on their behalf; hiding it because it
     * was written in a note they cannot open would mean the work exists and
     * the person carrying it cannot see it. The **note's content** stays
     * closed — the service returns a neutral label for a meeting the viewer
     * may not read.
     */
    tasksAssignedTo(personId: string): MeetingTask[] {
      const rows = db
        .prepare("SELECT * FROM meeting_task WHERE assignee_id = ? ORDER BY due_date, created_at")
        .all(personId) as TaskRow[];
      return rows.map(toTask);
    },

    findTask(id: string): MeetingTask | undefined {
      const row = db.prepare("SELECT * FROM meeting_task WHERE id = ?").get(id) as
        TaskRow | undefined;
      return row ? toTask(row) : undefined;
    },

    insertTask(values: TaskValues, id = newId("mt")): MeetingTask {
      const at = nowIso();
      db.prepare(
        `INSERT INTO meeting_task
           (id, meeting_id, block_id, title, assignee_id, due_date, status, created_at, updated_at)
         VALUES (@id, @meeting_id, @block_id, @title, @assignee_id, @due_date, @status, @created_at, @updated_at)`,
      ).run({
        id,
        meeting_id: values.meetingId,
        block_id: values.blockId ?? null,
        title: values.title,
        assignee_id: values.assigneeId ?? null,
        due_date: values.dueDate ?? null,
        status: values.status ?? "open",
        created_at: values.createdAt ?? at,
        updated_at: at,
      });
      return this.findTask(id)!;
    },

    saveTask(id: string, values: TaskValues): MeetingTask | undefined {
      db.prepare(
        `UPDATE meeting_task
            SET title = @title, assignee_id = @assignee_id, due_date = @due_date,
                status = @status, block_id = @block_id, updated_at = @updated_at
          WHERE id = @id`,
      ).run({
        id,
        title: values.title,
        assignee_id: values.assigneeId ?? null,
        due_date: values.dueDate ?? null,
        status: values.status ?? "open",
        block_id: values.blockId ?? null,
        updated_at: nowIso(),
      });
      return this.findTask(id);
    },

    deleteTask(id: string): boolean {
      return db.prepare("DELETE FROM meeting_task WHERE id = ?").run(id).changes > 0;
    },

    /**
     * The tags and ministries that exist across notes this viewer may read.
     *
     * Offered as filter options, so they must describe the whole readable set
     * rather than the page in hand — a tag that vanishes from the filter bar
     * because you turned to page two is a filter that cannot be trusted. The
     * readability clause is the same one the list uses, so the options never
     * reveal a tag from a note the viewer cannot open.
     */
    facets(filters: NoteFilters): { tags: string[]; ministryIds: string[] } {
      /* Only readability narrows this: the other filters are what the leader is
         choosing between, and removing an option because it is already chosen
         would take away the way back. */
      const { sql, params } = where({ readableBy: filters.readableBy });
      const rows = db.prepare(`SELECT tags, links FROM meeting_note ${sql}`).all(...params) as {
        tags: string | null;
        links: string | null;
      }[];

      const tags = new Set<string>();
      const ministryIds = new Set<string>();

      for (const row of rows) {
        for (const tag of list<string>(row.tags)) tags.add(tag);
        for (const link of list<BinderLink>(row.links)) {
          if (link.kind === "ministry") ministryIds.add(link.id);
        }
      }

      return { tags: [...tags].sort(), ministryIds: [...ministryIds] };
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM meeting_note").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type MeetingRepository = ReturnType<typeof createMeetingRepository>;
