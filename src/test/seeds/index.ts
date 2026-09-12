import type { Database as Db } from "better-sqlite3";

import { seedCalendar } from "./seed-calendar";
import { seedDocuments } from "./seed-documents";
import { seedForms } from "./seed-forms";
import { seedGoals } from "./seed-goals";
import { seedLifegroup } from "./seed-lifegroup";
import { seedMeetings } from "./seed-meetings";
import { seedOrganization } from "./seed-organization";
import { seedReachOut } from "./seed-reach-out";
import { seedReports } from "./seed-reports";
import { seedWork } from "./seed-work";

/**
 * Test fixtures, and **only** test fixtures.
 *
 * These write a narrative data set — people, ministries, meetings, reports,
 * gatherings — into an empty database so that a test can assert against
 * something recognisable. They used to run inside the request path, which made
 * every fresh installation of Oikonomia arrive pre-populated with a fictional
 * church. They no longer run anywhere but a test.
 *
 * The isolation is checked, not merely intended: `src/no-sample-data.test.ts`
 * fails if anything under `routes/`, `components/`, `lib/`, `server/` or the
 * runtime part of `domain/` imports this directory or `@/domain/fixtures`.
 *
 * Each seed writes into an empty table only, so calling them all is cheap and
 * idempotent within one test database.
 */
export function seedAll(db: Db): void {
  seedOrganization(db);
  seedCalendar(db);
  seedMeetings(db);
  seedGoals(db);
  seedLifegroup(db);
  seedReachOut(db);
  seedReports(db);
  seedWork(db);
  seedForms(db);
  seedDocuments(db);
}

export {
  seedCalendar,
  seedOrganization,
  seedDocuments,
  seedForms,
  seedGoals,
  seedLifegroup,
  seedMeetings,
  seedReachOut,
  seedReports,
  seedWork,
};
