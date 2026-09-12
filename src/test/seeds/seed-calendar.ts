import type { Database as Db } from "better-sqlite3";

import { agendaItems, scheduleEntries } from "@/test/fixtures";
import { createCalendarRepository } from "@/server/repositories/calendar-repository";
import type { EntryValues } from "@/server/repositories/calendar-repository";

/**
 * Development seed.
 *
 * §25: provide realistic development data and do not depend entirely on
 * hard-coded component fixtures. The narrative fixtures are already realistic —
 * a weekly Worship Service, Prayer & Fasting with no clock time, CHAT on a
 * Friday, a Lifegroup rhythm — so the seed *is* those fixtures, written into
 * the database once. What changes is that they are now records a leader can
 * edit and delete, rather than an array the UI reads.
 *
 * **Runs only into an empty database.** Reseeding over a leader's own entries
 * would destroy their work, so the check is emptiness, not a flag. To start
 * again, delete `.data/oikonomia.db` (or set `OIKONOMIA_DB` elsewhere) — the
 * migrations rebuild the schema and this refills it.
 *
 * Seed data is development behaviour and is kept out of the service layer on
 * purpose: nothing in production should call this.
 */
export function seedCalendar(db: Db): boolean {
  const repo = createCalendarRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const entry of scheduleEntries) {
      const { id, ...values } = entry;
      /* Keep the fixture ids: other fixtures reference them by id. */
      repo.insertEntry(values as EntryValues, id);
    }
    for (const item of agendaItems) {
      const { id, completed, ...values } = item;
      repo.insertAgendaItem({ ...values, completed }, id);
    }
  });

  seed();
  return true;
}
