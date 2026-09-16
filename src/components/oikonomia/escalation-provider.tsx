import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  fetchEscalationsFor,
  fetchInbox,
  fetchReadState,
  markRead as markReadCall,
  markSeen as markSeenCall,
  moveEscalation,
  raiseEscalation,
  replyToEscalation,
  withdrawEscalation,
  type EscalationView,
  type LeadershipInbox,
  type ReadRecord,
} from "@/lib/escalation-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type {
  EscalationSourceType,
  EscalationStatus,
  EscalationType,
  RecipientRole,
} from "@/domain/escalation";

/**
 * One empty array, reused.
 *
 * `query.data ?? []` builds a new array every render while the query has no
 * data, and a new array is a new dependency — so every `useMemo` downstream
 * recomputed on every render, which is the opposite of what it is for. A
 * single shared value keeps the identity stable. Nothing writes to it — every
 * consumer reads — so it is not defensively frozen.
 */
const NONE: never[] = [];

/**
 * The leadership inbox, and the asks that fill it.
 *
 * Three hooks, because pages want three different things: the inbox itself,
 * the asks attached to one record, and the ability to raise one. None of them
 * can turn a piece of information into work — that only happens when somebody
 * asks.
 */

const EMPTY: LeadershipInbox = {
  attention: [],
  actions: [],
  approvals: [],
  flagged: [],
  mine: [],
  raisedByMe: [],
  answeredForMe: [],
};

export interface RaiseInput {
  type: EscalationType;
  sourceType: EscalationSourceType;
  sourceId: string;
  entryId?: string | undefined;
  contextLabel?: string | undefined;
  request: string;
  requestedFromRole?: RecipientRole | undefined;
  requestedFromPersonId?: string | undefined;
  neededBy?: string | undefined;
}

export function useLeadershipInbox() {
  const queryClient = useQueryClient();

  const query = useQuery<LeadershipInbox>({
    queryKey: ["leadership-inbox"],
    queryFn: async () => unwrap(await withTimeout(fetchInbox({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["leadership-inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["escalations"] });
  }, [queryClient]);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const inbox = query.data ?? EMPTY;

  return useMemo(
    () => ({
      ...inbox,
      status: (query.isError ? "error" : query.data ? "ready" : "loading") as
        "loading" | "ready" | "error",
      retry: () => void query.refetch(),

      saving: mutation.isPending,
      error: mutation.error,

      /** Move one along: note it, take it on, complete it, decide it. */
      move: (
        id: string,
        status: EscalationStatus,
        fields: { note?: string; assigneeId?: string } = {},
      ) => mutation.mutateAsync(() => moveEscalation({ data: { id, status, ...fields } })),

      withdraw: (id: string) => mutation.mutateAsync(() => withdrawEscalation({ data: { id } })),

      /** Answer a question the recipient asked; the ask goes back to them. */
      reply: (id: string, note: string) =>
        mutation.mutateAsync(() => replyToEscalation({ data: { id, note } })),
    }),
    [inbox, query, mutation],
  );
}

/** The asks attached to one record, for that record's own page. */
export function useEscalationsFor(sourceType: EscalationSourceType, sourceId: string) {
  const queryClient = useQueryClient();

  const query = useQuery<EscalationView[]>({
    queryKey: ["escalations", sourceType, sourceId],
    queryFn: async () =>
      unwrap(await withTimeout(fetchEscalationsFor({ data: { sourceType, sourceId } }))),
    enabled: !!sourceId,
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (input: RaiseInput) =>
      unwrap((await withTimeout(raiseEscalation({ data: input }))) as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["escalations", sourceType, sourceId] });
      void queryClient.invalidateQueries({ queryKey: ["leadership-inbox"] });
    },
    networkMode: "always" as const,
    retry: 0,
  });

  return {
    escalations: query.data ?? [],
    status: (query.isError ? "error" : query.data ? "ready" : "loading") as
      "loading" | "ready" | "error",
    retry: () => void query.refetch(),

    raising: mutation.isPending,
    raiseError: mutation.error,
    raise: (input: RaiseInput) => mutation.mutateAsync(input),
  };
}

/**
 * What this person has read.
 *
 * Kept apart from attention on purpose: unread is a reading state, not a task,
 * and nothing in this hook can make an unread item overdue.
 */
export function useReadState() {
  const queryClient = useQueryClient();

  const query = useQuery<ReadRecord[]>({
    queryKey: ["read-state"],
    queryFn: async () => unwrap(await withTimeout(fetchReadState({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (input: { itemType: string; itemId: string; read?: boolean }) =>
      unwrap((await withTimeout(markReadCall({ data: input }))) as never) as ReadRecord[],
    onSuccess: (rows: ReadRecord[]) => queryClient.setQueryData(["read-state"], rows),
    networkMode: "always" as const,
    retry: 0,
  });

  const rows = query.data ?? NONE;
  const read = useMemo(() => new Set(rows.map((row) => `${row.itemType}:${row.itemId}`)), [rows]);

  return {
    isRead: (itemType: string, itemId: string) => read.has(`${itemType}:${itemId}`),
    isNew: (itemType: string, itemId: string) => !read.has(`${itemType}:${itemId}`),
    unreadCount: (itemType: string, ids: string[]) =>
      ids.filter((id) => !read.has(`${itemType}:${id}`)).length,
    markRead: (itemType: string, itemId: string) =>
      void mutation.mutateAsync({ itemType, itemId }).catch(() => {}),
    markUnread: (itemType: string, itemId: string) =>
      void mutation.mutateAsync({ itemType, itemId, read: false }).catch(() => {}),
    /** Record several things as seen at once. Seen is not done. */
    markSeen: (items: { itemType: string; itemId: string }[]) => {
      if (items.length === 0) return;
      void markSeenCall({ data: { items } })
        .then((result) => {
          const rows = unwrap(result as never) as ReadRecord[];
          queryClient.setQueryData(["read-state"], rows);
        })
        .catch(() => {});
    },
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
  };
}
