import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { registerDocument, searchDocuments, type ResourcePage } from "@/lib/documents-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { RegisteredDocument } from "@/domain/registry";

/**
 * The document registry, for the pages that write to it.
 *
 * Reading is `useResourceSearch`; this is the other half. Kept apart because
 * they answer different questions — "what do we have about this?" against
 * "the binder should know about this too" — and a page usually wants one.
 */

export interface RegistryInput {
  title: string;
  url: string;
  kind: string;
  description?: string | undefined;
  associations?: { entityType: string; entityId?: string }[] | undefined;
}

export function useRegistry(recent = 5) {
  const queryClient = useQueryClient();

  const listing = useQuery<ResourcePage>({
    queryKey: ["resources", { page: 1, pageSize: recent }],
    queryFn: async () =>
      unwrap(await withTimeout(searchDocuments({ data: { page: 1, pageSize: recent } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void queryClient.invalidateQueries({ queryKey: ["resource-filters"] });
  }, [queryClient]);

  const mutation = useMutation({
    mutationFn: async (input: RegistryInput) =>
      unwrap((await withTimeout(registerDocument({ data: input }))) as never) as RegisteredDocument,
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  return {
    recent: listing.data?.resources ?? [],
    total: listing.data?.page.total ?? 0,
    status: listing.isError ? "error" : listing.data ? "ready" : ("loading" as const),
    retry: () => void listing.refetch(),

    saving: mutation.isPending,
    saveError: mutation.error,
    register: (input: RegistryInput) => mutation.mutateAsync(input),
  };
}
