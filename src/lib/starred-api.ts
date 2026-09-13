import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * What this person has starred — a private bookmark, not a church record.
 *
 * Kept apart from every list it applies to, the way `read_state` is kept
 * apart from what it marks read: starring a report, a reach-out record, a
 * meeting note or a goal is the same fact shape regardless of which kind of
 * record it points at, so one table and one API serve all of them.
 */

type StarredRepo = import("@/server/repositories/starred-item-repository").StarredItemRepository;

async function withStarred<T>(
  work: (repo: StarredRepo, personId: string) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createStarredItemRepository },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/starred-item-repository"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator's configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);
    const viewer = requireCurrentUser(getRequest(), db);
    return { data: work(createStarredItemRepository(db), viewer.person.id) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved." } };
  }
}

export interface StarredRecord {
  itemType: string;
  itemId: string;
  starredAt: string;
}

export const fetchStarred = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withStarred((repo, personId): StarredRecord[] => repo.allStarred(personId)));

export const setStarred = createServerFn({ method: "POST" })
  .validator((input: { itemType: string; itemId: string; starred?: boolean }) => input)
  .handler(({ data }) =>
    withStarred((repo, personId): StarredRecord[] => {
      if (data.starred === false) repo.unstar(personId, data.itemType, data.itemId);
      else repo.star(personId, data.itemType, data.itemId);
      return repo.allStarred(personId);
    }),
  );
