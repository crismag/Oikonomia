import type { Database as Db } from "better-sqlite3";

import { newId, nowIso, type Writable } from "../db/records";
import type { AudiencePolicy, BinderLink, Goal, GoalScope, GoalUpdate } from "@/domain/types";

/**
 * Goals rows.
 *
 * Reads, writes, and the row ⇄ domain translation. **It authorizes nothing**:
 * a goal carries an `AudiencePolicy`, and deciding what that means is the
 * service's job — see there for why that decision is not expressed in SQL.
 */

interface GoalRow {
  id: string;
  number: number;
  year: number;
  title: string;
  description: string | null;
  scope: GoalScope;
  ministry_id: string | null;
  group_id: string | null;
  campus_id: string | null;
  owner_id: string | null;
  target_precision: string | null;
  target_value: string | null;
  status: string;
  completed_at: string | null;
  completion_note: string | null;
  hold_since: string | null;
  hold_reason: string | null;
  carried_from_goal_id: string | null;
  links: string | null;
  policy: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface UpdateRow {
  id: string;
  goal_id: string;
  date: string;
  text: string;
  author_id: string | null;
  kind: string;
  created_at: string;
}

const has = <T>(value: T | null | undefined, key: string) =>
  value === null || value === undefined ? {} : { [key]: value };

const list = <T>(raw: string | null): T[] => (raw ? (JSON.parse(raw) as T[]) : []);

const pack = (value: unknown[] | undefined) =>
  value === undefined || value.length === 0 ? null : JSON.stringify(value);

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    number: row.number,
    year: row.year,
    title: row.title,
    scope: row.scope,
    status: row.status,
    version: row.version,
    links: list<BinderLink>(row.links),
    createdAt: row.created_at,
    ...has(row.description, "description"),
    ...has(row.ministry_id, "ministryId"),
    ...has(row.group_id, "groupId"),
    ...has(row.campus_id, "campusId"),
    ...has(row.owner_id, "ownerId"),
    ...(row.target_precision && row.target_value
      ? { target: { precision: row.target_precision, value: row.target_value } }
      : {}),
    ...has(row.completed_at, "completedAt"),
    ...has(row.completion_note, "completionNote"),
    ...has(row.hold_since, "holdSince"),
    ...has(row.hold_reason, "holdReason"),
    ...has(row.carried_from_goal_id, "carriedFromGoalId"),
    ...(row.policy ? { policy: JSON.parse(row.policy) as AudiencePolicy } : {}),
  } as Goal;
}

function toUpdate(row: UpdateRow): GoalUpdate {
  return {
    id: row.id,
    goalId: row.goal_id,
    date: row.date,
    text: row.text,
    kind: row.kind,
    ...has(row.author_id, "authorId"),
  } as GoalUpdate;
}

export type GoalValues = Writable<Omit<Goal, "id" | "createdAt" | "version">>;
export type UpdateValues = Writable<Omit<GoalUpdate, "id">>;

function goalColumns(values: GoalValues) {
  return {
    number: values.number,
    year: values.year,
    title: values.title,
    description: values.description ?? null,
    scope: values.scope,
    ministry_id: values.ministryId ?? null,
    group_id: values.groupId ?? null,
    campus_id: values.campusId ?? null,
    owner_id: values.ownerId ?? null,
    target_precision: values.target?.precision ?? null,
    target_value: values.target?.value ?? null,
    status: values.status,
    completed_at: values.completedAt ?? null,
    completion_note: values.completionNote ?? null,
    hold_since: values.holdSince ?? null,
    hold_reason: values.holdReason ?? null,
    carried_from_goal_id: values.carriedFromGoalId ?? null,
    links: pack(values.links),
    policy: values.policy ? JSON.stringify(values.policy) : null,
  };
}

