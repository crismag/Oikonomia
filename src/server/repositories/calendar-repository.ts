import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type { AgendaItem, BinderLink, Recurrence, ScheduleEntry } from "@/domain/types";

/**
 * Calendar rows.
 *
 * Reads and writes, and the translation between a SQLite row and a domain
 * object. **It authorizes nothing** — a repository asked for an entry returns
 * that entry, and the service above it decided the caller may have it. Mixing
 * the two is how a new caller path silently skips a check nobody noticed was
 * inside a query.
 *
 * The connection is passed in rather than imported, so a test can hand it a
 * throwaway database.
 */

/* ------------------------------------------------------------------- rows */

interface EntryRow {
  id: string;
  title: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: number;
  category: string;
  ministry_id: string | null;
  location: string | null;
  meeting_url: string | null;
  note: string | null;
  rec_frequency: string | null;
  rec_weekday: number | null;
  rec_from: string | null;
  rec_until: string | null;
  rec_skip: string | null;
  reminders: string | null;
  tags: string | null;
  participants: string | null;
  related: string | null;
  organizer_id: string | null;
  source: string | null;
  related_work_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AgendaRow {
  id: string;
  text: string;
  date: string | null;
  week_of: string | null;
  completed: number;
  completed_at: string | null;
  category: string | null;
  ministry_id: string | null;
  due_at: string | null;
  assignee_id: string | null;
  related_entry_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/*
 * NULL in SQLite means *absent* in the domain, not `undefined`-valued.
 * `exactOptionalPropertyTypes` makes the difference load-bearing: a key present
 * with the value `undefined` is not the same as no key, and only the second one
 * round-trips cleanly.
 */
const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined ? {} : { [key]: value };

const json = <T>(raw: string | null, key: string) => {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as T;
  return Array.isArray(parsed) && parsed.length === 0 ? {} : { [key]: parsed };
};

const pack = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.length === 0)
    ? null
    : JSON.stringify(value);

function toEntry(row: EntryRow): ScheduleEntry {
  const recurrence: Recurrence | undefined = row.rec_frequency
    ? ({
        frequency: row.rec_frequency,
        from: row.rec_from,
        ...has(row.rec_weekday, "weekday"),
        ...has(row.rec_until, "until"),
        ...json<string[]>(row.rec_skip, "skip"),
      } as Recurrence)
    : undefined;

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    ...has(row.date, "date"),
    ...(recurrence ? { recurrence } : {}),
    ...has(row.start_time, "startTime"),
    ...has(row.end_time, "endTime"),
    ...(row.all_day ? { allDay: true } : {}),
    ...has(row.ministry_id, "ministryId"),
    ...has(row.location, "location"),
    ...has(row.meeting_url, "meetingUrl"),
    ...has(row.note, "note"),
    ...json<string[]>(row.reminders, "reminders"),
    ...json<string[]>(row.tags, "tags"),
    ...json<string[]>(row.participants, "participantIds"),
    ...json<BinderLink[]>(row.related, "related"),
    ...has(row.organizer_id, "organizerId"),
    ...has(row.source, "source"),
    ...has(row.created_by, "createdBy"),
    ...has(row.related_work_id, "relatedWorkId"),
  } as ScheduleEntry;
}

function toAgendaItem(row: AgendaRow): AgendaItem {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed === 1,
    ...has(row.date, "date"),
    ...has(row.week_of, "weekOf"),
    ...has(row.completed_at, "completedAt"),
    ...has(row.category, "category"),
    ...has(row.ministry_id, "ministryId"),
    ...has(row.due_at, "dueAt"),
    ...has(row.assignee_id, "assigneeId"),
    ...has(row.related_entry_id, "relatedEntryId"),
  } as AgendaItem;
}

/* ----------------------------------------------------------------- writes */

/** Everything but the id and the timestamps, which the repository owns. */
export type EntryValues = Writable<Omit<ScheduleEntry, "id">>;
export type AgendaValues = Writable<Omit<AgendaItem, "id" | "completed">> & {
  completed?: boolean | undefined;
};

function entryColumns(values: EntryValues) {
  const r = values.recurrence;
  return {
    title: values.title,
    date: values.date ?? null,
    start_time: values.startTime ?? null,
    end_time: values.endTime ?? null,
    all_day: values.allDay ? 1 : 0,
    category: values.category,
    ministry_id: values.ministryId ?? null,
    location: values.location ?? null,
    meeting_url: values.meetingUrl ?? null,
    note: values.note ?? null,
    rec_frequency: r?.frequency ?? null,
    rec_weekday: r?.weekday ?? null,
    rec_from: r?.from ?? null,
    rec_until: r?.until ?? null,
    rec_skip: pack(r?.skip),
    reminders: pack(values.reminders),
    tags: pack(values.tags),
    participants: pack(values.participantIds),
    related: pack(values.related),
    organizer_id: values.organizerId ?? null,
    source: values.source ?? null,
    related_work_id: values.relatedWorkId ?? null,
    created_by: values.createdBy ?? null,
  };
}

