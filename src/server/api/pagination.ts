import type { PageMeta } from "./response";
import type { ListQuery } from "./validation";

/**
 * Paging in the database rather than after it.
 *
 * §19: collection endpoints page server-side even while persistence is SQLite,
 * so the frontend contract does not change when persistence does. Reading
 * every row and slicing in memory would work at today's fixture sizes and stop
 * working at exactly the point where paging starts to matter.
 *
 * This is the shared helper §29 permits: a LIMIT/OFFSET pair and the page
 * arithmetic. It is not a query builder, and per-domain SQL stays readable and
 * written out by hand.
 */

export interface Window {
  limit: number;
  offset: number;
}

/**
 * The window a query should read, and the page it represents.
 *
 * `total` comes from a separate `COUNT(*)` over the same filters — which is
 * what lets the response tell the truth about how many pages exist without
 * fetching them.
 *
 * Out-of-range pages are **clamped, not refused**, matching the frontend's
 * `paginate()`: a leader who narrows a filter while on page 6 must land on the
 * last real page rather than on an empty one they cannot escape.
 */
export function windowFor(
  query: Pick<ListQuery, "page" | "pageSize">,
  total: number,
): Window & { meta: PageMeta } {
  const pageSize = query.pageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page, 1), pageCount);

  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    meta: { page, pageSize, pageCount, total },
  };
}