export function createGoalsRepository(db: Db) {
  const columns = Object.keys(
    goalColumns({
      number: 0,
      year: 0,
      title: "",
      scope: "personal",
      status: "active",
    } as GoalValues),
  );

  const insert = db.prepare(
    `INSERT INTO goal (id, ${columns.join(", ")}, created_at, updated_at)
     VALUES (@id, ${columns.map((c) => `@${c}`).join(", ")}, @created_at, @updated_at)`,
  );

  /* The version is part of the WHERE when a caller states one, so the check
     and the write are one statement. */
  const replace = db.prepare(
    `UPDATE goal SET ${columns.map((c) => `${c} = @${c}`).join(", ")},
            updated_at = @updated_at, version = version + 1
      WHERE id = @id AND (@version IS NULL OR version = @version)`,
  );

  return {
    /** A year of goals, in the binder's own order. */
    goalsForYear(year: number): Goal[] {
      const rows = db
        .prepare("SELECT * FROM goal WHERE year = ? ORDER BY number")
        .all(year) as GoalRow[];
      return rows.map(toGoal);
    },

    /** Every year that has a goal in it, newest first. */
    years(): number[] {
      const rows = db.prepare("SELECT DISTINCT year FROM goal ORDER BY year DESC").all() as {
        year: number;
      }[];
      return rows.map((row) => row.year);
    },

    findGoal(id: string): Goal | undefined {
      const row = db.prepare("SELECT * FROM goal WHERE id = ?").get(id) as GoalRow | undefined;
      return row ? toGoal(row) : undefined;
    },

    /**
     * The next free position in a year.
     *
     * Computed at insert time inside the same transaction as the insert, so
     * two goals created at once cannot claim the same number — and the UNIQUE
     * constraint refuses it if they somehow do.
     */
    nextNumber(year: number): number {
      const row = db
        .prepare("SELECT MAX(number) AS highest FROM goal WHERE year = ?")
        .get(year) as { highest: number | null };
      return (row.highest ?? 0) + 1;
    },

    /**
     * Add a goal, giving it the next free position in its year.
     *
     * The number is chosen inside the same transaction as the insert, so two
     * goals created at once cannot claim the same one — and the UNIQUE
     * constraint refuses it if they somehow do. A caller may state a number
     * instead, which only the development seed does: a fixture's "01" is part
     * of what the fixture says.
     */
    insertGoal(values: Omit<GoalValues, "number"> & { number?: number }, id = newId("goal")): Goal {
      const at = nowIso();
      const create = db.transaction(() => {
        const number = values.number ?? this.nextNumber(values.year);
        insert.run({
          id,
          ...goalColumns({ ...values, number } as GoalValues),
          created_at: at,
          updated_at: at,
        });
      });
      create();
      return this.findGoal(id)!;
    },

    /**
     * Save, if nobody else has saved since the stated version.
     *
     * `"stale"` means somebody else moved it on; `undefined` means it is gone.
     * No version keeps the old last-writer behaviour.
     */
    saveGoal(id: string, values: GoalValues, version?: number): Goal | "stale" | undefined {
      const result = replace.run({
        id,
        ...goalColumns(values),
        updated_at: nowIso(),
        version: version ?? null,
      });
      if (result.changes === 0) return this.findGoal(id) ? "stale" : undefined;
      return this.findGoal(id);
    },

    deleteGoal(id: string): boolean {
      /* Updates go with it — ON DELETE CASCADE. They describe nothing else. */
      return db.prepare("DELETE FROM goal WHERE id = ?").run(id).changes > 0;
    },

    /* ----------------------------------------------------------- updates */

    updatesFor(goalIds: string[]): GoalUpdate[] {
      if (goalIds.length === 0) return [];
      const holes = goalIds.map(() => "?").join(", ");
      const rows = db
        .prepare(`SELECT * FROM goal_update WHERE goal_id IN (${holes}) ORDER BY date DESC`)
        .all(...goalIds) as UpdateRow[];
      return rows.map(toUpdate);
    },

    insertUpdate(values: UpdateValues, id = newId("gu")): GoalUpdate {
      db.prepare(
        `INSERT INTO goal_update (id, goal_id, date, text, author_id, kind, created_at)
         VALUES (@id, @goal_id, @date, @text, @author_id, @kind, @created_at)`,
      ).run({
        id,
        goal_id: values.goalId,
        date: values.date,
        text: values.text,
        author_id: values.authorId ?? null,
        kind: values.kind ?? "note",
        created_at: nowIso(),
      });
      return this.findUpdate(id)!;
    },

    findUpdate(id: string): GoalUpdate | undefined {
      const row = db.prepare("SELECT * FROM goal_update WHERE id = ?").get(id) as
        UpdateRow | undefined;
      return row ? toUpdate(row) : undefined;
    },

    /** Used only by the development seed. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM goal").get() as { n: number };
      return row.n === 0;
    },
  };
}

export type GoalsRepository = ReturnType<typeof createGoalsRepository>;