export function createCalendarRepository(db: Db) {
  const entryColumnNames = Object.keys(
    entryColumns({ title: "", category: "other" } as EntryValues),
  );

  const insertEntry = db.prepare(
    `INSERT INTO schedule_entry (id, ${entryColumnNames.join(", ")}, created_at, updated_at)
     VALUES (@id, ${entryColumnNames.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
  );

  const replaceEntry = db.prepare(
    `UPDATE schedule_entry
        SET ${entryColumnNames.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @updated_at
      WHERE id = @id`,
  );

  return {
    /**
     * Every entry that could fall inside a range.
     *
     * One-offs are filtered by date in SQL. Rhythms are returned whole and
     * expanded by `occurrencesOn` in the domain, because a weekly rhythm's
     * dates are computed rather than stored — and because there are a handful
     * of them, not thousands. If that stops being true, this is the line to
     * change, not the calling code.
     */
    entriesInRange(from: string, to: string): ScheduleEntry[] {
      const rows = db
        .prepare(
          `SELECT * FROM schedule_entry
            WHERE (date IS NOT NULL AND date BETWEEN ? AND ?)
               OR (rec_frequency IS NOT NULL
                   AND rec_from <= ?
                   AND (rec_until IS NULL OR rec_until >= ?))
            ORDER BY date IS NULL, date, start_time`,
        )
        .all(from, to, to, from) as EntryRow[];
      return rows.map(toEntry);
    },

    allEntries(): ScheduleEntry[] {
      const rows = db
        .prepare("SELECT * FROM schedule_entry ORDER BY date IS NULL, date, start_time")
        .all() as EntryRow[];
      return rows.map(toEntry);
    },

    findEntry(id: string): ScheduleEntry | undefined {
      const row = db.prepare("SELECT * FROM schedule_entry WHERE id = ?").get(id) as
        EntryRow | undefined;
      return row ? toEntry(row) : undefined;
    },

    insertEntry(values: EntryValues, id = newId("ev")): ScheduleEntry {
      const at = nowIso();
      insertEntry.run({ id, ...entryColumns(values), created_at: at, updated_at: at });
      return this.findEntry(id)!;
    },

    /** Whole-record replace. The service merges the patch and re-validates. */
    saveEntry(id: string, values: EntryValues): ScheduleEntry | undefined {
      replaceEntry.run({ id, ...entryColumns(values), updated_at: nowIso() });
      return this.findEntry(id);
    },

    deleteEntry(id: string): boolean {
      return db.prepare("DELETE FROM schedule_entry WHERE id = ?").run(id).changes > 0;
    },

    /* ------------------------------------------------------------- agenda */

    agendaInRange(from: string, to: string): AgendaItem[] {
      const rows = db
        .prepare(
          `SELECT * FROM agenda_item
            WHERE (date IS NOT NULL AND date BETWEEN ? AND ?)
               OR (week_of IS NOT NULL AND week_of BETWEEN ? AND ?)
            ORDER BY date IS NULL, date, created_at`,
        )
        .all(from, to, from, to) as AgendaRow[];
      return rows.map(toAgendaItem);
    },

    allAgenda(): AgendaItem[] {
      const rows = db
        .prepare("SELECT * FROM agenda_item ORDER BY date IS NULL, date, created_at")
        .all() as AgendaRow[];
      return rows.map(toAgendaItem);
    },

    findAgendaItem(id: string): AgendaItem | undefined {
      const row = db.prepare("SELECT * FROM agenda_item WHERE id = ?").get(id) as
        AgendaRow | undefined;
      return row ? toAgendaItem(row) : undefined;
    },

    insertAgendaItem(values: AgendaValues, id = newId("ag")): AgendaItem {
      const at = nowIso();
      db.prepare(
        `INSERT INTO agenda_item
           (id, text, date, week_of, completed, completed_at, category, ministry_id,
            due_at, assignee_id, related_entry_id, created_by, created_at, updated_at)
         VALUES (@id, @text, @date, @week_of, @completed, @completed_at, @category, @ministry_id,
            @due_at, @assignee_id, @related_entry_id, @created_by, @created_at, @updated_at)`,
      ).run({
        id,
        text: values.text,
        date: values.date ?? null,
        week_of: values.weekOf ?? null,
        completed: values.completed ? 1 : 0,
        completed_at: values.completedAt ?? null,
        category: values.category ?? null,
        ministry_id: values.ministryId ?? null,
        due_at: values.dueAt ?? null,
        assignee_id: values.assigneeId ?? null,
        related_entry_id: values.relatedEntryId ?? null,
        created_by: null,
        created_at: at,
        updated_at: at,
      });
      return this.findAgendaItem(id)!;
    },

    saveAgendaItem(id: string, values: AgendaValues & { completed: boolean }) {
      db.prepare(
        `UPDATE agenda_item
            SET text = @text, date = @date, week_of = @week_of, completed = @completed,
                completed_at = @completed_at, category = @category, ministry_id = @ministry_id,
                due_at = @due_at, assignee_id = @assignee_id, related_entry_id = @related_entry_id,
                updated_at = @updated_at
          WHERE id = @id`,
      ).run({
        id,
        text: values.text,
        date: values.date ?? null,
        week_of: values.weekOf ?? null,
        completed: values.completed ? 1 : 0,
        completed_at: values.completedAt ?? null,
        category: values.category ?? null,
        ministry_id: values.ministryId ?? null,
        due_at: values.dueAt ?? null,
        assignee_id: values.assigneeId ?? null,
        related_entry_id: values.relatedEntryId ?? null,
        updated_at: nowIso(),
      });
      return this.findAgendaItem(id);
    },

    deleteAgendaItem(id: string): boolean {
      return db.prepare("DELETE FROM agenda_item WHERE id = ?").run(id).changes > 0;
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM schedule_entry").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type CalendarRepository = ReturnType<typeof createCalendarRepository>;
