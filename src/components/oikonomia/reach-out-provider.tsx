import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  addReachOutComment,
  createReachOutReport,
  deleteReachOutReport,
  fetchReachOut,
  fetchReachOutReport,
  updateReachOutReport,
  type ReportPage,
} from "@/lib/reach-out-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { config } from "@/config";
import type { ReachOutReport } from "@/domain/types";

/**
 * Reach-Out state, over real persistence.
 *
 * Reach-Out is shared leadership work: any leader may continue any report, and
 * `authorId` is provenance rather than ownership. The server records whoever
 * contributes, so the page can say who has worked on a report without implying
 * that any of them owns it.
 *
 * No viewer filtering happens anywhere in this module. Sharing rules for
 * Reach-Out are an open product decision — see `server/services/reach-out-service.ts`
 * for why that is stated rather than guessed at.
 *
 * ## Writing is local first
 *
 * A report is typed, and `onChange` fires per character. A round trip per
 * character would make the textarea lag behind the keyboard and would lose
 * whatever was typed while a request was in flight. So an edit lands in a local
 * draft synchronously — that draft is what the page renders — and a save of the
 * whole report is scheduled behind a short debounce. A failed save keeps the
 * draft: a leader's paragraph is not lost because a request was.
 *
 * ## And it states which version it was written from
 *
 * Two leaders continuing one report is the ordinary use of this module, not an
 * edge case. Each save carries the version its draft was made from; the server
 * refuses one made from a version somebody else has moved past, and `saveError`
 * carries that back so the page can say so instead of quietly discarding
 * whichever of them saved second.
 */

