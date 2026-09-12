import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { Comment, LeadershipReport } from "@/domain/types";

/**
 * Leadership Reports' API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 *
 * Every handler goes through the service, which applies `canDiscover` before
 * anything is returned and checks the specific capability before anything is
 * written. Nothing here reaches the repository directly.
 */

export interface ReportList {
  reports: LeadershipReport[];
  /** How many were withheld. A number, never the reports themselves. */
  withheld: number;
}

async function withReports<T>(
  work: (service: ReportService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createLeadershipReportRepository },
    { createOrganizationRepository },
    { createLeadershipReportService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/leadership-report-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createLeadershipReportService(
      createLeadershipReportRepository(db),
      createOrganizationRepository(db),
    );
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type ReportService = import("@/server/services/leadership-report-service").LeadershipReportService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchReports = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withReports((s, v): ReportList => s.list(v)));

export const fetchReport = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withReports((s, v): LeadershipReport => s.get(v, data.id)));

export const createReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReports((s, v) => s.create(v, data)));

export const updateReport = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown; expectedVersion?: number }) => input)
  .handler(({ data }) =>
    withReports((s, v) => s.update(v, data.id, data.patch, data.expectedVersion)),
  );

export const writeReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReports((s, v) => s.write(v, data)));

export const transitionReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReports((s, v) => s.transition(v, data)));

export const commentOnReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReports((s, v): Comment => s.comment(v, data)));

export const removeReport = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withReports((s, v) => s.remove(v, data.id)));
