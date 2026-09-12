import { useQuery } from "@tanstack/react-query";

import { fetchFiledDocuments } from "@/lib/documents-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { DocumentEntityType } from "@/domain/registry";
import type { ResourceSearchResult } from "@/domain/types";

/**
 * The documents filed against one binder record.
 *
 * §5 of `DOCUMENT-REGISTRY.md`: a section's document list and consolidated
 * search are two views over the same registry records, never two places to
 * file the same thing. So a ministry's shelf asks the registry the same
 * question the search page asks, narrowed to that ministry.
 *
 * Withholding already happened in the query, so nothing here filters and
 * nothing downstream may.
 */
export function useFiledDocuments(entityType: DocumentEntityType, entityId: string) {
  const query = useQuery<ResourceSearchResult[]>({
    queryKey: ["filed-documents", entityType, entityId],
    queryFn: async () =>
      unwrap(await withTimeout(fetchFiledDocuments({ data: { entityType, entityId } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  return {
    documents: query.data ?? [],
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
    retry: () => void query.refetch(),
  };
}
