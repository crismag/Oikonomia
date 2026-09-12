import type { Database as Db } from "better-sqlite3";

import { campuses, groups, ministries, people, venues } from "@/test/fixtures";
import { nowIso } from "@/server/db/records";

/**
 * The narrative organisation, for tests.
 *
 * Writes the fixture church — its campuses, its ministries, its ninety-one
 * people and the homes they meet in — into the organisation tables, keeping
 * the fixture ids so that every other seed's foreign keys line up.
 *
 * **Test-only.** The application never calls this. A real installation starts
 * with nobody in it and the first person is entered by whoever is setting it
 * up; see `organization-service.ts`.
 */
export function seedOrganization(db: Db): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number };
  if (count.n > 0) return;

  const at = nowIso();

  const insertCampus = db.prepare(
    "INSERT INTO campus (id, name, city, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const campus of campuses) insertCampus.run(campus.id, campus.name, campus.city, at);

  /* The fixture people carry a persona-shaped role in prose ("LifeGroup
     leader"); the access role is assigned from the four the product defines. */
  const accessRoleFor = (id: string): string =>
    id === "p-bishop"
      ? "bishop"
      : id === "p-admin"
        ? "admin"
        : id === "p-joel"
          ? "ministry-head"
          : "leader";

  const insertPerson = db.prepare(
    `INSERT INTO person (id, name, initials, role, access_role, email, campus_id, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  );
  for (const person of people) {
    insertPerson.run(
      person.id,
      person.name,
      person.initials,
      person.role,
      accessRoleFor(person.id),
      person.campusId || null,
      at,
    );
  }

  const insertMinistry = db.prepare(
    `INSERT INTO ministry (id, name, purpose, campus_id, lead_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO ministry_member (ministry_id, person_id, shared, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const ministry of ministries) {
    insertMinistry.run(
      ministry.id,
      ministry.name,
      ministry.purpose,
      ministry.campusId || null,
      ministry.leadId || null,
      at,
    );
    for (const personId of ministry.teamIds) insertMember.run(ministry.id, personId, 0, at);
    for (const personId of ministry.sharedWithIds ?? [])
      insertMember.run(ministry.id, personId, 1, at);
  }

  const insertGroup = db.prepare(
    `INSERT INTO responsibility_group
       (id, name, description, campus_id, leadership_audience, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );
  const insertGroupMember = db.prepare(
    `INSERT OR IGNORE INTO responsibility_group_member (group_id, person_id, created_at)
     VALUES (?, ?, ?)`,
  );
  for (const group of groups) {
    insertGroup.run(
      group.id,
      group.name,
      group.description,
      group.campusId ?? null,
      group.leadershipAudience ? 1 : 0,
      at,
    );
    for (const personId of group.memberIds) insertGroupMember.run(group.id, personId, at);
  }

  const insertVenue = db.prepare(
    `INSERT INTO venue (id, name, type, host_id, campus_id, area, address, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const venue of venues) {
    insertVenue.run(
      venue.id,
      venue.name,
      venue.type,
      venue.hostId ?? null,
      venue.campusId ?? null,
      venue.area ?? null,
      venue.address ?? null,
      venue.notes ?? null,
      at,
    );
  }
}
