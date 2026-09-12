import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { LeadershipReport, WorkContext } from "@/domain/types";

/**
 * The leadership journal's API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 *
 * Every handler goes through the service, which answers not-found for anything
 * that is not the caller's own entry. There is no read path here that another
 * leader, a bishop or an administrator can reach.
 */

export type JournalEntry = import("@/server/services/journal-service").JournalEntry;

async function withJournal<T>(work: (service: Service, viewer: Viewer) => T): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createWorkRepository },
    { createWorkContentRepository },
    { createLeadershipReportRepository },
    { createJournalService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/work-repository"),
    import("@/server/repositories/work-content-repository"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/services/journal-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createJournalService(
      createWorkRepository(db),
      createWorkContentRepository(db),
      createLeadershipReportRepository(db),
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

type Service = import("@/server/services/journal-service").JournalService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchJournal = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withJournal((s, v): WorkContext[] => s.list(v)));

export const fetchEntry = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withJournal((s, v): JournalEntry => s.open(v, data.id)));

export const createEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withJournal((s, v): JournalEntry => s.create(v, data)));

export const writeEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withJournal((s, v) => s.write(v, data)));

export const renameEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withJournal((s, v): WorkContext => s.rename(v, data)));

export const removeEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withJournal((s, v) => s.remove(v, data.id)));

/** Selected lines become a Leadership Report. Copies, never a reference. */
export const summarizeEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withJournal((s, v): LeadershipReport => s.summarize(v, data)));
