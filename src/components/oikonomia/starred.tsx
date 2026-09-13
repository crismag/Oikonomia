import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Star } from "lucide-react";

import { fetchStarred, setStarred, type StarredRecord } from "@/lib/starred-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";

const NONE: never[] = [];

/**
 * What this person has starred, across every kind of record.
 *
 * One query for the whole viewer, the way `useReadState` reads all of read
 * state at once: a list page needs to know, for everything it renders,
 * whether each item is starred, so fetching item-by-item would only trade one
 * round trip for many.
 */
export function useStarred() {
  const queryClient = useQueryClient();

  const query = useQuery<StarredRecord[]>({
    queryKey: ["starred"],
    queryFn: async () => unwrap(await withTimeout(fetchStarred({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (input: { itemType: string; itemId: string; starred?: boolean }) =>
      unwrap((await withTimeout(setStarred({ data: input }))) as never) as StarredRecord[],
    onSuccess: (rows: StarredRecord[]) => queryClient.setQueryData(["starred"], rows),
    networkMode: "always" as const,
    retry: 0,
  });

  const rows = query.data ?? NONE;
  const starred = useMemo(
    () => new Set(rows.map((row) => `${row.itemType}:${row.itemId}`)),
    [rows],
  );

  return {
    isStarred: (itemType: string, itemId: string) => starred.has(`${itemType}:${itemId}`),
    star: (itemType: string, itemId: string) =>
      void mutation.mutateAsync({ itemType, itemId }).catch(() => {}),
    unstar: (itemType: string, itemId: string) =>
      void mutation.mutateAsync({ itemType, itemId, starred: false }).catch(() => {}),
    toggle: (itemType: string, itemId: string) =>
      void mutation
        .mutateAsync({ itemType, itemId, starred: !starred.has(`${itemType}:${itemId}`) })
        .catch(() => {}),
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
  };
}

/**
 * Put whatever this viewer has starred first, stable otherwise.
 *
 * A star is a private override of ordering, not a filter: starring an item
 * moves it to the top of whatever sort or grouping is in effect without
 * removing anything else from the list.
 */
export function starredFirst<T>(items: T[], isStarred: (item: T) => boolean): T[] {
  const starred: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isStarred(item) ? starred : rest).push(item);
  return [...starred, ...rest];
}

/** A star toggle, sized for a list row. Stops the row's own link from firing. */
export function StarButton({
  starred,
  onToggle,
  label,
}: {
  starred: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      title={starred ? `Unstar ${label}` : `Star ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "-m-1 shrink-0 rounded p-1 transition-colors",
        starred
          ? "text-status-waiting hover:text-status-waiting/80"
          : "text-muted-foreground/50 hover:text-muted-foreground",
      )}
    >
      <Star className="size-4" aria-hidden fill={starred ? "currentColor" : "none"} />
      <span className="sr-only">{starred ? `Unstar ${label}` : `Star ${label}`}</span>
    </button>
  );
}
