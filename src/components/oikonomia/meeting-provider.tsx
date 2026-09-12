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
  createMeetingTask,
  createNote as createNoteCall,
  deleteMeetingTask,
  deleteNote as deleteNoteCall,
  fetchMyTasks,
  fetchNote,
  fetchNotes,
  type NotePage,
  updateMeetingTask,
  updateNote as updateNoteCall,
} from "@/lib/meeting-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { config } from "@/config";
import { emptyBlock, newBlockId, startingBlocks } from "@/domain/meeting";
import { toISO } from "@/domain/schedule";
import type {
  MeetingBlock,
  MeetingBlockType,
  MeetingNote,
  MeetingNoteType,
  MeetingTask,
} from "@/domain/types";

/**
 * Meeting Notes state, over real persistence.
 *
 * ## The problem this file exists to solve
 *
 * A calendar entry is saved when a leader presses Add. A meeting note is typed
 * into, during a meeting, one keystroke at a time — and `onInput` fires on
 * every one of them. A round trip per keystroke would be unusable and would
 * also lose characters the moment the network hiccuped.
 *
 * So edits are **local first**. A block change updates a draft synchronously,
 * which is what makes typing feel like typing, and a flush of the whole note is
 * scheduled behind a short debounce. The draft is the truth until the server
 * confirms it, and it is *kept* if the save fails — a leader's sentence is not
 * something to lose because a request did.
 *
 * Tasks are different and are saved immediately: creating one is a deliberate
 * act, not a character.
 *
 * ## What did not change
 *
 * The editor's interface. `setBlockHtml`, `insertAfter` and the rest still
 * return synchronously, still return the new block's id for focus, and know
 * nothing about persistence — §3.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

/** A patch may clear an optional field by passing undefined. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export interface MeetingStore {
  notes: MeetingNote[];
  tasks: MeetingTask[];

  /** What the list is asking for. The screen owns the filters; this fetches. */
  query: ListQuery;
  setQuery: (next: ListQuery) => void;
  page: { page: number; pageSize: number; pageCount: number; total: number };
  /**
   * The filter options worth offering.
   *
   * Across everything the viewer may read, not across the page in hand — a tag
   * that disappears from the filter bar because you turned to page two is a
   * filter that cannot be trusted.
   */
  facets: { tags: string[]; ministryIds: string[] };

  /** Which note is open on the writing surface, if any. */
  select: (id: string | null) => void;

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;

  /** Whether what is on screen has reached the database yet. */
  saveState: SaveState;
  saveError: unknown;
  /** Write any pending edits now — called when the note closes. */
  flush: () => Promise<void>;

  createNote: (input: {
    authorId: string;
    noteType: MeetingNoteType;
    title?: string;
    type?: MeetingNote["type"];
    ministryId?: string;
  }) => Promise<string>;
  updateNote: (id: string, patch: Patch<MeetingNote>) => void;
  removeNote: (id: string) => Promise<void>;

  setBlockHtml: (noteId: string, blockId: string, html: string) => void;
  setBlockType: (noteId: string, blockId: string, type: MeetingBlockType) => void;
  insertAfter: (noteId: string, blockId: string) => string;
  removeBlock: (noteId: string, blockId: string) => void;
  toggleCheck: (noteId: string, blockId: string) => void;
  cycleFollowUp: (noteId: string, blockId: string) => void;

  createTask: (input: {
    meetingId: string;
    title: string;
    blockId?: string;
    assigneeId?: string;
    dueDate?: string;
  }) => void;
  updateTask: (id: string, patch: Patch<MeetingTask>) => void;
  removeTask: (id: string) => void;
  /** Carries unresolved items from an earlier meeting into this one. */
  bringForward: (noteId: string, items: { text: string; kind: "follow-up" | "task" }[]) => void;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string | undefined;
  noteType?: MeetingNoteType | undefined;
  tag?: string | undefined;
  ministryId?: string | undefined;
}

const MeetingContext = createContext<MeetingStore | null>(null);

export function useMeetings(): MeetingStore {
  const value = useContext(MeetingContext);
  if (!value) throw new Error("useMeetings must be used inside MeetingProvider");
  return value;
}

/**
 * How long to wait before writing.
 *
 * Long enough that ordinary typing produces one save rather than thirty; short
 * enough that a leader who stops to think has already been saved by the time
 * they look up.
 */
const FLUSH_DELAY_MS = config.cadence.autosaveDelayMs;

/**
 * Applies a patch, deleting keys set to undefined rather than assigning it.
 * Under `exactOptionalPropertyTypes` an absent key and an explicit `undefined`
 * are different things, and clearing a field means the former.
 */
function apply<T extends object>(base: T, patch: Patch<T>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** What the server accepts as a note patch — id, timestamps and version are its own. */
function saveable(note: MeetingNote) {
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    authorId: _author,
    version: _version,
    ...rest
  } = note;
  return rest;
}

