import type { Database as Db } from "better-sqlite3";

import { leadershipReports } from "@/test/fixtures";
import { createLeadershipReportRepository } from "@/server/repositories/leadership-report-repository";
import type { ReportValues } from "@/server/repositories/leadership-report-repository";

/**
 * Development seed for Leadership Reports.
 *
 * The shipped reports, including the confidential assessment that only its
 * author may discover — because a withholding rule nobody can see working is a
 * rule nobody will notice breaking.
 *
 * Comments, activity and revisions keep their own ids and timestamps, so what
 * the pages show is what the fixtures always showed.
 *
 * Written into an **empty** table only.
 */
export function seedReports(db: Db): boolean {
  const repo = createLeadershipReportRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const report of leadershipReports) {
      const {
        id,
        comments,
        activity,
        revisions,
        createdAt: _created,
        updatedAt: _updated,
        ...values
      } = report;

      repo.insert(values as ReportValues, id);

      for (const comment of comments) {
        repo.insertComment(
          {
            reportId: id,
            authorId: comment.authorId,
            body: comment.body,
            ...(comment.target ? { target: comment.target } : {}),
          },
          comment.id,
        );
      }
      for (const entry of activity) {
        repo.addActivity(
          id,
          {
            kind: entry.kind,
            summary: entry.summary,
            at: entry.at,
            ...(entry.actorId ? { actorId: entry.actorId } : {}),
          },
          entry.id,
        );
      }
      for (const revision of revisions) {
        repo.addRevision(id, {
          revision: revision.revision,
          blocks: revision.blocks,
          actorId: revision.actorId,
          at: revision.at,
          ...(revision.note ? { note: revision.note } : {}),
        });
      }
    }
  });

  seed();
  return true;
}
