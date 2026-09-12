import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";
import { notStarted, type OnboardingState, type OnboardingStep } from "@/domain/onboarding";

/**
 * Onboarding progress, and only progress.
 *
 * One row per person, written as they go rather than at the end: closing the
 * browser halfway through must lose nothing, and there is no draft of an
 * organisation to discard. Everything organisational these screens touch is
 * written by the organisation's own service as it is confirmed.
 *
 * An absent row means **not started**, which is the right answer for everybody
 * who existed before this table did.
 */

interface Row {
  person_id: string;
  status: string;
  step: string;
  version: number;
  started_at: string;
  completed_at: string | null;
}

export function createOnboardingRepository(db: Db) {
  const toState = (row: Row | undefined): OnboardingState => {
    if (!row) return notStarted;
    return {
      status: row.status === "complete" ? "complete" : "in-progress",
      step: row.step as OnboardingStep,
      version: row.version,
      startedAt: row.started_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    };
  };

  return {
    find(personId: string): OnboardingState {
      return toState(
        db.prepare("SELECT * FROM onboarding_state WHERE person_id = ?").get(personId) as
          Row | undefined,
      );
    },

    /** Record where somebody has got to. Upserts, so resuming is not a new run. */
    save(
      personId: string,
      values: { status: "in-progress" | "complete"; step: OnboardingStep; version?: number },
    ): OnboardingState {
      const at = nowIso();
      db.prepare(
        `INSERT INTO onboarding_state
           (person_id, status, step, version, started_at, completed_at, updated_at)
         VALUES (@person, @status, @step, @version, @at, @completed, @at)
         ON CONFLICT (person_id) DO UPDATE SET
           status = excluded.status,
           step = excluded.step,
           version = excluded.version,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at`,
      ).run({
        person: personId,
        status: values.status,
        step: values.step,
        version: values.version ?? 0,
        at,
        completed: values.status === "complete" ? at : null,
      });

      return this.find(personId);
    },
  };
}

export type OnboardingRepository = ReturnType<typeof createOnboardingRepository>;
