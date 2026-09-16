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
  commentOnReport,
  createReport as createReportCall,
  fetchReport as fetchReportCall,
  fetchReports,
  removeReport as removeReportCall,
  transitionReport,
  updateReport as updateReportCall,
  writeReport,
  type ReportList,
} from "@/lib/reports-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { config } from "@/config";
import { reportCapabilities } from "@/domain/leadership-report";
import { useViewer } from "@/domain/session";
import { useOrganization } from "./organization-provider";
import type {
  ContentSource,
  LeadershipReport,
  MeetingBlock,
  ReportCapabilities,
  ReportType,
  ReportVisibility,
} from "@/domain/types";

/**
 * Leadership Reports state.
 *
 * **The gate is the server's.** `visible` is what the service returned, which
 * is already `canDiscover`-filtered, and a report this viewer may not discover
 * is not in the browser at all — not its title, not its subject, not its
 * existence. `withheld` is a number the service computed, which is the one
 * thing about them that may be said.
 *
 * `can` still runs in the browser, over reports the viewer already has. That is
 * not the enforcement — every capability is checked again in the service, where
 * a caller cannot decline to ask — it is so the interface can decline to draw a
 * control that would be refused.
 *
 * ## Writing is local first
 *
 * A report is typed into, so an edit lands in a local draft synchronously and a
 * save is scheduled behind a short debounce. A failed save keeps the draft.
 * Metadata and content are two calls because they are two different rules on
 * the server — who may read a report is the author's to set for as long as it
 * is not archived, while what it says stops being editable when it is
 * submitted.
 */

/** A patch may name a field to clear, which `Partial<T>` alone cannot express. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export type EditablePatch = Patch<
  Pick<
    LeadershipReport,
    | "title"
    | "reportType"
    | "reportingPeriod"
    | "subjectId"
    | "subjectText"
    | "relatedText"
    | "visibility"
    | "audienceIds"
    | "commenterIds"
    | "discussionPolicy"
    | "confidential"
    | "tags"
    | "links"
    | "relatedDocumentIds"
    | "primaryDocumentId"
  >
>;

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ReportStore {
  /** Reports this viewer may discover. The only list anything should render. */
  visible: LeadershipReport[];
  /** How many were withheld. A number, never the reports themselves. */
  withheld: number;
  byId: (id: string) => LeadershipReport | undefined;
  can: (report: LeadershipReport) => ReportCapabilities;

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  saveState: SaveState;
  saveError: unknown;
  /** Write pending edits now. Resolves to whether everything landed. */
  flush: () => Promise<boolean>;

  createReport: (input: {
    authorId: string;
    reportType: ReportType;
    contentSource: ContentSource;
    title?: string;
    primaryDocumentId?: string;
    /* Where it is being written, what kind it is, and who may read it — all
       settable at creation, because a concern about one person must be
       restricted before the words exist, not afterwards. */
    contextType?: LeadershipReport["contextType"];
    contextId?: string;
    category?: string;
    visibility?: ReportVisibility;
    audienceIds?: string[];
    subjectId?: string;
  }) => Promise<string>;
  updateReport: (id: string, patch: EditablePatch) => void;
  setBlocks: (id: string, blocks: MeetingBlock[]) => void;
  /**
   * Delete a report outright. Resolves once the server has removed it and
   * rejects with its refusal, so the page leaves only when there is nothing
   * left to come back to.
   */
  removeReport: (id: string) => Promise<void>;

  /**
   * Move a report to another stage.
   *
   * One call taking a status id, rather than four named ones. The interface
   * offers the stages this church configured and the server decides what each
   * move does — neither of them knows a stage called "published".
   */
  moveTo: (id: string, to: string) => void;

  addComment: (id: string, authorId: string, body: string) => void;
}

const ReportContext = createContext<ReportStore | null>(null);

export function useReports(): ReportStore {
  const value = useContext(ReportContext);
  if (!value) throw new Error("useReports must be used inside ReportProvider");
  return value;
}

/* How long typing settles before a draft is written. Configuration: a
   church on a slow connection may want longer. */
const FLUSH_DELAY_MS = config.cadence.autosaveDelayMs;

