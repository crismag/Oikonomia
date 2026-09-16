import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import {
  addEntry,
  cancelGathering,
  completeGathering,
  createGathering,
  fetchLifegroup,
  joinGathering,
  markAttendance,
  removeAttendance,
  removeEntry,
  reopenGathering,
  restoreGathering,
  setExhortation,
  setSummary,
  updateEntry,
  updateGathering,
  type LifegroupData,
} from "@/lib/lifegroup-api";
import { isConflict, unwrap, withTimeout } from "@/lib/calendar-client";
import type {
  AttendanceStatus,
  EntryVisibility,
  Exhortation,
  Gathering,
  GatheringAttendance,
  GatheringStatus,
  LifegroupEntry,
  LifegroupEntryCategory,
} from "@/domain/types";

/**
 * LifeGroup state, over real persistence.
 *
 * Everything is keyed by gathering. There is no roster to keep in sync, and
 * nothing a leader records is stored twice: the attendance marked during the
 * gathering is the same record the report and the printed page read.
 *
 * **`entries` holds only what this viewer may read.** The server filtered them
 * — a private entry never reaches the browser at all — and `withheldEntries`
 * says how many were held back without saying anything about them.
 */

/** A patch may clear an optional field by passing undefined. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export interface LifegroupStore {
  gatherings: Gathering[];
  attendance: GatheringAttendance[];
  /** Only entries this viewer may read. Never the whole set. */
  entries: LifegroupEntry[];
  /** How many were withheld. Existence acknowledged, identity never. */
  withheldEntries: number;
  exhortations: Exhortation[];
  reports: GatheringReport[];

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  saving: boolean;

  /** Marks one person at one gathering. Replaces any earlier mark for them. */
  setAttendance: (
    gatheringId: string,
    who: { personId?: string; name?: string },
    status: AttendanceStatus,
    extra?: { expected?: boolean; firstTime?: boolean },
  ) => Promise<void>;
  removeAttendance: (id: string) => Promise<void>;
  /** Everyone who signed up and has not been marked yet. */
  markExpectedPresent: (gatheringId: string, personIds: string[]) => Promise<void>;

  addEntry: (input: {
    gatheringId: string;
    authorId: string;
    body: string;
    category?: LifegroupEntryCategory;
    visibility?: EntryVisibility;
    viewerIds?: string[];
  }) => Promise<void>;
  updateEntry: (id: string, patch: Patch<LifegroupEntry>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;

  setExhortation: (
    gatheringId: string,
    patch: Patch<Omit<Exhortation, "gatheringId">>,
  ) => Promise<void>;
  setSummary: (gatheringId: string, summary: string) => Promise<void>;
  completeGathering: (gatheringId: string, byId: string) => Promise<void>;
  reopenGathering: (gatheringId: string) => Promise<void>;
  setGatheringStatus: (gatheringId: string, status: GatheringStatus) => Promise<void>;
  /** Take a gathering off the schedule; it stays in the book, marked cancelled. */
  cancelGathering: (gatheringId: string) => Promise<void>;
  /** Put a cancelled gathering back on the schedule. */
  restoreGathering: (gatheringId: string) => Promise<void>;

  /**
   * Add a row to the shared schedule.
   *
   * A date is all it takes. The schedule is a roster leaders fill in together,
   * so the venue and who leads are settled afterwards, in the table.
   */
  addGathering: (input: {
    date: string;
    venueId?: string;
    startTime?: string;
    endTime?: string;
    assignedLeaderIds?: string[];
    createdBy?: string;
  }) => Promise<string>;
  /**
   * Put your own name against a gathering, or take it off.
   *
   * Separate from `updateGathering` because they are separate rights: any
   * leader may volunteer, only campus oversight may name somebody else.
   */
  joinGathering: (gatheringId: string, action: "claim" | "join" | "leave") => Promise<void>;
  /**
   * Change what a row says.
   *
   * `assignedLeaderIds` is accepted here and refused by the service unless the
   * caller has campus oversight — naming somebody else is a different right
   * from maintaining the row, and `joinGathering` is how a leader adds or
   * removes *themselves*.
   *
   * The actor is taken from the request, never from the caller.
   *
   * `expectedVersion` is the version the caller loaded. The server refuses a
   * stale one with a conflict, and the book is refreshed either way so the
   * screen shows what is actually stored.
   */
  updateGathering: (
    gatheringId: string,
    patch: Patch<
      Pick<
        Gathering,
        | "date"
        | "startTime"
        | "endTime"
        | "venueId"
        | "assignedLeaderIds"
        | "primaryLeaderId"
        | "status"
      >
    >,
    expectedVersion: number | undefined,
  ) => Promise<void>;
}

type GatheringReport = LifegroupData["reports"][number];

const LifegroupContext = createContext<LifegroupStore | null>(null);

export function useLifegroup(): LifegroupStore {
  const value = useContext(LifegroupContext);
  if (!value) throw new Error("useLifegroup must be used inside LifegroupProvider");
  return value;
}

