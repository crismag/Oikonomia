import type { Database as Db } from "better-sqlite3";

import { meetingNotes, meetingTasks } from "@/test/fixtures";
import { createMeetingRepository } from "@/server/repositories/meeting-repository";
import type { NoteValues } from "@/server/repositories/meeting-repository";

/**
 * Development seed for Meeting Notes.
 *
 * The shipped fixtures, written into an **empty** database once — 68 notes,
 * which is enough to exercise paging, search, the tag filter and the ministry
 * context filter for real rather than in theory (§25).
 *
 * Emptiness is the check, not a flag: reseeding over a leader's own notes would
 * destroy their work. To start again, delete `.data/oikonomia.db`.
 */
export function seedMeetings(db: Db): boolean {
  const repo = createMeetingRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const note of meetingNotes) {
      const { id, createdAt: _created, updatedAt: _updated, ...values } = note;
      /* Keep the fixture ids: other fixtures reference notes by id. */
      repo.insertNote(values as NoteValues, id);
    }
    for (const task of meetingTasks) {
      const { id, ...values } = task;
      repo.insertTask(values, id);
    }
  });

  seed();
  return true;
}
