import type { Database as Db } from "better-sqlite3";

import { workContexts } from "@/test/fixtures";
import { createWorkRepository } from "@/server/repositories/work-repository";
import type { WorkValues } from "@/server/repositories/work-repository";

/**
 * Development seed for the work / review context.
 *
 * The shipped records, including the ones carrying stricter sections — because
 * a `limited` decision that nothing exercises is a rule nobody will notice
 * breaking.
 *
 * Comments, decisions and activity keep their own ids and timestamps, so a
 * thread reads exactly as it always did.
 *
 * Written into an **empty** table only.
 */
export function seedWork(db: Db): boolean {
  const repo = createWorkRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const work of workContexts) {
      const { id, decisions, comments, activity, ...values } = work;
      repo.insert(values as WorkValues, id);

      for (const decision of decisions) {
        repo.addDecision(
          id,
          {
            summary: decision.summary,
            decidedById: decision.decidedById,
            state: decision.state,
            at: decision.at,
          },
          decision.id,
        );
      }
      for (const comment of comments) {
        repo.insertComment(
          {
            workId: id,
            authorId: comment.authorId,
            body: comment.body,
            at: comment.at,
            ...(comment.target ? { target: comment.target } : {}),
            ...(comment.system ? { system: true } : {}),
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
    }
  });

  seed();
  return true;
}
