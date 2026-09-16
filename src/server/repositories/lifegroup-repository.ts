import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type {
  Exhortation,
  Gathering,
  GatheringAttendance,
  GatheringReport,
  LifegroupEntry,
} from "@/domain/types";

/**
 * LifeGroup rows.
 *
 * **It authorizes nothing.** Entry visibility is the most sensitive rule in the
 * product — entries carry prayer requests and concerns about named people — and
 * it is decided in the service, in the one module that knows how.
 *
 * The exhortation and the report live in the `gathering` row and are presented
 * as their own records, because that is what the domain calls them and what
 * every consumer expects.
 */

interface GatheringRow {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_id: string | null;
  venue_name: string | null;
  host_id: string | null;
  campus_id: string | null;
  assigned_leaders: string;
  primary_leader_id: string | null;
  expected_attendees: string | null;
  status: string;
  exhortation_topic: string | null;
  exhortation_scripture: string | null;
  exhortation_notes: string | null;
  exhortation_given_by: string | null;
  report_summary: string | null;
  report_completed_at: string | null;
  report_completed_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AttendanceRow {
  id: string;
  gathering_id: string;
  person_id: string | null;
  name: string | null;
  status: string;
  expected: number;
  first_time: number;
}

interface EntryRow {
  id: string;
  gathering_id: string;
  author_id: string;
  body: string;
  category: string | null;
  visibility: string | null;
  viewer_ids: string | null;
  person_id: string | null;
  assigned_to: string | null;
  due_date: string | null;
  completed: number;
  reportable: number;
  created_at: string;
}

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);

const pack = (value: unknown[] | undefined) =>
  value === undefined || value.length === 0 ? null : JSON.stringify(value);

function toGathering(row: GatheringRow): Gathering {
  return {
    id: row.id,
    date: row.date,
    assignedLeaderIds: list<string>(row.assigned_leaders),
    status: row.status,
    ...has(row.venue_id, "venueId"),
    ...has(row.primary_leader_id, "primaryLeaderId"),
    ...has(row.start_time, "startTime"),
    ...has(row.end_time, "endTime"),
    ...has(row.venue_name, "venueName"),
    ...has(row.host_id, "hostId"),
    ...has(row.campus_id, "campusId"),
    ...(row.expected_attendees
      ? { expectedAttendeeIds: list<string>(row.expected_attendees) }
      : {}),
    ...has(row.created_by, "createdBy"),
    ...has(row.updated_by, "updatedBy"),
  } as Gathering;
}

/** Absent exactly when there is no topic — a topic is what makes one. */
function toExhortation(row: GatheringRow): Exhortation | undefined {
  if (!row.exhortation_topic) return undefined;
  return {
    gatheringId: row.id,
    topic: row.exhortation_topic,
    ...has(row.exhortation_scripture, "scripture"),
    ...has(row.exhortation_notes, "notes"),
    ...has(row.exhortation_given_by, "givenById"),
  } as Exhortation;
}

/** Absent when nothing has been written and nothing completed. */
function toReport(row: GatheringRow): GatheringReport | undefined {
  if (!row.report_summary && !row.report_completed_at) return undefined;
  return {
    gatheringId: row.id,
    ...has(row.report_summary, "summary"),
    ...has(row.report_completed_at, "completedAt"),
    ...has(row.report_completed_by, "completedById"),
  } as GatheringReport;
}

function toAttendance(row: AttendanceRow): GatheringAttendance {
  return {
    id: row.id,
    gatheringId: row.gathering_id,
    status: row.status,
    ...has(row.person_id, "personId"),
    ...has(row.name, "name"),
    ...(row.expected ? { expected: true } : {}),
    ...(row.first_time ? { firstTime: true } : {}),
  } as GatheringAttendance;
}

function toEntry(row: EntryRow): LifegroupEntry {
  return {
    id: row.id,
    gatheringId: row.gathering_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    ...has(row.category, "category"),
    ...has(row.visibility, "visibility"),
    ...(row.viewer_ids ? { viewerIds: list<string>(row.viewer_ids) } : {}),
    ...has(row.person_id, "personId"),
    ...has(row.assigned_to, "assignedTo"),
    ...has(row.due_date, "dueDate"),
    ...(row.completed ? { completed: true } : {}),
    ...(row.reportable ? { reportable: true } : {}),
  } as LifegroupEntry;
}

export type GatheringValues = Writable<Omit<Gathering, "id">>;
export type EntryValues = Writable<Omit<LifegroupEntry, "id" | "createdAt">>;

function gatheringColumns(values: GatheringValues) {
  return {
    date: values.date,
    start_time: values.startTime ?? null,
    end_time: values.endTime ?? null,
    venue_id: values.venueId ?? null,
    venue_name: values.venueName ?? null,
    host_id: values.hostId ?? null,
    campus_id: values.campusId ?? null,
    assigned_leaders: JSON.stringify(values.assignedLeaderIds ?? []),
    primary_leader_id: values.primaryLeaderId ?? null,
    expected_attendees: pack(values.expectedAttendeeIds),
    status: values.status,
    created_by: values.createdBy ?? null,
    updated_by: values.updatedBy ?? null,
  };
}

