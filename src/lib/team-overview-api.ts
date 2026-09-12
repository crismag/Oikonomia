import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * The team overview's API.
 *
 * One call, because the page asks one question. What comes back is already
 * scoped to the reader: leaders they have recorded oversight of, aggregates
 * over their campus otherwise, and never what a report says.
 */

export type TeamOverview = import("@/domain/team-overview").TeamOverview;

export const fetchTeamOverview = createServerFn({ method: "GET" })
  .validator((input: { today: string }) => input)
  .handler(async ({ data }): Promise<Result<TeamOverview>> => {
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
      { createReadStateRepository },
      { createDashboardService },
      { createTeamOverviewService },
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
      import("@/server/repositories/escalation-repository"),
      import("@/server/services/dashboard-service"),
      import("@/server/services/team-overview-service"),
      import("@tanstack/react-start/server"),
    ]);

    try {
      const db = getDatabase();
      /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
      refreshConfiguration(db);

      const reports = createLeadershipReportRepository(db);
      const lifegroup = createLifegroupRepository(db);
      const work = createWorkRepository(db);
      const organization = createOrganizationRepository(db);

      const dashboard = createDashboardService({
        calendar: createCalendarRepository(db),
        meetings: createMeetingRepository(db),
        lifegroup,
        reachOut: createReachOutRepository(db),
        reports,
        goals: createGoalsRepository(db),
        work,
        organization,
      });

      const service = createTeamOverviewService(dashboard, {
        reports,
        lifegroup,
        work,
        organization,
        readState: createReadStateRepository(db),
      });
      return { data: service.build(requireCurrentUser(getRequest(), db), data.today) };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      console.error(error);
      return { error: { code: "internal", message: "The overview could not be assembled." } };
    }
  });
