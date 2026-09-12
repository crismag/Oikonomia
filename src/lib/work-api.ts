import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { Comment, Decision, WorkContext, WorkKind } from "@/domain/types";

/**
 * The work / review context's API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 *
 * Every handler goes through the service, which resolves the audience policy
 * and returns the record, a redacted record, routing metadata, or nothing.
 */

export type WorkView = import("@/server/services/work-service").WorkView;
export type WorkScope = import("@/server/services/work-service").WorkScope;

export interface WorkList {
  work: WorkContext[];
  /** How many are closed to this viewer. A number, never the records. */
  withheld: number;
}

async function withWork<T>(work: (service: Service, viewer: Viewer) => T): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createWorkRepository },
    { createWorkService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/work-repository"),
    import("@/server/services/work-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createWorkService(createWorkRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type Service = import("@/server/services/work-service").WorkService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchWorkList = createServerFn({ method: "GET" })
  .validator((input: { kind?: WorkKind; scope?: WorkScope }) => input)
  .handler(({ data }) => withWork((s, v): WorkList => s.list(v, data ?? {})));

export const fetchWork = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withWork((s, v): WorkView => s.get(v, data.id)));

export const transitionWork = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withWork((s, v): WorkContext => s.transition(v, data)));

export const commentOnWork = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withWork((s, v): Comment => s.comment(v, data)));

export const requestWorkDecision = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withWork((s, v): Decision => s.requestDecision(v, data)));

export const recordWorkDecision = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withWork((s, v): Decision => s.recordDecision(v, data)));
