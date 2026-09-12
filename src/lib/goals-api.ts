import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { Goal, GoalUpdate } from "@/domain/types";

/**
 * Goals' API.
 *
 * Same constraints as the other two — see `docs/architecture/api-boundary.md`
 * for why these are server functions, why they live in `lib/`, and why the
 * database layer is imported lazily inside each handler.
 */

export interface GoalYear {
  goals: Goal[];
  updates: GoalUpdate[];
  /** How many the viewer may not read. Existence, never identity. */
  withheld: number;
  years: number[];
}

async function withGoals<T>(
  work: (service: GoalsService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createGoalsRepository },
    { createGoalsService },
    { createOrganizationRepository },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/goals-repository"),
    import("@/server/services/goals-service"),
    import("@/server/repositories/organization-repository"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createGoalsService(createGoalsRepository(db), createOrganizationRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type GoalsService = import("@/server/services/goals-service").GoalsService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchGoalYear = createServerFn({ method: "GET" })
  .validator((input: { year: number }) => input)
  .handler(({ data }) => withGoals((service, viewer): GoalYear => service.listYear(viewer, data)));

export const createGoal = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withGoals((service, viewer) => service.createGoal(viewer, data)));

export const updateGoal = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withGoals((service, viewer) => service.updateGoal(viewer, data.id, data.patch)),
  );

export const deleteGoal = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withGoals((service, viewer) => {
      service.deleteGoal(viewer, data.id);
      return null;
    }),
  );

export const addGoalUpdate = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withGoals((service, viewer) => service.addUpdate(viewer, data)));

export const completeGoal = createServerFn({ method: "POST" })
  .validator((input: { id: string; note?: string | undefined }) => input)
  .handler(({ data }) =>
    withGoals((service, viewer) => service.complete(viewer, data.id, data.note)),
  );

export const holdGoal = createServerFn({ method: "POST" })
  .validator((input: { id: string; reason?: string | undefined }) => input)
  .handler(({ data }) =>
    withGoals((service, viewer) => service.hold(viewer, data.id, data.reason)),
  );

export const resumeGoal = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withGoals((service, viewer) => service.resume(viewer, data.id)));

export const carryGoalForward = createServerFn({ method: "POST" })
  .validator((input: { id: string; toYear: number }) => input)
  .handler(({ data }) =>
    withGoals((service, viewer) => service.carryForward(viewer, data.id, data.toYear)),
  );
