import type { Assignment, AssignmentScope, AssignmentStatus } from "@/domain/assignment";
import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";
import type {
  Campus,
  Ministry,
  Person,
  PersonaId,
  ResponsibilityGroup,
  Venue,
  VenueType,
} from "@/domain/types";

/**
 * The organisation, as records.
 *
 * People, campuses, ministries and venues used to be compiled into the
 * application as fixtures; every other module referred to them, so an
 * installation nobody had set up still displayed a church. They are stored
 * now, which means a new installation has none of them and every page has to
 * be able to say so.
 *
 * Reads are unfiltered: a directory of who exists and which ministries there
 * are is not confidential material, and the access rules that matter apply to
 * *content* — reports, entries, notes — not to the fact that a ministry
 * exists. Writing is another question, and it belongs to the service.
 */

interface PersonRow {
  id: string;
  created_at: string;
  reports_to_id: string | null;
  name: string;
  initials: string;
  role: string;
  access_role: PersonaId;
  email: string | null;
  campus_id: string | null;
  active: number;
}

interface MinistryRow {
  id: string;
  name: string;
  purpose: string;
  campus_id: string | null;
  lead_id: string | null;
  active: number;
}

interface GroupRow {
  id: string;
  name: string;
  description: string;
  campus_id: string | null;
  leadership_audience: number;
  active: number;
  group_type: string;
  parent_group_id: string | null;
}

interface VenueRow {
  id: string;
  name: string;
  type: VenueType;
  host_id: string | null;
  campus_id: string | null;
  area: string | null;
  address: string | null;
  notes: string | null;
}

/** `Person` carries the ids of the ministries it belongs to, which is a join. */
export interface PersonRecord extends Person {
  accessRole: PersonaId;
  email?: string;
  /**
   * Who they report to, when the church has said.
   *
   * Unset by default. "My reporting leader" resolves through this, and an
   * unset one resolves to nobody rather than to a guess — inventing a
   * reporting line is inventing an organisation.
   */
  reportsToId?: string;
  /** ISO date they were entered. Nothing is owed from before it. */
  joinedAt: string;
}

export interface PersonValues {
  name: string;
  reportsToId?: string | undefined;
  role?: string | undefined;
  accessRole?: PersonaId | undefined;
  email?: string | undefined;
  campusId?: string | undefined;
  /** Still part of this church. Absent on a patch leaves it as it stands. */
  active?: boolean | undefined;
}

/** A patch may name a field in order to clear it, which `Partial` cannot say. */
export type PersonPatch = { [K in keyof PersonValues]?: PersonValues[K] | undefined };
export type MinistryPatch = { [K in keyof MinistryValues]?: MinistryValues[K] | undefined };

export interface MinistryValues {
  name: string;
  purpose?: string | undefined;
  campusId?: string | undefined;
  leadId?: string | undefined;
  /** Still running. Absent on a patch leaves it as it stands. */
  active?: boolean | undefined;
}

export interface VenueValues {
  name: string;
  type?: VenueType | undefined;
  hostId?: string | undefined;
  campusId?: string | undefined;
  area?: string | undefined;
  address?: string | undefined;
  notes?: string | undefined;
}

