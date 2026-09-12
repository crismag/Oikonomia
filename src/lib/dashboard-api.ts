import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * The leader dashboard's API.
 *
 * One call, because the page asks one question. Every obligation it returns is
 * derived from records the binder already holds, through the same gates the
 * sections use — see `server/services/dashboard-service.ts`.
 */

export type Dashboard = import("@/server/services/dashboard-service").Dashboard;

export const fetchDashboard = createServerFn({ method: "GET" })
  .validator((input: { today: string }) => input)
  .handler(async ({ data }): Promise<Result<Dashboard>> => {
    const [
      { ApiError },
      { requireCurrentUser },
      { getDatabase },
      { refreshConfiguration },
      { createCalendarRepository },
      { createMeetingRepository },
      { createLifegroupRepository },
      { createReachOutRepository },
      { createLeadershipReportRepository },
      { createGoalsRepository },
      { createWorkRepository },
      { createOrganizationRepository },
      { createDashboardService },
      { getRequest },
    ] = await Promise.all([
      import("@/server/api/response"),
      import("@/server/auth/require-user"),
      import("@/server/db/connection"),
      import("@/server/config/runtime"),
      import("@/server/repositories/calendar-repository"),
      import("@/server/repositories/meeting-repository"),
      import("@/server/repositories/lifegroup-repository"),
      import("@/server/repositories/reach-out-repository"),
      import("@/server/repositories/leadership-report-repository"),
      import("@/server/repositories/goals-repository"),
      import("@/server/repositories/work-repository"),
      import("@/server/repositories/organization-repository"),
      import("@/server/services/dashboard-service"),
      import("@tanstack/react-start/server"),
    ]);

    try {
      const db = getDatabase();
      /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
      refreshConfiguration(db);
      const service = createDashboardService({
        calendar: createCalendarRepository(db),
        meetings: createMeetingRepository(db),
        lifegroup: createLifegroupRepository(db),
        reachOut: createReachOutRepository(db),
        reports: createLeadershipReportRepository(db),
        goals: createGoalsRepository(db),
        work: createWorkRepository(db),
        organization: createOrganizationRepository(db),
      });
      return { data: service.build(requireCurrentUser(getRequest(), db), data.today) };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      console.error(error);
      return {
        error: { code: "internal", message: "The dashboard could not be assembled." },
      };
    }
  });
