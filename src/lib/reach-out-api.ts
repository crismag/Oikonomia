import { createServerFn } from "@tanstack/react-start";

import type { PageMeta, Result } from "./api-envelope";
import type { Comment, ReachOutReport } from "@/domain/types";

/**
 * Reach-Out's API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 */

export interface ReportPage {
  reports: ReachOutReport[];
  page: PageMeta;
}

async function withReachOut<T>(
  work: (service: ReachOutService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createReachOutRepository },
    { createReachOutService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/reach-out-repository"),
    import("@/server/services/reach-out-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createReachOutService(createReachOutRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type ReachOutService = import("@/server/services/reach-out-service").ReachOutService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchReachOut = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReachOut((s, v): ReportPage => s.list(v, data)));

/**
 * One report, fetched in its own right.
 *
 * A leader can arrive on a report by link, and it need not be on the page the
 * list happens to be showing.
 */
export const fetchReachOutReport = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withReachOut((s, v) => s.get(v, data.id)));

export const createReachOutReport = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReachOut((s, v) => s.createReport(v, data)));

export const updateReachOutReport = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown; expectedVersion?: number }) => input)
  .handler(({ data }) =>
    withReachOut((s, v) => s.updateReport(v, data.id, data.patch, data.expectedVersion)),
  );

export const deleteReachOutReport = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withReachOut((s, v) => {
      s.deleteReport(v, data.id);
      return null;
    }),
  );

export const addReachOutComment = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withReachOut((s, v): Comment => s.addComment(v, data)));
