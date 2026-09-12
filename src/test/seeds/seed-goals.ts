import type { Database as Db } from "better-sqlite3";

import { goalUpdates, goals } from "@/test/fixtures";
import { createGoalsRepository } from "@/server/repositories/goals-repository";
import type { GoalValues } from "@/server/repositories/goals-repository";

/**
 * Development seed for Goals.
 *
 * The shipped fixtures, written into an **empty** database once. They carry
 * the cases worth having: a completed goal, one on hold with a reason, one
 * carried forward from an earlier year, and one held to a narrower audience so
 * the withheld count is exercised rather than assumed.
 *
 * Unlike the other seeds this one keeps each fixture's own `number`, because
 * the binder's "01", "02" is part of what the fixture says.
 */
export function seedGoals(db: Db): boolean {
  const repo = createGoalsRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const goal of goals) {
      const { id, createdAt: _created, ...values } = goal;
      repo.insertGoal(values as Omit<GoalValues, "number">, id);
    }
    for (const update of goalUpdates) {
      const { id, ...values } = update;
      repo.insertUpdate(values, id);
    }
  });

  seed();
  return true;
}