const EMPTY: LifegroupData = {
  gatherings: [],
  attendance: [],
  entries: [],
  withheldEntries: 0,
  exhortations: [],
  reports: [],
};

export function LifegroupProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery<LifegroupData>({
    queryKey: ["lifegroup"],
    queryFn: async () => unwrap(await withTimeout(fetchLifegroup({ data: {} }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["lifegroup"] }),
    [queryClient],
  );

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    /* A conflict means the copy on screen is out of date. Fetch the current
       one, so what the person sees next is what is stored. */
    onError: (error) => {
      if (isConflict(error)) void invalidate();
    },
    networkMode: "always" as const,
    retry: 0,
  });

  const call = useCallback(
    async (work: () => Promise<unknown>) => {
      await mutation.mutateAsync(work);
    },
    [mutation],
  );

  const data = query.data ?? EMPTY;

  const store = useMemo<LifegroupStore>(
    () => ({
      gatherings: data.gatherings,
      attendance: data.attendance,
      entries: data.entries,
      withheldEntries: data.withheldEntries,
      exhortations: data.exhortations,
      reports: data.reports,

      status: query.isError ? "error" : query.data ? "ready" : "loading",
      error: query.error,
      retry: () => void query.refetch(),
      saving: mutation.isPending,

      setAttendance: (gatheringId, who, status, extra) =>
        call(() =>
          markAttendance({
            data: {
              gatheringId,
              ...(who.personId ? { personId: who.personId } : {}),
              ...(who.name ? { name: who.name } : {}),
              status,
              ...(extra?.expected ? { expected: true } : {}),
              ...(extra?.firstTime ? { firstTime: true } : {}),
            },
          }),
        ),

      removeAttendance: (id) => call(() => removeAttendance({ data: { id } })),

      /*
       * Ticking everyone who signed up. One request each rather than a batch
       * endpoint: the list is a handful of people, and a partial failure then
       * leaves the marks that succeeded rather than losing the lot.
       */
      markExpectedPresent: async (gatheringId, personIds) => {
        for (const personId of personIds) {
          await call(() =>
            markAttendance({
              data: { gatheringId, personId, status: "present", expected: true },
            }),
          );
        }
      },

      addEntry: (input) =>
        call(() =>
          addEntry({
            data: {
              gatheringId: input.gatheringId,
              body: input.body,
              ...(input.category ? { category: input.category } : {}),
              ...(input.visibility ? { visibility: input.visibility } : {}),
              ...(input.viewerIds ? { viewerIds: input.viewerIds } : {}),
            },
          }),
        ),

      updateEntry: (id, patch) => call(() => updateEntry({ data: { id, patch } })),
      removeEntry: (id) => call(() => removeEntry({ data: { id } })),

      setExhortation: (gatheringId, patch) =>
        call(() => setExhortation({ data: { gatheringId, topic: patch.topic ?? "", ...patch } })),

      setSummary: (gatheringId, summary) =>
        call(() => setSummary({ data: { gatheringId, summary } })),

      completeGathering: (gatheringId) =>
        call(() => completeGathering({ data: { id: gatheringId } })),

      reopenGathering: (gatheringId) => call(() => reopenGathering({ data: { id: gatheringId } })),

      /*
       * Status is a consequence of completing or reopening a report, not a
       * field anybody sets on its own — so this exists to satisfy the store's
       * shape and routes the two states that have meaning.
       */
      setGatheringStatus: (gatheringId, status) =>
        status === "completed"
          ? call(() => completeGathering({ data: { id: gatheringId } }))
          : call(() => reopenGathering({ data: { id: gatheringId } })),

      cancelGathering: (gatheringId) => call(() => cancelGathering({ data: { id: gatheringId } })),
      restoreGathering: (gatheringId) =>
        call(() => restoreGathering({ data: { id: gatheringId } })),

      addGathering: async (input) => {
        const created = unwrap(
          (await withTimeout(
            createGathering({
              data: {
                date: input.date,
                /* A date is enough: the rest of the row is settled inline. */
                ...(input.venueId ? { venueId: input.venueId } : {}),
                ...(input.assignedLeaderIds?.length
                  ? { assignedLeaderIds: input.assignedLeaderIds }
                  : {}),
                ...(input.startTime ? { startTime: input.startTime } : {}),
                ...(input.endTime ? { endTime: input.endTime } : {}),
              },
            }),
          )) as never,
        ) as Gathering;
        void invalidate();
        return created.id;
      },

      joinGathering: (gatheringId, action) =>
        call(() => joinGathering({ data: { gatheringId, action } })),

      updateGathering: (gatheringId, patch, expectedVersion) =>
        call(() =>
          updateGathering({
            data: {
              id: gatheringId,
              patch,
              ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            },
          }),
        ),
    }),
    [data, query, mutation.isPending, call, invalidate],
  );

  return <LifegroupContext.Provider value={store}>{children}</LifegroupContext.Provider>;
}