export interface ReachOutQuery {
  page?: number;
  pageSize?: number;
  search?: string | undefined;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ReachOutStore {
  reports: ReachOutReport[];

  query: ReachOutQuery;
  setQuery: (next: ReachOutQuery) => void;
  page: { page: number; pageSize: number; pageCount: number; total: number };

  /** Which report is open, so it can be fetched even if it is not on this page. */
  select: (id: string | null) => void;
  /**
   * The report `select` last named. A page compares it with its own id before
   * concluding a report is missing: until they match, nobody has asked yet.
   */
  selectedId: string | null;

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  saving: boolean;

  /** Whether what is on screen has reached the database yet. */
  saveState: SaveState;
  /** Why the last save did not land — a conflict reads differently from a
      network failure, and the page says which. */
  saveError: unknown;
  /**
   * Write pending edits now. Called when the editor closes, and resolves to
   * whether everything landed — so a caller about to navigate away can stop
   * and show what was refused instead.
   */
  flush: () => Promise<boolean>;
  /** Throw away the local draft and take the server's copy. After a conflict,
      this is what "reopen it" does. */
  discardDraft: (id: string) => void;

  /** Starts an empty report and hands back its id so the caller can open it. */
  createReport: (authorId: string, reportDate: string) => Promise<string>;
  /**
   * Any leader may update any report. `editorId` is recorded as provenance so
   * the page can say who has worked on it — never to gate who may.
   */
  updateReport: (
    id: string,
    patch: Partial<Pick<ReachOutReport, "title" | "reportDate" | "content">>,
    editorId: string,
  ) => void;
  removeReport: (id: string) => Promise<void>;
  addComment: (reportId: string, authorId: string, body: string) => Promise<void>;
}

const ReachOutContext = createContext<ReachOutStore | null>(null);

export function useReachOut(): ReachOutStore {
  const value = useContext(ReachOutContext);
  if (!value) throw new Error("useReachOut must be used inside ReachOutProvider");
  return value;
}

const EMPTY = { page: 1, pageSize: 25, pageCount: 1, total: 0 };

/** Long enough that a sentence is one save, short enough to feel immediate. */
/* How long typing settles before a draft is written. Configuration: a
   church on a slow connection may want longer. */
const FLUSH_DELAY_MS = config.cadence.autosaveDelayMs;

export function ReachOutProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<ReachOutQuery>({ page: 1, pageSize: 25 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* Reports edited but not yet confirmed saved. What the page renders. */
  const [drafts, setDrafts] = useState<Record<string, ReachOutReport>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const reportsQuery = useQuery<ReportPage>({
    queryKey: ["reach-out", query],
    queryFn: async () => unwrap(await withTimeout(fetchReachOut({ data: query }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const openQuery = useQuery<ReachOutReport>({
    queryKey: ["reach-out-report", selectedId],
    queryFn: async () =>
      unwrap(await withTimeout(fetchReachOutReport({ data: { id: selectedId! } }))),
    enabled: !!selectedId,
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["reach-out"] });
    void queryClient.invalidateQueries({ queryKey: ["reach-out-report"] });
  }, [queryClient]);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const flushReport = useCallback(
    async (id: string): Promise<boolean> => {
      const draft = draftsRef.current[id];
      if (!draft) return true;

      timers.current.delete(id);
      setSaveState("saving");
      setSaveError(null);

      try {
        const saved = unwrap(
          (await withTimeout(
            updateReachOutReport({
              data: {
                id,
                patch: {
                  title: draft.title,
                  reportDate: draft.reportDate,
                  content: draft.content,
                },
                ...(draft.version === undefined ? {} : { expectedVersion: draft.version }),
              },
            }),
          )) as never,
        ) as ReachOutReport;

        /*
         * Drop the draft only if nothing was typed while the save was in
         * flight. Otherwise the newer text is still unsaved, and it has to
         * carry the version the server just issued or the next save looks
         * stale when it is not.
         */
        setDrafts((current) => {
          const newer = current[id];
          if (newer && newer !== draft) {
            return saved.version === undefined
              ? current
              : { ...current, [id]: { ...newer, version: saved.version } };
          }
          const { [id]: _done, ...rest } = current;
          return rest;
        });
        setSaveState("saved");
        invalidate();
        return true;
      } catch (error) {
        /* Keep the draft. A paragraph is not lost because a request was. */
        setSaveState("error");
        setSaveError(error);
        return false;
      }
    },
    [invalidate],
  );

  const schedule = useCallback(
    (id: string) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      setSaveState("saving");
      timers.current.set(
        id,
        setTimeout(() => void flushReport(id), FLUSH_DELAY_MS),
      );
    },
    [flushReport],
  );

  const flush = useCallback(async () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    const landed = await Promise.all(Object.keys(draftsRef.current).map((id) => flushReport(id)));
    return landed.every(Boolean);
  }, [flushReport]);

  /* A report left unsaved when the tab closes is what a debounce risks. */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(draftsRef.current).length > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const call = useCallback(
    async (work: () => Promise<unknown>) => {
      await mutation.mutateAsync(work);
    },
    [mutation],
  );

  /* The open report is merged in, so a link to one on another page works, and
     any draft wins over the server's copy — it is the newer of the two. */
  const reports = useMemo(() => {
    const page = reportsQuery.data?.reports ?? [];
    const open = openQuery.data;
    const merged = !open || page.some((r) => r.id === open.id) ? page : [open, ...page];
    return merged.map((report) => drafts[report.id] ?? report);
  }, [reportsQuery.data, openQuery.data, drafts]);

  const store = useMemo<ReachOutStore>(
    () => ({
      reports,
      query,
      setQuery,
      page: reportsQuery.data?.page ?? EMPTY,

      select: setSelectedId,
      selectedId,

      /* Still loading while the open report is on its way: a report created a
         moment ago is on no page of the list yet. */
      status:
        reportsQuery.isError || openQuery.isError
          ? "error"
          : reportsQuery.data && !(selectedId && openQuery.isPending)
            ? "ready"
            : "loading",
      error: reportsQuery.error,
      retry: () => void reportsQuery.refetch(),
      saving: mutation.isPending,

      createReport: async (_authorId, reportDate) => {
        /* The author is taken from the request, never from the caller. */
        const created = unwrap(
          (await withTimeout(createReachOutReport({ data: { reportDate } }))) as never,
        ) as ReachOutReport;
        void invalidate();
        return created.id;
      },

      saveState,
      saveError,
      flush,
      discardDraft: (id) => {
        const timer = timers.current.get(id);
        if (timer) clearTimeout(timer);
        timers.current.delete(id);
        setDrafts(({ [id]: _dropped, ...rest }) => rest);
        setSaveState("idle");
        setSaveError(null);
        invalidate();
      },

      /* Synchronous, so typing is typing. The save follows on a debounce. */
      updateReport: (id, patch) => {
        const current = drafts[id] ?? reports.find((r) => r.id === id);
        if (!current) return;
        setDrafts((existing) => ({ ...existing, [id]: { ...current, ...patch } }));
        schedule(id);
      },
      removeReport: (id) => call(() => deleteReachOutReport({ data: { id } })),

      addComment: (reportId, _authorId, body) =>
        call(() => addReachOutComment({ data: { reportId, body } })),
    }),
    [
      reports,
      drafts,
      reportsQuery,
      openQuery,
      selectedId,
      query,
      mutation.isPending,
      saveState,
      saveError,
      schedule,
      flush,
      call,
      invalidate,
    ],
  );

  return <ReachOutContext.Provider value={store}>{children}</ReachOutContext.Provider>;
}
