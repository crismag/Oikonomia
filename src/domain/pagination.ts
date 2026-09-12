/**
 * Paging a list that a leader is reading.
 *
 * Two rules decide everything here. A page number is a *view* of a result set,
 * not a stored position: when a filter shrinks the results, the reader must
 * land on the last real page rather than on an empty one they cannot escape.
 * And the numbers shown to the reader are the ones they would count by hand —
 * "26–50 of 184", one-based, inclusive — never array indices.
 */

import { config } from "@/config";

/**
 * One screenful.
 *
 * Configuration, because how much a church wants on a page is a preference
 * rather than a property of paging. Read through the registry so the day it
 * becomes an administrator's setting, nothing here changes.
 */
export const PAGE_SIZE = config.site.pageSize;

export type PageWindow<T> = {
  items: T[];
  /** One-based and clamped: never below 1, never past the last real page. */
  page: number;
  pageCount: number;
  total: number;
  /** One-based inclusive bounds of the visible slice; 0 when there is nothing. */
  from: number;
  to: number;
  /** True when the whole result set already fits, so no control is warranted. */
  singlePage: boolean;
};

/**
 * Cut `items` into the page the reader asked for.
 *
 * An out-of-range request is clamped rather than refused: arriving at page 6 of
 * a two-page result — from a bookmark, from Back, or from narrowing a filter —
 * shows page 2, because a reader who is looking at nothing has no way to tell
 * that the records exist further up.
 */
export function paginate<T>(items: T[], page: number, pageSize: number = PAGE_SIZE): PageWindow<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));

  const asked = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(asked, 1), pageCount);

  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);

  return {
    items: slice,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    singlePage: pageCount === 1,
  };
}

/**
 * The same window, when the database already did the paging.
 *
 * A server-paged list has its items and its arithmetic from different places:
 * the rows are this page's, and `total` came from a `COUNT(*)`. This assembles
 * the shape `Pagination` renders, so one control serves both kinds of list
 * rather than growing a second mode.
 */
export function windowFromMeta<T>(
  items: T[],
  meta: { page: number; pageSize: number; pageCount: number; total: number },
): PageWindow<T> {
  const start = (meta.page - 1) * meta.pageSize;
  return {
    items,
    page: meta.page,
    pageCount: meta.pageCount,
    total: meta.total,
    from: meta.total === 0 ? 0 : start + 1,
    to: meta.total === 0 ? 0 : start + items.length,
    singlePage: meta.pageCount === 1,
  };
}

/** "Showing 26–50 of 184 reports" — the sentence, assembled once. */
export function pageSummary(window: PageWindow<unknown>, noun: string, plural?: string): string {
  const word = window.total === 1 ? noun : (plural ?? `${noun}s`);
  if (window.total === 0) return `No ${plural ?? `${noun}s`}`;
  if (window.singlePage) return `${window.total} ${word}`;
  return `Showing ${window.from}–${window.to} of ${window.total} ${word}`;
}

/** A page number to render, or a gap where numbers were left out. */
export type PageToken = number | "gap";

/**
 * The page numbers worth showing: the ends, the neighbourhood of the current
 * page, and a gap where the rest was elided. Never two gaps in a row, and never
 * a gap standing in for a single number — printing "…" instead of "4" wastes
 * the reader's time.
 */
export function pageTokens(page: number, pageCount: number, span: number = 1): PageToken[] {
  /* A short list is cheaper to print whole than to reason about. */
  if (pageCount <= 2 * span + 5) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const wanted = new Set<number>([1, pageCount]);
  for (let n = page - span; n <= page + span; n += 1) {
    if (n >= 1 && n <= pageCount) wanted.add(n);
  }

  const numbers = [...wanted].sort((a, b) => a - b);
  const out: PageToken[] = [];

  numbers.forEach((n, i) => {
    const previous = numbers[i - 1];
    if (previous !== undefined && n - previous > 1) {
      /* One missing number is cheaper to print than to hide. */
      if (n - previous === 2) out.push(n - 1);
      else out.push("gap");
    }
    out.push(n);
  });

  return out;
}