/** "Maria Santos" → "MS". Two letters, because avatars are small. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function createOrganizationRepository(db: Db) {
  const membershipsFor = (personIds: string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    if (personIds.length === 0) return out;
    const holes = personIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        /* `status = 'confirmed'` is load-bearing. `access.ts` reads the list
           this builds, so a claim somebody made about themselves during
           onboarding would otherwise become membership — and membership opens
           a ministry's information. A claim waits for somebody to confirm it. */
        `SELECT ministry_id, person_id FROM ministry_member
          WHERE person_id IN (${holes}) AND shared = 0 AND status = 'confirmed'`,
      )
      .all(...personIds) as { ministry_id: string; person_id: string }[];
    for (const row of rows) {
      out.set(row.person_id, [...(out.get(row.person_id) ?? []), row.ministry_id]);
    }
    return out;
  };

  const groupsOf = (personIds: string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    if (personIds.length === 0) return out;
    const holes = personIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        /* Confirmed only — `access.ts` reads this list. */
        `SELECT group_id, person_id FROM responsibility_group_member
          WHERE person_id IN (${holes}) AND status = 'confirmed'`,
      )
      .all(...personIds) as { group_id: string; person_id: string }[];
    for (const row of rows) {
      out.set(row.person_id, [...(out.get(row.person_id) ?? []), row.group_id]);
    }
    return out;
  };

  const memberIdsOfGroup = (groupId: string): string[] =>
    (
      db
        .prepare(
          /* Confirmed only: a group's membership decides who a report set to
             the leadership audience reaches. */
          `SELECT person_id FROM responsibility_group_member
            WHERE group_id = ? AND status = 'confirmed' ORDER BY created_at`,
        )
        .all(groupId) as { person_id: string }[]
    ).map((row) => row.person_id);

  const toGroup = (row: GroupRow): ResponsibilityGroup => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ...(row.campus_id ? { campusId: row.campus_id } : {}),
    leadershipAudience: row.leadership_audience === 1,
    active: row.active === 1,
    memberIds: memberIdsOfGroup(row.id),
    groupType: row.group_type,
    ...(row.parent_group_id ? { parentGroupId: row.parent_group_id } : {}),
  });

  const toPerson = (
    row: PersonRow,
    ministryIds: string[],
    groupIds: string[] = [],
  ): PersonRecord => ({
    id: row.id,
    joinedAt: (row.created_at ?? "").slice(0, 10),
    groupIds,
    ...(row.reports_to_id ? { reportsToId: row.reports_to_id } : {}),
    name: row.name,
    initials: row.initials,
    role: row.role,
    campusId: row.campus_id ?? "",
    ministryIds,
    accessRole: row.access_role,
    ...(row.email ? { email: row.email } : {}),
    active: row.active !== 0,
  });

  const memberIds = (ministryId: string, shared: boolean): string[] =>
    (
      db
        .prepare(
          `SELECT person_id FROM ministry_member
            WHERE ministry_id = ? AND shared = ? AND status = 'confirmed'
            ORDER BY created_at`,
        )
        .all(ministryId, shared ? 1 : 0) as { person_id: string }[]
    ).map((row) => row.person_id);

  const toMinistry = (row: MinistryRow): Ministry => {
    const shared = memberIds(row.id, true);
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      campusId: row.campus_id ?? "",
      leadId: row.lead_id ?? "",
      teamIds: memberIds(row.id, false),
      ...(shared.length > 0 ? { sharedWithIds: shared } : {}),
      active: row.active !== 0,
    };
  };

  const toVenue = (row: VenueRow): Venue => ({
    id: row.id,
    name: row.name,
    type: row.type,
    ...(row.host_id ? { hostId: row.host_id } : {}),
    ...(row.campus_id ? { campusId: row.campus_id } : {}),
    ...(row.area ? { area: row.area } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  });

  return {
    /* ------------------------------------------------------------ reading */

    campuses(): Campus[] {
      const rows = db.prepare("SELECT * FROM campus ORDER BY name").all() as {
        id: string;
        name: string;
        city: string;
        active: number;
      }[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        active: row.active !== 0,
      }));
    },

    /**
     * Rename a campus, or stop offering it.
     *
     * There was no way to change a campus at all, which made a typo in the
     * name permanent and a closed campus a choice forever.
     */
    updateCampus(
      id: string,
      values: {
        name?: string | undefined;
        city?: string | undefined;
        active?: boolean | undefined;
      },
    ): Campus | undefined {
      const current = this.campuses().find((campus) => campus.id === id);
      if (!current) return undefined;
      db.prepare(
        "UPDATE campus SET name = @name, city = @city, active = @active WHERE id = @id",
      ).run({
        id,
        name: values.name ?? current.name,
        city: "city" in values ? (values.city ?? null) : current.city || null,
        active: (values.active ?? current.active !== false) ? 1 : 0,
      });
      return this.campuses().find((campus) => campus.id === id);
    },

    people(): PersonRecord[] {
      const rows = db.prepare("SELECT * FROM person ORDER BY name").all() as PersonRow[];
      const ids = rows.map((row) => row.id);
      const memberships = membershipsFor(ids);
      const groups = groupsOf(ids);
      return rows.map((row) =>
        toPerson(row, memberships.get(row.id) ?? [], groups.get(row.id) ?? []),
      );
    },

    findPerson(id: string): PersonRecord | undefined {
      const row = db.prepare("SELECT * FROM person WHERE id = ?").get(id) as PersonRow | undefined;
      if (!row) return undefined;
      return toPerson(
        row,
        membershipsFor([row.id]).get(row.id) ?? [],
        groupsOf([row.id]).get(row.id) ?? [],
      );
    },

    findPersonByEmail(email: string): PersonRecord | undefined {
      const row = db.prepare("SELECT * FROM person WHERE email = ?").get(email) as
        PersonRow | undefined;
      if (!row) return undefined;
      return toPerson(row, membershipsFor([row.id]).get(row.id) ?? []);
    },

    ministries(): Ministry[] {
      const rows = db.prepare("SELECT * FROM ministry ORDER BY name").all() as MinistryRow[];
      return rows.map(toMinistry);
    },

    venues(): Venue[] {
      const rows = db.prepare("SELECT * FROM venue ORDER BY name").all() as VenueRow[];
      return rows.map(toVenue);
    },

    /** Whether anybody has been added at all. The bootstrap turns on this. */
    isEmpty(): boolean {
      const row = db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number };
      return row.n === 0;
    },

    /* ------------------------------------------------- responsibility groups */

    groups(): ResponsibilityGroup[] {
      const rows = db
        .prepare("SELECT * FROM responsibility_group ORDER BY name")
        .all() as GroupRow[];
      return rows.map(toGroup);
    },

    findGroup(id: string): ResponsibilityGroup | undefined {
      const row = db.prepare("SELECT * FROM responsibility_group WHERE id = ?").get(id) as
        GroupRow | undefined;
      return row ? toGroup(row) : undefined;
    },

    /**
     * The groups a report set to the leadership audience reaches.
     *
     * A property of the groups themselves, so a church may have one leadership
     * body or several. **A church that has marked none has no leadership
     * audience**, and a report set to it reaches only its author — which is the
     * safe direction for a list that resolves to nobody.
     */
    leadershipGroupIds(): string[] {
      const rows = db
        .prepare("SELECT id FROM responsibility_group WHERE leadership_audience = 1 AND active = 1")
        .all() as { id: string }[];
      return rows.map((row) => row.id);
    },

    insertGroup(values: {
      name: string;
      description?: string | undefined;
      campusId?: string | undefined;
      leadershipAudience?: boolean | undefined;
      groupType?: string | undefined;
      parentGroupId?: string | undefined;
    }): ResponsibilityGroup {
      const id = newId("grp");
      db.prepare(
        `INSERT INTO responsibility_group
           (id, name, description, campus_id, leadership_audience, active, created_at,
            group_type, parent_group_id)
         VALUES (@id, @name, @description, @campusId, @leadership, 1, @at, @type, @parent)`,
      ).run({
        id,
        name: values.name,
        description: values.description ?? "",
        campusId: values.campusId ?? null,
        leadership: values.leadershipAudience ? 1 : 0,
        at: nowIso(),
        type: values.groupType ?? "team",
        parent: values.parentGroupId ?? null,
      });
      return this.findGroup(id)!;
    },

    updateGroup(
      id: string,
      values: {
        name?: string | undefined;
        description?: string | undefined;
        leadershipAudience?: boolean | undefined;
        active?: boolean | undefined;
        groupType?: string | undefined;
        parentGroupId?: string | undefined;
      },
    ): ResponsibilityGroup | undefined {
      const current = this.findGroup(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE responsibility_group
            SET name = @name, description = @description,
                leadership_audience = @leadership, active = @active,
                group_type = @type, parent_group_id = @parent
          WHERE id = @id`,
      ).run({
        id,
        name: values.name ?? current.name,
        description: values.description ?? current.description,
        leadership: (values.leadershipAudience ?? current.leadershipAudience) ? 1 : 0,
        active: (values.active ?? current.active) ? 1 : 0,
        type: values.groupType ?? current.groupType,
        parent:
          "parentGroupId" in values
            ? (values.parentGroupId ?? null)
            : (current.parentGroupId ?? null),
      });
      return this.findGroup(id);
    },

    setGroupMembership(groupId: string, personId: string, member: boolean): void {
      if (member) {
        db.prepare(
          `INSERT OR IGNORE INTO responsibility_group_member (group_id, person_id, created_at)
           VALUES (?, ?, ?)`,
        ).run(groupId, personId, nowIso());
        return;
      }
      db.prepare(
        "DELETE FROM responsibility_group_member WHERE group_id = ? AND person_id = ?",
      ).run(groupId, personId);
    },

    /* ------------------------------------------------------------ writing */

    insertCampus(values: { name: string; city?: string | undefined }): Campus {
      const campus: Campus = {
        id: newId("cmp"),
        name: values.name,
        city: values.city ?? "",
      };
      db.prepare(
        "INSERT INTO campus (id, name, city, created_at) VALUES (@id, @name, @city, @at)",
      ).run({ ...campus, at: nowIso() });
      return campus;
    },

    insertPerson(values: PersonValues): PersonRecord {
      const id = newId("per");
      db.prepare(
        `INSERT INTO person (id, name, initials, role, access_role, email, campus_id,
                             reports_to_id, created_at)
         VALUES (@id, @name, @initials, @role, @accessRole, @email, @campusId,
                 @reportsTo, @at)`,
      ).run({
        id,
        name: values.name,
        initials: initialsOf(values.name),
        role: values.role ?? "",
        accessRole: values.accessRole ?? "leader",
        email: values.email ?? null,
        campusId: values.campusId ?? null,
        reportsTo: values.reportsToId ?? null,
        at: nowIso(),
      });
      return this.findPerson(id)!;
    },

    updatePerson(id: string, values: PersonPatch): PersonRecord | undefined {
      const current = this.findPerson(id);
      if (!current) return undefined;
      db.prepare(
        `UPDATE person SET name = @name, initials = @initials, role = @role,
                           access_role = @accessRole, campus_id = @campusId,
                           reports_to_id = @reportsTo, email = @email,
                           active = @active
          WHERE id = @id`,
      ).run({
        id,
        name: values.name ?? current.name,
        initials: initialsOf(values.name ?? current.name),
        role: values.role ?? current.role,
        accessRole: values.accessRole ?? current.accessRole,
        campusId: "campusId" in values ? (values.campusId ?? null) : current.campusId || null,
        reportsTo:
          "reportsToId" in values ? (values.reportsToId ?? null) : (current.reportsToId ?? null),
        /* `email` was missing from this statement, so an address sent to the
           update path was validated, checked for collisions, answered with
           success — and dropped. Present in the patch means change it;
           absent means leave it alone. */
        email: "email" in values ? (values.email ?? null) : (current.email ?? null),
        active: (values.active ?? current.active !== false) ? 1 : 0,
      });
      return this.findPerson(id);
    },

    insertMinistry(values: MinistryValues): Ministry {
      const id = newId("min");
      db.prepare(
        `INSERT INTO ministry (id, name, purpose, campus_id, lead_id, created_at)
         VALUES (@id, @name, @purpose, @campusId, @leadId, @at)`,
      ).run({
        id,
        name: values.name,
        purpose: values.purpose ?? "",
        campusId: values.campusId ?? null,
        leadId: values.leadId ?? null,
        at: nowIso(),
      });
      /* Leading a ministry is being on it. Nothing else has to remember to. */
      if (values.leadId) this.addMember(id, values.leadId, false);
      return this.findMinistry(id)!;
    },

    findMinistry(id: string): Ministry | undefined {
      const row = db.prepare("SELECT * FROM ministry WHERE id = ?").get(id) as
        MinistryRow | undefined;
      return row ? toMinistry(row) : undefined;
    },

    updateMinistry(id: string, values: MinistryPatch): Ministry | undefined {
      const current = this.findMinistry(id);
      if (!current) return undefined;
      db.prepare(
        `UPDATE ministry SET name = @name, purpose = @purpose, campus_id = @campusId,
                             lead_id = @leadId, active = @active
          WHERE id = @id`,
      ).run({
        id,
        name: values.name ?? current.name,
        purpose: values.purpose ?? current.purpose,
        campusId: "campusId" in values ? (values.campusId ?? null) : current.campusId || null,
        leadId: "leadId" in values ? (values.leadId ?? null) : current.leadId || null,
        active: (values.active ?? current.active !== false) ? 1 : 0,
      });
      if (values.leadId) this.addMember(id, values.leadId, false);
      return this.findMinistry(id);
    },

    addMember(ministryId: string, personId: string, shared: boolean): void {
      db.prepare(
        `INSERT INTO ministry_member (ministry_id, person_id, shared, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (ministry_id, person_id) DO UPDATE SET shared = excluded.shared`,
      ).run(ministryId, personId, shared ? 1 : 0, nowIso());
    },

    removeMember(ministryId: string, personId: string): void {
      db.prepare("DELETE FROM ministry_member WHERE ministry_id = ? AND person_id = ?").run(
        ministryId,
        personId,
      );
    },

    /* ------------------------------------------------------- assignments */

    /**
     * Everywhere one person is assigned, whatever its state.
     *
     * Unions the two membership tables, because a ministry and a responsibility
     * group are different entities that a person relates to in the same way.
     * This is the single authoritative answer to "where does this person
     * serve" — the lists on `Person` are the narrower question "where are they
     * **confirmed**", which is what authorization reads.
     */
    assignmentsFor(personId: string): Assignment[] {
      const ministries = db
        .prepare(
          `SELECT ministry_id, function, status, started_at, ended_at, shared
             FROM ministry_member WHERE person_id = ? ORDER BY created_at`,
        )
        .all(personId) as {
        ministry_id: string;
        function: string;
        status: string;
        started_at: string | null;
        ended_at: string | null;
        shared: number;
      }[];

      const groups = db
        .prepare(
          `SELECT group_id, function, status, started_at, ended_at
             FROM responsibility_group_member WHERE person_id = ? ORDER BY created_at`,
        )
        .all(personId) as {
        group_id: string;
        function: string;
        status: string;
        started_at: string | null;
        ended_at: string | null;
      }[];

      return [
        ...ministries.map((row): Assignment => ({
          scope: "ministry",
          targetId: row.ministry_id,
          personId,
          function: row.function,
          status: row.status as Assignment["status"],
          ...(row.started_at ? { startedAt: row.started_at } : {}),
          ...(row.ended_at ? { endedAt: row.ended_at } : {}),
          shared: row.shared === 1,
        })),
        ...groups.map((row): Assignment => ({
          scope: "group",
          targetId: row.group_id,
          personId,
          function: row.function,
          status: row.status as Assignment["status"],
          ...(row.started_at ? { startedAt: row.started_at } : {}),
          ...(row.ended_at ? { endedAt: row.ended_at } : {}),
        })),
      ];
    },

    /** Everything anybody is waiting on a decision about. */
    assignmentsAwaitingDecision(): (Assignment & { personId: string })[] {
      const ministries = db
        .prepare(
          `SELECT ministry_id, person_id, function, status FROM ministry_member
            WHERE status IN ('pending', 'correction-requested')`,
        )
        .all() as { ministry_id: string; person_id: string; function: string; status: string }[];

      const groups = db
        .prepare(
          `SELECT group_id, person_id, function, status FROM responsibility_group_member
            WHERE status IN ('pending', 'correction-requested')`,
        )
        .all() as { group_id: string; person_id: string; function: string; status: string }[];

      return [
        ...ministries.map((row) => ({
          scope: "ministry" as const,
          targetId: row.ministry_id,
          personId: row.person_id,
          function: row.function,
          status: row.status as Assignment["status"],
        })),
        ...groups.map((row) => ({
          scope: "group" as const,
          targetId: row.group_id,
          personId: row.person_id,
          function: row.function,
          status: row.status as Assignment["status"],
        })),
      ];
    },

    /**
     * Write one assignment.
     *
     * Upserts on the pair, so the same call confirms a claim, changes a
     * function, or ends an assignment — and so running onboarding twice cannot
     * produce two of anything.
     */
    setAssignment(values: {
      scope: AssignmentScope;
      targetId: string;
      personId: string;
      function?: string | undefined;
      status: AssignmentStatus;
      shared?: boolean | undefined;
      at?: string | undefined;
    }): void {
      const at = values.at ?? nowIso();
      const ended = values.status === "ended" ? at.slice(0, 10) : null;

      if (values.scope === "ministry") {
        db.prepare(
          `INSERT INTO ministry_member
             (ministry_id, person_id, shared, created_at, function, status, started_at, ended_at)
           VALUES (@target, @person, @shared, @at, @fn, @status, @started, @ended)
           ON CONFLICT (ministry_id, person_id) DO UPDATE SET
             shared = excluded.shared,
             function = excluded.function,
             status = excluded.status,
             ended_at = excluded.ended_at`,
        ).run({
          target: values.targetId,
          person: values.personId,
          shared: values.shared ? 1 : 0,
          at,
          fn: values.function ?? "",
          status: values.status,
          started: at.slice(0, 10),
          ended,
        });
        return;
      }

      db.prepare(
        `INSERT INTO responsibility_group_member
           (group_id, person_id, created_at, function, status, started_at, ended_at)
         VALUES (@target, @person, @at, @fn, @status, @started, @ended)
         ON CONFLICT (group_id, person_id) DO UPDATE SET
           function = excluded.function,
           status = excluded.status,
           ended_at = excluded.ended_at`,
      ).run({
        target: values.targetId,
        person: values.personId,
        at,
        fn: values.function ?? "",
        status: values.status,
        started: at.slice(0, 10),
        ended,
      });
    },

    findAssignment(
      scope: AssignmentScope,
      targetId: string,
      personId: string,
    ): Assignment | undefined {
      return this.assignmentsFor(personId).find(
        (assignment) => assignment.scope === scope && assignment.targetId === targetId,
      );
    },

    insertVenue(values: VenueValues): Venue {
      const id = newId("ven");
      db.prepare(
        `INSERT INTO venue (id, name, type, host_id, campus_id, area, address, notes, created_at)
         VALUES (@id, @name, @type, @hostId, @campusId, @area, @address, @notes, @at)`,
      ).run({
        id,
        name: values.name,
        type: values.type ?? "other",
        hostId: values.hostId ?? null,
        campusId: values.campusId ?? null,
        area: values.area ?? null,
        address: values.address ?? null,
        notes: values.notes ?? null,
        at: nowIso(),
      });
      return this.findVenue(id)!;
    },

    findVenue(id: string): Venue | undefined {
      const row = db.prepare("SELECT * FROM venue WHERE id = ?").get(id) as VenueRow | undefined;
      return row ? toVenue(row) : undefined;
    },
  };
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
