import { useQuery } from "@tanstack/react-query";

import {
  fetchDocumentFilters,
  searchDocuments,
  type FilterOptions,
  type ResourcePage,
} from "@/lib/documents-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { windowFromMeta, type PageWindow } from "@/domain/pagination";
import type { BinderSection, ResourceSearchResult, ResourceSort } from "@/domain/types";

/**
 * Resource search access.
 *
 * A seam, deliberately: the page asks this for results rather than reaching
 * into data itself, so the day a registry existed the replacement was one
 * module rather than a component rewrite. That day is this slice — what used
 * to project over three fixture arrays now reads the document registry.
 *
 * Withholding happens in the query, so nothing this returns needs filtering
 * and nothing downstream may add a filter of its own. A resource this viewer
 * may not discover never reaches the browser at all — not its title, not its
 * tags, and not its contribution to the total.
 */

export interface ResourceQuery {
  query?: string | undefined;
  section?: BinderSection | undefined;
  relatedLabel?: string | undefined;
  tag?: string | undefined;
  addedById?: string | undefined;
  sort?: ResourceSort | undefined;
  page?: number | undefined;
}

const EMPTY_OPTIONS: FilterOptions = { sections: [], related: [], tags: [], people: [] };

const wire = (query: ResourceQuery) => ({
  ...(query.query?.trim() ? { search: query.query.trim() } : {}),
  ...(query.section ? { section: query.section } : {}),
  ...(query.relatedLabel ? { relatedLabel: query.relatedLabel } : {}),
  ...(query.tag ? { tag: query.tag } : {}),
  ...(query.addedById ? { addedById: query.addedById } : {}),
  ...(query.sort ? { sort: query.sort } : {}),
  page: query.page ?? 1,
});

export interface ResourceSearchStore {
  page: PageWindow<ResourceSearchResult>;
  options: FilterOptions;
  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
}

/**
 * Results and filter choices for one search.
 *
 * The filters live in the page's URL rather than in here — a search that can
 * be linked to is worth more than a store that owns its own state.
 */
export function useResourceSearch(query: ResourceQuery): ResourceSearchStore {
  const input = wire(query);

  const results = useQuery<ResourcePage>({
    queryKey: ["resources", input],
    queryFn: async () => unwrap(await withTimeout(searchDocuments({ data: input }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  /*
   * Counted separately from the page, and without the section or tag in hand,
   * so that choosing one filter does not remove the rest of the choices.
   */
  const { page: _page, section: _section, tag: _tag, ...facetInput } = input;
  const options = useQuery<FilterOptions>({
    queryKey: ["resource-filters", facetInput],
    queryFn: async () => unwrap(await withTimeout(fetchDocumentFilters({ data: facetInput }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const meta = results.data?.page ?? { page: 1, pageSize: 25, pageCount: 1, total: 0 };

  return {
    page: windowFromMeta(results.data?.resources ?? [], meta),
    options: options.data ?? EMPTY_OPTIONS,
    status: results.isError ? "error" : results.data ? "ready" : "loading",
    error: results.error,
    retry: () => void results.refetch(),
  };
}
