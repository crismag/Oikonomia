import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  commentOnWork,
  fetchWork,
  fetchWorkList,
  recordWorkDecision,
  requestWorkDecision,
  transitionWork,
  type WorkList,
  type WorkScope,
  type WorkView,
} from "@/lib/work-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { WorkKind } from "@/domain/types";

/**
 * The work / review context, read and acted on.
 *
 * **The gate is the server's.** A record closed to this viewer is not in the
 * browser, and a section they may not read was removed before the response was
 * built — the interface is not hiding it while rendering, which would leave the
 * text one view-source away.
 *
 * `metadata` arrives as its own shape rather than as a record with fields
 * missing, because it is a different answer: "this exists and is routed to you,
 * and you may not read it".
 */

export function useWorkList(filter: { kind?: WorkKind; scope?: WorkScope } = {}) {
  const query = useQuery<WorkList>({
    queryKey: ["work-list", filter.kind ?? "all", filter.scope ?? "all"],
    queryFn: async () => unwrap(await withTimeout(fetchWorkList({ data: filter }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  return {
    work: query.data?.work ?? [],
    withheld: query.data?.withheld ?? 0,
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
    retry: () => void query.refetch(),
  };
}

export function useWork(id: string) {
  const queryClient = useQueryClient();

  const query = useQuery<WorkView>({
    queryKey: ["work", id],
    queryFn: async () => unwrap(await withTimeout(fetchWork({ data: { id } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["work", id] });
    void queryClient.invalidateQueries({ queryKey: ["work-list"] });
  }, [queryClient, id]);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const act = useCallback(
    (work: () => Promise<unknown>) => void mutation.mutateAsync(work).catch(() => {}),
    [mutation],
  );

  return {
    view: query.data,
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
    retry: () => void query.refetch(),

    saving: mutation.isPending,
    actionError: mutation.error,

    transition: (action: string, note?: string) =>
      act(() => transitionWork({ data: { id, action, ...(note ? { note } : {}) } })),
    /* Resolves once the comment is saved, and rejects with the server's
       reason, so the box keeps what was typed until it has landed. */
    comment: (body: string) =>
      mutation.mutateAsync(() => commentOnWork({ data: { workId: id, body } })),
    requestDecision: (summary: string) =>
      act(() => requestWorkDecision({ data: { workId: id, summary } })),
    recordDecision: (summary: string, decisionId?: string) =>
      act(() =>
        recordWorkDecision({
          data: { workId: id, summary, ...(decisionId ? { decisionId } : {}) },
        }),
      ),
  };
}