export function createLifegroupRepository(db: Db) {
  const columns = Object.keys(gatheringColumns({ date: "", status: "planned" } as GatheringValues));

  const insert = db.prepare(
    `INSERT INTO gathering (id, ${columns.join(", ")}, created_at, updated_at)
     VALUES (@id, ${columns.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
  );

  /* Only when, where and who. The exhortation and report have their own
     writers, so a change of date can never quietly erase the write-up. */
  const replace = db.prepare(
    `UPDATE gathering SET ${columns.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @updated_at
      WHERE id = @id`,
  );

  const find = (id: string) =>
    db.prepare("SELECT * FROM gathering WHERE id = ?").get(id) as GatheringRow | undefined;

  return {
    allGatherings(): Gathering[] {
      const rows = db.prepare("SELECT * FROM gathering ORDER BY date DESC").all() as GatheringRow[];
      return rows.map(toGathering);
    },

    gatheringsInRange(from: string, to: string): Gathering[] {
      const rows = db
        .prepare("SELECT * FROM gathering WHERE date BETWEEN ? AND ? ORDER BY date DESC")
        .all(from, to) as GatheringRow[];
      return rows.map(toGathering);
    },

    findGathering(id: string): Gathering | undefined {
      const row = find(id);
      return row ? toGathering(row) : undefined;
    },

    /** Exhortations and reports, presented as the records the domain expects. */
    exhortations(): Exhortation[] {
      const rows = db
        .prepare("SELECT * FROM gathering WHERE exhortation_topic IS NOT NULL")
        .all() as GatheringRow[];
      return rows.map(toExhortation).filter((e): e is Exhortation => !!e);
    },

    reports(): GatheringReport[] {
      const rows = db
        .prepare(
          "SELECT * FROM gathering WHERE report_summary IS NOT NULL OR report_completed_at IS NOT NULL",
        )
        .all() as GatheringRow[];
      return rows.map(toReport).filter((r): r is GatheringReport => !!r);
    },

    insertGathering(values: GatheringValues, id = newId("gth")): Gathering {
      const at = nowIso();
      insert.run({ id, ...gatheringColumns(values), created_at: at, updated_at: at });
      return this.findGathering(id)!;
    },

    saveGathering(id: string, values: GatheringValues): Gathering | undefined {
      replace.run({ id, ...gatheringColumns(values), updated_at: nowIso() });
      return this.findGathering(id);
    },

    setStatus(id: string, status: string): void {
      db.prepare("UPDATE gathering SET status = ?, updated_at = ? WHERE id = ?").run(
        status,
        nowIso(),
        id,
      );
    },

    setExhortation(
      id: string,
      value: {
        topic: string;
        scripture?: string | undefined;
        notes?: string | undefined;
        givenById?: string | undefined;
      } | null,
    ): void {
      db.prepare(
        `UPDATE gathering
            SET exhortation_topic = @topic, exhortation_scripture = @scripture,
                exhortation_notes = @notes, exhortation_given_by = @givenBy,
                updated_at = @at
          WHERE id = @id`,
      ).run({
        id,
        topic: value?.topic ?? null,
        scripture: value?.scripture ?? null,
        notes: value?.notes ?? null,
        givenBy: value?.givenById ?? null,
        at: nowIso(),
      });
    },

    setReport(
      id: string,
      value: {
        summary?: string | undefined;
        completedAt?: string | undefined;
        completedById?: string | undefined;
      },
    ): void {
      db.prepare(
        `UPDATE gathering
            SET report_summary = @summary, report_completed_at = @completedAt,
                report_completed_by = @completedBy, updated_at = @at
          WHERE id = @id`,
      ).run({
        id,
        summary: value.summary ?? null,
        completedAt: value.completedAt ?? null,
        completedBy: value.completedById ?? null,
        at: nowIso(),
      });
    },

    findReport(id: string): GatheringReport | undefined {
      const row = find(id);
      return row ? toReport(row) : undefined;
    },

    findExhortation(id: string): Exhortation | undefined {
      const row = find(id);
      return row ? toExhortation(row) : undefined;
    },

    /* ------------------------------------------------------- attendance */

    attendanceFor(gatheringIds: string[]): GatheringAttendance[] {
      if (gatheringIds.length === 0) return [];
      const holes = gatheringIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT * FROM gathering_attendance WHERE gathering_id IN (${holes}) ORDER BY created_at`,
        )
        .all(...gatheringIds) as AttendanceRow[];
      return rows.map(toAttendance);
    },

    /**
     * Mark one person at one gathering, replacing any earlier mark.
     *
     * A second mark is a correction, not a second record of the evening, so a
     * person already marked is updated rather than added again. Walk-ins
     * marked by name have no id to collide on and are inserted each time.
     */
    markAttendance(values: {
      gatheringId: string;
      personId?: string | undefined;
      name?: string | undefined;
      status: string;
      expected?: boolean | undefined;
      firstTime?: boolean | undefined;
    }): GatheringAttendance {
      /*
       * A walk-in marked by name is matched on that name. Changing somebody
       * from Present to Absent used to insert a second row for them, because
       * a name had no id to collide on — the correction became a duplicate.
       */
      const existing = values.personId
        ? (db
            .prepare("SELECT * FROM gathering_attendance WHERE gathering_id = ? AND person_id = ?")
            .get(values.gatheringId, values.personId) as AttendanceRow | undefined)
        : values.name
          ? (db
              .prepare(
                "SELECT * FROM gathering_attendance WHERE gathering_id = ? AND person_id IS NULL AND name = ?",
              )
              .get(values.gatheringId, values.name) as AttendanceRow | undefined)
          : undefined;

      if (existing) {
        db.prepare(
          "UPDATE gathering_attendance SET status = ?, expected = ?, first_time = ? WHERE id = ?",
        ).run(values.status, values.expected ? 1 : 0, values.firstTime ? 1 : 0, existing.id);
        return this.findAttendance(existing.id)!;
      }

      const id = newId("ga");
      db.prepare(
        `INSERT INTO gathering_attendance
           (id, gathering_id, person_id, name, status, expected, first_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        values.gatheringId,
        values.personId ?? null,
        values.name ?? null,
        values.status,
        values.expected ? 1 : 0,
        values.firstTime ? 1 : 0,
        nowIso(),
      );
      return this.findAttendance(id)!;
    },

    findAttendance(id: string): GatheringAttendance | undefined {
      const row = db.prepare("SELECT * FROM gathering_attendance WHERE id = ?").get(id) as
        AttendanceRow | undefined;
      return row ? toAttendance(row) : undefined;
    },

    deleteAttendance(id: string): boolean {
      return db.prepare("DELETE FROM gathering_attendance WHERE id = ?").run(id).changes > 0;
    },

    /* ----------------------------------------------------------- entries */

    entriesFor(gatheringIds: string[]): LifegroupEntry[] {
      if (gatheringIds.length === 0) return [];
      const holes = gatheringIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT * FROM lifegroup_entry WHERE gathering_id IN (${holes}) ORDER BY created_at`,
        )
        .all(...gatheringIds) as EntryRow[];
      return rows.map(toEntry);
    },

    findEntry(id: string): LifegroupEntry | undefined {
      const row = db.prepare("SELECT * FROM lifegroup_entry WHERE id = ?").get(id) as
        EntryRow | undefined;
      return row ? toEntry(row) : undefined;
    },

    insertEntry(values: EntryValues, id = newId("le")): LifegroupEntry {
      const at = nowIso();
      db.prepare(
        `INSERT INTO lifegroup_entry
           (id, gathering_id, author_id, body, category, visibility, viewer_ids,
            person_id, assigned_to, due_date, completed, reportable, created_at, updated_at)
         VALUES (@id, @gathering_id, @author_id, @body, @category, @visibility, @viewer_ids,
            @person_id, @assigned_to, @due_date, @completed, @reportable, @created_at, @updated_at)`,
      ).run({
        id,
        gathering_id: values.gatheringId,
        author_id: values.authorId,
        body: values.body,
        category: values.category ?? null,
        visibility: values.visibility ?? null,
        viewer_ids: pack(values.viewerIds),
        person_id: values.personId ?? null,
        assigned_to: values.assignedTo ?? null,
        due_date: values.dueDate ?? null,
        completed: values.completed ? 1 : 0,
        reportable: values.reportable ? 1 : 0,
        created_at: at,
        updated_at: at,
      });
      return this.findEntry(id)!;
    },

    saveEntry(id: string, values: EntryValues): LifegroupEntry | undefined {
      db.prepare(
        `UPDATE lifegroup_entry
            SET body = @body, category = @category, visibility = @visibility,
                viewer_ids = @viewer_ids, person_id = @person_id, assigned_to = @assigned_to,
                due_date = @due_date, completed = @completed, reportable = @reportable,
                updated_at = @updated_at
          WHERE id = @id`,
      ).run({
        id,
        body: values.body,
        category: values.category ?? null,
        visibility: values.visibility ?? null,
        viewer_ids: pack(values.viewerIds),
        person_id: values.personId ?? null,
        assigned_to: values.assignedTo ?? null,
        due_date: values.dueDate ?? null,
        completed: values.completed ? 1 : 0,
        reportable: values.reportable ? 1 : 0,
        updated_at: nowIso(),
      });
      return this.findEntry(id);
    },

    deleteEntry(id: string): boolean {
      return db.prepare("DELETE FROM lifegroup_entry WHERE id = ?").run(id).changes > 0;
    },

    /**
     * Which of these ids are people in the directory.
     *
     * Read here rather than through the organisation repository so the
     * service can refuse a made-up id without being handed a second store.
     */
    knownPeople(ids: string[]): Set<string> {
      if (ids.length === 0) return new Set();
      const holes = ids.map(() => "?").join(", ");
      const rows = db.prepare(`SELECT id FROM person WHERE id IN (${holes})`).all(...ids) as {
        id: string;
      }[];
      return new Set(rows.map((row) => row.id));
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM gathering").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type LifegroupRepository = ReturnType<typeof createLifegroupRepository>;
