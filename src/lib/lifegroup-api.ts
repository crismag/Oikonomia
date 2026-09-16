import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type {
  Exhortation,
  Gathering,
  GatheringAttendance,
  GatheringReport,
  LifegroupEntry,
} from "@/domain/types";

/**
 * LifeGroup's API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 */

export interface LifegroupData {
  gatherings: Gathering[];
  attendance: GatheringAttendance[];
  /** Only entries this viewer may read. Never the whole set. */
  entries: LifegroupEntry[];
  /** How many were withheld. Existence acknowledged, identity never. */
  withheldEntries: number;
  exhortations: Exhortation[];
  reports: GatheringReport[];
}

async function withLifegroup<T>(
  work: (service: LifegroupService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createLifegroupRepository },
    { createLifegroupService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/lifegroup-repository"),
    import("@/server/services/lifegroup-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createLifegroupService(createLifegroupRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type LifegroupService = import("@/server/services/lifegroup-service").LifegroupService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchLifegroup = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(() => withLifegroup((service, viewer): LifegroupData => service.listAll(viewer)));

export const createGathering = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.createGathering(v, data)));

/** Put your own name against a gathering, or take it off. */
export const joinGathering = createServerFn({ method: "POST" })
  .validator((input: { gatheringId: string; action: "claim" | "join" | "leave" }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.joinGathering(v, data)));

export const updateGathering = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.updateGathering(v, data.id, data.patch)));

/** Take a gathering off the schedule. It stays in the book, marked cancelled. */
export const cancelGathering = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.cancelGathering(v, data.id)));

/** Put a cancelled gathering back on the schedule. */
export const restoreGathering = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.restoreGathering(v, data.id)));

export const markAttendance = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.markAttendance(v, data)));

export const removeAttendance = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withLifegroup((s, v) => {
      s.removeAttendance(v, data.id);
      return null;
    }),
  );

export const setExhortation = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.setExhortation(v, data)));

export const setSummary = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.setSummary(v, data)));

export const completeGathering = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.complete(v, data.id)));

export const reopenGathering = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.reopen(v, data.id)));

export const addEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.addEntry(v, data)));

export const updateEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) => withLifegroup((s, v) => s.updateEntry(v, data.id, data.patch)));

export const removeEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withLifegroup((s, v) => {
      s.removeEntry(v, data.id);
      return null;
    }),
  );
