import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  createAgendaItem,
  createCalendarEntry,
  deleteAgendaItem,
  deleteCalendarEntry,
  duplicateCalendarEntry,
  fetchCalendarRange,
  updateAgendaItem,
  updateCalendarEntry,
} from "@/lib/calendar-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { CalendarRange } from "@/lib/calendar-api";
import { shiftMonth, toISO } from "@/domain/schedule";
import type { AgendaItem, RecurrenceScope, ScheduleEntry } from "@/domain/types";

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
 * Schedule state, over real persistence.
 *
 * The screens above this file did not change when the calendar stopped being
 * an array in memory and became rows in SQLite, which is the whole point of
 * §3: a route component asks a provider for data and calls provider methods to
 * change it, and cannot tell where the data lives.
 *
 * What is new is that those calls now take time and can fail, so the store
 * reports `status`, `error` and `saving` — §20 requires every backend-connected
 * screen to have somewhere to say "loading", "empty" and "that did not work",
 * and forbids leaving a button apparently idle during a save.
 *
 * Ticking an agenda item off still means the leader did it. It raises no
 * workflow event, no audit record and no notification (SCHEDULE.md).
 */

export interface ScheduleStore {
  entries: ScheduleEntry[];
  agenda: AgendaItem[];

  /** What the screen may show: the data, a spinner, or an explanation. */
  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  /** True while any mutation is in flight, so a control can say so. */
  saving: boolean;

  /**
   * The window currently loaded.
   *
   * A calendar is read by period, not by page, so the screens say which period
   * they are showing and the provider fetches it. Navigating to another month
   * is a different question, not another page of the same one.
   */
  range: { from: string; to: string };
  setRange: (from: string, to: string) => void;

  addEntry: (entry: Omit<ScheduleEntry, "id">) => Promise<void>;
  updateEntry: (id: string, patch: Partial<ScheduleEntry>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  /**
   * Deleting a repeating entry, at the scope the leader chose.
   *
   * "This occurrence" records a skip; "this and following" ends the rhythm the
   * day before. Neither rewrites what already happened — history stays. The
   * rule itself lives in the service, so every caller gets it.
   */
  removeOccurrence: (id: string, date: string, scope: RecurrenceScope) => Promise<void>;
  /** Editing at the chosen scope. One occurrence becomes its own entry. */
  editOccurrence: (
    id: string,
    date: string,
    scope: RecurrenceScope,
    patch: Partial<ScheduleEntry>,
  ) => Promise<void>;
  /** Church work repeats without being a formal series; copying is common. */
  duplicateEntry: (id: string, date: string) => Promise<void>;

  addAgenda: (item: Omit<AgendaItem, "id" | "completed">) => Promise<void>;
  updateAgenda: (id: string, patch: Partial<AgendaItem>) => Promise<void>;
  toggleAgenda: (id: string) => Promise<void>;
  removeAgenda: (id: string) => Promise<void>;
}

const ScheduleContext = createContext<ScheduleStore | null>(null);

export function useSchedule(): ScheduleStore {
  const value = useContext(ScheduleContext);
  if (!value) throw new Error("useSchedule must be used inside ScheduleProvider");
  return value;
}

/**
 * The window loaded before a screen asks for its own.
 *
 * Three months around today, because the home page shows this week, the week
 * view shows this week, and the month grid shows a month that overhangs into
 * its neighbours. Screens that navigate elsewhere call `setRange`.
 */
function defaultRange() {
  const today = toISO(new Date());
  return {
    from: `${shiftMonth(today, -1).slice(0, 7)}-01`,
    to: `${shiftMonth(today, 2).slice(0, 7)}-01`,
  };
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [range, setRangeState] = useState(defaultRange);

  const query = useQuery<CalendarRange>({
    queryKey: ["calendar", range.from, range.to],
    queryFn: async () => unwrap(await withTimeout(fetchCalendarRange({ data: range }))),
    /*
     * No `placeholderData`. Keeping the previous period's entries while the
     * next one loads sounds kind and is a lie: the screens filter by date, so
     * last month's entries against this month's days render as "Nothing
     * scheduled" — a confident, wrong answer. A skeleton says "not yet", which
     * is the truth.
     */
    /*
     * One retry, then say so. The default — three tries with backoff — leaves
     * a leader watching a skeleton for the better part of ten seconds before
     * anything admits a problem, which reads as a hung page rather than as a
     * failure they can act on.
     */
    retry: 1,
    retryDelay: 500,
    /*
     * React Query pauses a query when the browser reports itself offline,
     * which leaves the screen on a skeleton that never resolves rather than on
     * an error it can explain. `navigator.onLine` is a poor proxy for "can we
     * reach our own server" anyway, so the request is attempted and the
     * timeout above decides.
     */
    networkMode: "always",
  });

  /* Every mutation invalidates the calendar rather than patching the cache by
     hand: the server decides what a change means — a skipped week, a detached
     occurrence, an ended rhythm — and guessing here would eventually disagree
     with it. §20 also warns against optimistic updates unless clearly safe. */
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
    [queryClient],
  );

