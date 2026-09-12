import type { Database as Db } from "better-sqlite3";

import {
  exhortations,
  gatheringAttendance,
  gatheringReports,
  gatherings,
  lifegroupEntries,
} from "@/test/fixtures";
import { statusForLeaders } from "@/domain/lifegroup";
import { createLifegroupRepository } from "@/server/repositories/lifegroup-repository";
import type { EntryValues, GatheringValues } from "@/server/repositories/lifegroup-repository";

/**
 * Development seed for LifeGroup.
 *
 * The shipped fixtures carry the cases worth having: gatherings at four
 * venues, attendance that includes a walk-in marked by name, and entries at
 * every visibility — including a private one, so the filter is exercised
 * rather than assumed.
 *
 * Written into an **empty** database only. To start again, delete
 * `.data/oikonomia.db`.
 */
export function seedLifegroup(db: Db): boolean {
  const repo = createLifegroupRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const gathering of gatherings) {
      const { id, ...values } = gathering;
      /*
       * The stage follows from who is on the row, here as everywhere else. The
       * fixtures predate the schedule stages and say "planned" for rows that
       * already have leaders — seeding that verbatim made the roster claim a
       * gathering needed a leader while naming the two leading it.
       */
      repo.insertGathering(
        {
          ...values,
          status: statusForLeaders(values.status, values.assignedLeaderIds ?? []),
        } as GatheringValues,
        id,
      );
    }

    /* Exhortation and report live on the gathering row. */
    for (const exhortation of exhortations) {
      const { gatheringId, ...value } = exhortation;
      repo.setExhortation(gatheringId, value);
    }
    for (const report of gatheringReports) {
      const { gatheringId, ...value } = report;
      repo.setReport(gatheringId, value);
    }

    for (const mark of gatheringAttendance) {
      const { id: _id, ...values } = mark;
      repo.markAttendance(values);
    }
    for (const entry of lifegroupEntries) {
      const { id, createdAt: _created, ...values } = entry;
      repo.insertEntry(values as EntryValues, id);
    }
  });

  seed();
  return true;
}