/** Which fields a flush sends as metadata rather than as content. */
const METADATA_KEYS: (keyof EditablePatch)[] = [
  "title",
  "reportType",
  "reportingPeriod",
  "subjectId",
  "subjectText",
  "relatedText",
  "visibility",
  "audienceIds",
  "commenterIds",
  "discussionPolicy",
  "confidential",
  "tags",
  "links",
  "relatedDocumentIds",
  "primaryDocumentId",
];

export function ReportProvider({ children }: { children: ReactNode }) {
  const { persona, person } = useViewer();
  const { leadershipGroupIds } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery<ReportList>({
    queryKey: ["leadership-reports"],
    queryFn: async () => unwrap(await withTimeout(fetchReports({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  /* Reports edited but not yet confirmed saved. What the pages render. */
  const [drafts, setDrafts] = useState<Record<string, LeadershipReport>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  /* Which fields of each draft are actually unsaved, so a flush sends what
     changed rather than rewriting fields the leader never touched. */
  const pending = useRef(new Map<string, Set<keyof EditablePatch | "blocks">>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["leadership-reports"] });
    void queryClient.invalidateQueries({ queryKey: ["leadership-report-open"] });
  }, [queryClient]);

  const flushReport = useCallback(
    async (id: string): Promise<boolean> => {
      const draft = draftsRef.current[id];
      const changed = pending.current.get(id);
      if (!draft || !changed || changed.size === 0) return true;

      timers.current.delete(id);
      setSaveState("saving");
      setSaveError(null);

      const metadata: Record<string, unknown> = {};
      for (const key of METADATA_KEYS) {
        if (changed.has(key)) metadata[key] = draft[key];
      }

      try {
        /*
         * Metadata first, because it is the call that may be refused on a
         * different rule — and because it moves the version, which the content
         * save then has to state.
         */
        if (Object.keys(metadata).length > 0) {
          unwrap((await withTimeout(updateReportCall({ data: { id, patch: metadata } }))) as never);
        }
        if (changed.has("blocks")) {
          unwrap(
            (await withTimeout(writeReport({ data: { id, blocks: draft.blocks ?? [] } }))) as never,
          );
        }

        pending.current.delete(id);
        setDrafts((current) => {
          const { [id]: _done, ...rest } = current;
          return rest;
        });
        setSaveState("saved");
        invalidate();
        return true;
      } catch (error) {
        /* Keep the draft. A leader's paragraph is not lost because a request
           was, and a refused change must be visible rather than discarded. */
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

  /* Drafts win over the server's copy — they are the newer of the two. */
  const visible = useMemo(
    () => (query.data?.reports ?? []).map((report) => drafts[report.id] ?? report),
    [query.data, drafts],
  );

  const byId = useCallback((id: string) => visible.find((r) => r.id === id), [visible]);

  /* The same groups the server resolved the audience against. If the two
     disagreed, the interface would offer an action the server then refused. */
  const can = useCallback(
    (report: LeadershipReport) => reportCapabilities(report, persona, person, leadershipGroupIds),
    [persona, person, leadershipGroupIds],
  );

  const mutate = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    onError: (error) => {
      setSaveState("error");
      setSaveError(error);
    },
    networkMode: "always" as const,
    retry: 0,
  });

  const act = useCallback(
    (work: () => Promise<unknown>) => {
      setSaveError(null);
      void mutate.mutateAsync(work).catch(() => {
        /* Rendered from `saveError`; nothing to do here. */
      });
    },
    [mutate],
  );

  const edit = useCallback(
    (
      id: string,
      apply: (report: LeadershipReport) => LeadershipReport,
      keys: (keyof EditablePatch | "blocks")[],
    ) => {
      const current = draftsRef.current[id] ?? query.data?.reports.find((r) => r.id === id);
      if (!current) return;
      setDrafts((existing) => ({ ...existing, [id]: apply(current) }));
      const changed = pending.current.get(id) ?? new Set<keyof EditablePatch | "blocks">();
      for (const key of keys) changed.add(key);
      pending.current.set(id, changed);
      schedule(id);
    },
    [query.data, schedule],
  );

  const value = useMemo<ReportStore>(
    () => ({
      visible,
      withheld: query.data?.withheld ?? 0,
      byId,
      can,

      status: query.isError ? "error" : query.data ? "ready" : "loading",
      error: query.error,
      retry: () => void query.refetch(),
      saveState,
      saveError,
      flush,

      createReport: async (input) => {
        const created = unwrap(
          (await withTimeout(
            createReportCall({
              data: {
                reportType: input.reportType,
                contentSource: input.contentSource,
                title: input.title ?? "",
                ...(input.primaryDocumentId ? { primaryDocumentId: input.primaryDocumentId } : {}),
                ...(input.contextType ? { contextType: input.contextType } : {}),
                ...(input.contextId ? { contextId: input.contextId } : {}),
                ...(input.category ? { category: input.category } : {}),
                ...(input.visibility ? { visibility: input.visibility } : {}),
                ...(input.audienceIds ? { audienceIds: input.audienceIds } : {}),
                ...(input.subjectId ? { subjectId: input.subjectId } : {}),
              },
            }),
          )) as never,
        ) as LeadershipReport;
        /* Into the list before anybody navigates to it. Waiting for the refetch
           meant the new report's page opened on a list that did not have it yet,
           and answered "not found" for a report that had just been written. */
        queryClient.setQueryData<ReportList>(["leadership-reports"], (current) =>
          current && !current.reports.some((r) => r.id === created.id)
            ? { ...current, reports: [created, ...current.reports] }
            : current,
        );
        invalidate();
        return created.id;
      },

      updateReport: (id, patch) =>
        edit(
          id,
          (report) => {
            const next = { ...report };
            for (const [key, v] of Object.entries(patch)) {
              if (v === undefined) delete (next as Record<string, unknown>)[key];
              else (next as Record<string, unknown>)[key] = v;
            }
            return next;
          },
          Object.keys(patch) as (keyof EditablePatch)[],
        ),

      setBlocks: (id, blocks) => edit(id, (report) => ({ ...report, blocks }), ["blocks"]),

      removeReport: async (id) => {
        /* A pending save of a report being deleted would race the delete, and
           landing after it would be refused. Hold it; if the delete is refused
           the edits are still the leader's and are saved as usual. */
        const timer = timers.current.get(id);
        if (timer) clearTimeout(timer);
        timers.current.delete(id);
        setSaveError(null);
        try {
          await mutate.mutateAsync(() => removeReportCall({ data: { id } }));
        } catch (error) {
          if (pending.current.has(id)) schedule(id);
          throw error;
        }
        pending.current.delete(id);
        setDrafts((current) => {
          const { [id]: _gone, ...rest } = current;
          return rest;
        });
      },

      moveTo: (id, to) => act(() => transitionReport({ data: { id, to } })),

      /* The author is taken from the request, never from the caller. */
      addComment: (id, _authorId, body) =>
        act(() => commentOnReport({ data: { reportId: id, body } })),
    }),
    [
      visible,
      query,
      byId,
      can,
      saveState,
      saveError,
      flush,
      edit,
      act,
      invalidate,
      queryClient,
      mutate,
      schedule,
    ],
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

/**
 * One report, as this viewer may read it now.
 *
 * Usually the listed copy. A confidential report reaches everyone but its
 * author without its content, so here it is fetched on its own — which is the
 * read the server records. Not cached between visits (`gcTime: 0`) and not
 * refetched on focus: each time the report is opened is one recorded read, no
 * more and no fewer.
 */
export function useOpenedReport(id: string): {
  report: LeadershipReport | undefined;
  opening: boolean;
  failed: boolean;
  retry: () => void;
} {
  const store = useReports();
  const listed = store.byId(id);
  const withheld = !!listed?.contentWithheld;

  const opened = useQuery<LeadershipReport>({
    queryKey: ["leadership-report-open", id],
    queryFn: async () => unwrap(await withTimeout(fetchReportCall({ data: { id } }))),
    enabled: withheld,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
    networkMode: "always",
  });

  if (!withheld) return { report: listed, opening: false, failed: false, retry: () => {} };
  return {
    report: opened.data,
    opening: opened.isPending && !opened.isError,
    failed: opened.isError,
    retry: () => void opened.refetch(),
  };
}