  /* Mutations never retry: a create that is retried after a timeout is how one
     event becomes two. They report the failure and let the leader decide. */
  const mutationOptions = {
    mutationFn: runCalendarCall,
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  };
  const entryMutation = useMutation(mutationOptions);
  const agendaMutation = useMutation(mutationOptions);

  const entries = query.data?.entries ?? NONE;
  const agenda = query.data?.agenda ?? NONE;

  const call = useCallback(
    async (work: () => Promise<unknown>) => {
      await entryMutation.mutateAsync(work);
    },
    [entryMutation],
  );

  const setRange = useCallback((from: string, to: string) => {
    setRangeState((current) =>
      current.from === from && current.to === to ? current : { from, to },
    );
  }, []);

  const store = useMemo<ScheduleStore>(
    () => ({
      entries,
      agenda,
      /*
       * Error wins over data. A fetch that failed must not fall through to
       * whatever happened to be in hand — "Nothing scheduled" is a claim, and
       * the calendar is in no position to make it.
       */
      status: query.isError ? "error" : query.data ? "ready" : "loading",
      error: query.error,
      retry: () => void query.refetch(),
      saving: entryMutation.isPending || agendaMutation.isPending,
      range,
      setRange,

      addEntry: (entry) => call(() => createCalendarEntry({ data: entry })),

      updateEntry: (id, patch) => call(() => updateCalendarEntry({ data: { id, patch } })),

      removeEntry: (id) => call(() => deleteCalendarEntry({ data: { id } })),

      removeOccurrence: (id, date, scope) =>
        call(() => deleteCalendarEntry({ data: { id, occurrenceDate: date, scope } })),

      editOccurrence: (id, date, scope, patch) =>
        call(() => updateCalendarEntry({ data: { id, patch, occurrenceDate: date, scope } })),

      duplicateEntry: (id, date) => call(() => duplicateCalendarEntry({ data: { id, date } })),

      addAgenda: (item) => call(() => createAgendaItem({ data: item })),

      updateAgenda: (id, patch) => call(() => updateAgendaItem({ data: { id, patch } })),

      toggleAgenda: async (id) => {
        const item = agenda.find((a) => a.id === id);
        if (!item) return;
        await call(() => updateAgendaItem({ data: { id, patch: { completed: !item.completed } } }));
      },

      removeAgenda: (id) => call(() => deleteAgendaItem({ data: { id } })),
    }),
    [
      entries,
      agenda,
      query,
      entryMutation.isPending,
      agendaMutation.isPending,
      range,
      setRange,
      call,
    ],
  );

  return <ScheduleContext.Provider value={store}>{children}</ScheduleContext.Provider>;
}

/**
 * Run one server call and turn its envelope into a value or a throw.
 *
 * `unwrap` raises a `CalendarError` carrying the field messages, which is what
 * lets a form point at the input that was wrong instead of showing one
 * sentence above everything.
 */
async function runCalendarCall(work: () => Promise<unknown>) {
  const result = (await withTimeout(work())) as Parameters<typeof unwrap>[0];
  return unwrap(result);
}