export function MeetingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [query, setQueryState] = useState<ListQuery>({ page: 1, pageSize: 25 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* Notes edited but not yet confirmed saved. The source of truth on screen. */
  const [drafts, setDrafts] = useState<Record<string, MeetingNote>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const listQuery = useQuery<NotePage>({
    queryKey: ["meeting-notes", query],
    queryFn: async () => unwrap(await withTimeout(fetchNotes({ data: query }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  /*
   * The open note is fetched in its own right rather than found in the page:
   * a leader can arrive on `?note=…` by link, and the note need not be on the
   * page the list happens to be showing.
   */
  const openQuery = useQuery({
    queryKey: ["meeting-note", selectedId],
    queryFn: async () => unwrap(await withTimeout(fetchNote({ data: { id: selectedId! } }))),
    enabled: !!selectedId,
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["meeting-notes"] });
    void queryClient.invalidateQueries({ queryKey: ["meeting-note"] });
    /* A task is read in two places now — inside its meeting and in the
       assignee's week. Ticking it in one must not leave the other showing the
       old state. */
    void queryClient.invalidateQueries({ queryKey: ["my-meeting-tasks"] });
  }, [queryClient]);

  /* ------------------------------------------------------------- flushing */

  const flushNote = useCallback(
    async (id: string) => {
      const draft = draftsRef.current[id];
      if (!draft) return;

      timers.current.delete(id);
      setSaveState("saving");
      setSaveError(null);

      try {
        /*
         * The version the draft was made from. A save against a stale version
         * is refused rather than applied, so a second tab cannot quietly
         * replace what this one wrote.
         */
        const saved = unwrap(
          (await withTimeout(
            updateNoteCall({
              data: {
                id,
                patch: saveable(draft),
                ...(draft.version === undefined ? {} : { expectedVersion: draft.version }),
              },
            }),
          )) as never,
        ) as MeetingNote;

        /*
         * Drop the draft only if nothing was typed while the save was in
         * flight. Otherwise the newer text is still unsaved and dropping it
         * would show the leader the version they had already moved past.
         */
        setDrafts((current) => {
          if (current[id] !== draft) {
            /* Newer text is still unsaved, but it must carry the version the
               server just issued or the next save will look stale. */
            const newer = current[id];
            if (!newer) return current;
            const carried: MeetingNote =
              saved.version === undefined ? newer : { ...newer, version: saved.version };
            return { ...current, [id]: carried };
          }
          const { [id]: _saved, ...rest } = current;
          return rest;
        });
        setSaveState("saved");
        invalidate();
      } catch (error) {
        /* Keep the draft. A sentence is not lost because a request was. */
        setSaveState("error");
        setSaveError(error);
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
        setTimeout(() => void flushNote(id), FLUSH_DELAY_MS),
      );
    },
    [flushNote],
  );

  const flush = useCallback(async () => {
    const ids = [...timers.current.keys()];
    for (const id of ids) {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
    }
    timers.current.clear();
    await Promise.all(Object.keys(draftsRef.current).map((id) => flushNote(id)));
  }, [flushNote]);

  /* A note left unsaved when the tab closes is the one case a debounce loses. */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(draftsRef.current).length > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /* ------------------------------------------------------------- reading */

  const serverNotes = useMemo(() => {
    const fromPage = listQuery.data?.notes ?? [];
    const open = openQuery.data?.note;
    if (!open || fromPage.some((n) => n.id === open.id)) return fromPage;
    return [open, ...fromPage];
  }, [listQuery.data, openQuery.data]);

  /* Drafts win: they are what the leader is looking at. */
  const notes = useMemo(
    () => serverNotes.map((note) => drafts[note.id] ?? note),
    [serverNotes, drafts],
  );

  const tasks = useMemo(() => {
    const all = [...(listQuery.data?.tasks ?? []), ...(openQuery.data?.tasks ?? [])];
    const seen = new Set<string>();
    return all.filter((task) => (seen.has(task.id) ? false : (seen.add(task.id), true)));
  }, [listQuery.data, openQuery.data]);

  /* -------------------------------------------------------------- editing */

  /** Change a note locally, then schedule the write. */
  const edit = useCallback(
    (id: string, change: (note: MeetingNote) => MeetingNote) => {
      setDrafts((current) => {
        const base = current[id] ?? notes.find((n) => n.id === id);
        if (!base) return current;
        return { ...current, [id]: change(base) };
      });
      schedule(id);
    },
    [notes, schedule],
  );

  const patchNote = useCallback(
    (id: string, patch: Patch<MeetingNote>) =>
      edit(id, (note) => apply(note, { ...patch, updatedAt: toISO(new Date()) })),
    [edit],
  );

  const patchBlocks = useCallback(
    (noteId: string, fn: (blocks: MeetingBlock[]) => MeetingBlock[]) =>
      edit(noteId, (note) => ({ ...note, blocks: fn(note.blocks) })),
    [edit],
  );

  /* ------------------------------------------------------------ mutations */

  const taskMutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const runTask = useCallback(
    (work: () => Promise<unknown>) => {
      taskMutation.mutate(work, { onError: (error) => setSaveError(error) });
    },
    [taskMutation],
  );

  const store = useMemo<MeetingStore>(
    () => ({
      notes,
      tasks,
      query,
      setQuery: setQueryState,
      page: listQuery.data?.page ?? { page: 1, pageSize: 25, pageCount: 1, total: 0 },
      facets: listQuery.data?.facets ?? { tags: [], ministryIds: [] },
      select: setSelectedId,

      status: listQuery.isError ? "error" : listQuery.data ? "ready" : "loading",
      error: listQuery.error,
      retry: () => void listQuery.refetch(),

      saveState,
      saveError,
      flush,

      createNote: async (input) => {
        const note = unwrap(
          (await withTimeout(
            createNoteCall({
              data: {
                title: input.title ?? "",
                noteType: input.noteType,
                date: toISO(new Date()),
                blocks: startingBlocks(input.noteType),
                authorId: input.authorId,
                ...(input.type ? { type: input.type } : {}),
                ...(input.ministryId
                  ? { links: [{ kind: "ministry", id: input.ministryId }] }
                  : {}),
              },
            }),
          )) as never,
        ) as MeetingNote;
        invalidate();
        return note.id;
      },

      updateNote: patchNote,

      removeNote: async (id) => {
        /* Drop any pending write first: saving a note we are deleting would
           either fail confusingly or briefly resurrect it. */
        const timer = timers.current.get(id);
        if (timer) clearTimeout(timer);
        timers.current.delete(id);
        setDrafts((current) => {
          const { [id]: _gone, ...rest } = current;
          return rest;
        });

        unwrap((await withTimeout(deleteNoteCall({ data: { id } }))) as never);
        invalidate();
      },

      setBlockHtml: (noteId, blockId, html) =>
        patchBlocks(noteId, (blocks) =>
          blocks.map((block) => (block.id === blockId ? { ...block, html } : block)),
        ),

      setBlockType: (noteId, blockId, type) =>
        patchBlocks(noteId, (blocks) =>
          blocks.map((block) => (block.id === blockId ? { ...block, type } : block)),
        ),

      insertAfter: (noteId, blockId) => {
        const id = newBlockId();
        patchBlocks(noteId, (blocks) => {
          const at = blocks.findIndex((block) => block.id === blockId);
          const next = [...blocks];
          next.splice(at + 1, 0, { ...emptyBlock(), id });
          return next;
        });
        return id;
      },

      removeBlock: (noteId, blockId) =>
        patchBlocks(noteId, (blocks) =>
          /* Never leave a document with nowhere to type. */
          blocks.length <= 1 ? blocks : blocks.filter((block) => block.id !== blockId),
        ),

      toggleCheck: (noteId, blockId) =>
        patchBlocks(noteId, (blocks) =>
          blocks.map((block) =>
            block.id === blockId ? { ...block, checked: !block.checked } : block,
          ),
        ),

      cycleFollowUp: (noteId, blockId) =>
        patchBlocks(noteId, (blocks) =>
          blocks.map((block) =>
            block.id === blockId
              ? { ...block, state: block.state === "open" ? "resolved" : "open" }
              : block,
          ),
        ),

      createTask: (input) => runTask(() => createMeetingTask({ data: input })),

      updateTask: (id, patch) => runTask(() => updateMeetingTask({ data: { id, patch } })),

      removeTask: (id) => runTask(() => deleteMeetingTask({ data: { id } })),

      bringForward: (noteId, items) =>
        patchBlocks(noteId, (blocks) => [
          ...blocks,
          ...items.map((item) => ({
            ...emptyBlock(item.kind === "task" ? "checklist" : "follow-up"),
            html: item.text,
            ...(item.kind === "follow-up" ? { state: "open" as const } : {}),
          })),
        ]),
    }),
    [
      notes,
      tasks,
      query,
      listQuery,
      saveState,
      saveError,
      flush,
      patchNote,
      patchBlocks,
      runTask,
      invalidate,
    ],
  );

  return <MeetingContext.Provider value={store}>{children}</MeetingContext.Provider>;
}

/**
 * Tasks assigned to this leader, wherever the meeting was.
 *
 * Its own hook rather than part of the meeting store: the Weekly Agenda has no
 * business loading a page of meeting notes in order to know what somebody owes.
 */
export function useMyMeetingTasks() {
  const query = useQuery<{ task: MeetingTask; contextLabel: string; readable: boolean }[]>({
    queryKey: ["my-meeting-tasks"],
    queryFn: async () => unwrap(await withTimeout(fetchMyTasks({ data: undefined }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  return {
    tasks: query.data ?? [],
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
  };
}
