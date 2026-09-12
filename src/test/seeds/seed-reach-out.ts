import type { Database as Db } from "better-sqlite3";

import { reachOutReports } from "@/test/fixtures";
import { createReachOutRepository } from "@/server/repositories/reach-out-repository";
import type { ReportValues } from "@/server/repositories/reach-out-repository";

/**
 * Development seed for Reach-Out.
 *
 * The shipped reports, including one with several contributors, so that
 * "authorship is not ownership" is visible rather than only described.
 *
 * Written into an **empty** database only.
 */
export function seedReachOut(db: Db): boolean {
  const repo = createReachOutRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const report of reachOutReports) {
      const { id, comments, createdAt: _c, updatedAt: _u, ...values } = report;
      repo.insert(values as ReportValues, id);

      for (const comment of comments) {
        repo.insertComment(
          {
            parentId: id,
            authorId: comment.authorId,
            body: comment.body,
            ...(comment.target ? { target: comment.target } : {}),
          },
          comment.id,
        );
      }
    }
  });

  seed();
  return true;
}
