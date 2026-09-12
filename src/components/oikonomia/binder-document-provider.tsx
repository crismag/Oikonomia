import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchBinderDocument, saveBinderDocument, updateDocument } from "@/lib/documents-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { config } from "@/config";
import { emptyBlock, isTextBlock, newBlockId } from "@/domain/meeting";
import type { BinderContent, RegisteredDocument } from "@/domain/registry";
import type { MeetingBlock, MeetingBlockType } from "@/domain/types";

/**
 * One binder-native document, open for writing.
 *
 * The same shape Meeting Notes uses, for the same reason: a document is typed
 * into one character at a time, and `onInput` fires on every one of them. So a
 * block change updates a **local draft synchronously** — which is what makes
 * typing feel like typing — and a save of the whole document is scheduled
 * behind a short debounce. A failed save keeps the draft: a leader's paragraph
 * is not lost because a request was.
 *
 * The draft carries the version it was made from. Two people writing one
 * ministry plan is ordinary, so the second is told rather than overwritten.
 *
 * The editor's interface knows nothing of any of this — `setBlockHtml` and the
 * rest return synchronously, and `insertAfter` still hands back the new block's
 * id so focus can move to it.
 */

/* How long typing settles before a draft is written. Configuration: a
   church on a slow connection may want longer. */
const FLUSH_DELAY_MS = config.cadence.autosaveDelayMs;

export type SaveState = "idle" | "saving" | "saved" | "error";

interface Loaded {
  document: RegisteredDocument;
  content: BinderContent;
  mayWrite: boolean;
}

export function useBinderDocument(id: string) {
  const queryClient = useQueryClient();

  const query = useQuery<Loaded>({
    queryKey: ["binder-document", id],
    queryFn: async () => unwrap(await withTimeout(fetchBinderDocument({ data: { id } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  /* Blocks edited but not yet confirmed saved. What the page renders. */
  const [draft, setDraft] = useState<{ blocks: MeetingBlock[]; version: number } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["binder-document", id] });
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void queryClient.invalidateQueries({ queryKey: ["filed-documents"] });
  }, [queryClient, id]);

  const flush = useCallback(async (): Promise<boolean> => {
    const pending = draftRef.current;
    if (!pending) return true;

    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSaveState("saving");
    setSaveError(null);

    try {
      const saved = unwrap(
        (await withTimeout(
          saveBinderDocument({
            data: {
              documentId: id,
              blocks: pending.blocks,
              expectedVersion: pending.version,
            },
          }),
        )) as never,
      ) as BinderContent;

      /*
       * Drop the draft only if nothing was typed while the save was in flight.
       * Otherwise the newer text is still unsaved and has to carry the version
       * the server just issued, or the next save looks stale when it is not.
       */
      setDraft((current) =>
        current && current !== pending ? { ...current, version: saved.version } : null,
      );
      setSaveState("saved");
      invalidate();
      return true;
    } catch (error) {
      /* Keep the draft. A paragraph is not lost because a request was. */
      setSaveState("error");
      setSaveError(error);
      return false;
    }
  }, [id, invalidate]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /* A document left unsaved when the tab closes is what a debounce risks. */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const blocks = draft?.blocks ?? query.data?.content.blocks ?? [];

  const write = useCallback(
    (next: MeetingBlock[]) => {
      const version = draftRef.current?.version ?? query.data?.content.version ?? 1;
      setDraft({ blocks: next, version });
      schedule();
    },
    [query.data, schedule],
  );

  const rename = useMutation({
    mutationFn: async (title: string) =>
      unwrap((await withTimeout(updateDocument({ data: { id, patch: { title } } }))) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  return {
    document: query.data?.document,
    mayWrite: query.data?.mayWrite ?? false,
    blocks,
    status: query.isError ? "error" : query.data ? "ready" : ("loading" as const),
    error: query.error,
    retry: () => void query.refetch(),

    saveState,
    saveError,
    flush,
    /** Throw away the local draft and take the server's copy. */
    discardDraft: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setDraft(null);
      setSaveState("idle");
      setSaveError(null);
      invalidate();
    },

    rename: (title: string) => rename.mutateAsync(title),
    renaming: rename.isPending,

    /* --------------------------------------------------- block editing */

    setBlockHtml: (blockId: string, html: string) =>
      write(blocks.map((b) => (b.id === blockId ? { ...b, html } : b))),

    setBlockType: (blockId: string, type: MeetingBlockType) =>
      write(
        blocks.map((b) =>
          b.id === blockId ? { ...b, type, ...(isTextBlock(type) ? {} : { html: "" }) } : b,
        ),
      ),

    /** Returns the new block's id so the caller can move the caret to it. */
    insertAfter: (blockId: string): string => {
      const created = { ...emptyBlock("paragraph"), id: newBlockId() };
      const at = blocks.findIndex((b) => b.id === blockId);
      const next = [...blocks];
      next.splice(at < 0 ? blocks.length : at + 1, 0, created);
      write(next);
      return created.id;
    },

    removeBlock: (blockId: string) => {
      /* Never leave a document with nothing to type into. */
      if (blocks.length <= 1) return;
      write(blocks.filter((b) => b.id !== blockId));
    },

    toggleCheck: (blockId: string) =>
      write(blocks.map((b) => (b.id === blockId ? { ...b, checked: !b.checked } : b))),
  };
}
