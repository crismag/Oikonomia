import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Lock, Share2, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/config/messages/handlers";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { MeetingDocument, MeetingToolbar } from "@/components/oikonomia/meeting-editor";
import { Page } from "@/components/oikonomia/page";
import {
  fetchEntry,
  removeEntry,
  renameEntry,
  summarizeEntry,
  writeEntry,
  type JournalEntry,
} from "@/lib/journal-api";
import { CalendarError, errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { blockText, emptyBlock, isTextBlock, newBlockId } from "@/domain/meeting";
import type { LeadershipReport, MeetingBlock, MeetingBlockType } from "@/domain/types";

export const Route = createFileRoute("/leadership/$entryId")({
  /* Generic, deliberately. A tab title is a leak surface like any other, and
     this one must never carry what a leader was reflecting on. */
  head: () => ({ meta: [{ title: "Leadership Journal — Oikonomia" }] }),
  component: EntryPage,
});

const FLUSH_DELAY_MS = 600;

/**
 * One leadership journal entry.
 *
 * Written here and read nowhere else. The page says so once, plainly, and then
 * gets out of the way — a leader who has to be reassured on every screen is
 * being asked to distrust the thing they are writing into.
 *
 * The second half of the page is the boundary made operable: **select lines**,
 * not the entry, and what is selected is copied into a Leadership Report which
 * starts private and has its own audience. Nothing else in the journal moves.
 */
function EntryPage() {
  const { entryId } = Route.useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const query = useQuery<JournalEntry>({
    queryKey: ["journal-entry", entryId],
    queryFn: async () => unwrap(await withTimeout(fetchEntry({ data: { id: entryId } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  /* Local first, as everywhere else the binder is typed into. */
  const [draft, setDraft] = useState<{ blocks: MeetingBlock[]; version: number } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<LeadershipReport | null>(null);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["journal-entry", entryId] });
    void queryClient.invalidateQueries({ queryKey: ["work-list"] });
  }, [queryClient, entryId]);

  const flush = useCallback(async () => {
    const pending = draftRef.current;
    if (!pending) return true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = unwrap(
        (await withTimeout(
          writeEntry({
            data: { id: entryId, blocks: pending.blocks, expectedVersion: pending.version },
          }),
        )) as never,
      ) as { version: number };
      setDraft((current) =>
        current && current !== pending ? { ...current, version: saved.version } : null,
      );
      setSaveState("saved");
      invalidate();
      return true;
    } catch (error) {
      /* Keep the draft. A reflection is not lost because a request was. */
      setSaveState("error");
      setSaveError(error);
      return false;
    }
  }, [entryId, invalidate]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const rename = useMutation({
    mutationFn: async (title: string) =>
      unwrap((await withTimeout(renameEntry({ data: { id: entryId, title } }))) as never),
    onSuccess: invalidate,
    networkMode: "always" as const,
    retry: 0,
  });

  const share = useMutation({
    mutationFn: async (blockIds: string[]) =>
      unwrap(
        (await withTimeout(summarizeEntry({ data: { entryId, blockIds } }))) as never,
      ) as LeadershipReport,
    onSuccess: (report) => {
      setSummary(report);
      setChoosing(false);
      setChosen(new Set());
      invalidate();
    },
    networkMode: "always" as const,
    retry: 0,
  });

  if (query.isLoading) {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Page>
        <ErrorState title="This entry could not be opened" onRetry={() => void query.refetch()}>
          Nothing is lost. This is a problem reaching it.
        </ErrorState>
      </Page>
    );
  }

  const entry = query.data.work;
  const blocks = draft?.blocks ?? query.data.content.blocks;
  const conflict = saveError instanceof CalendarError && saveError.code === "conflict";

  const write = (next: MeetingBlock[]) => {
    const version = draftRef.current?.version ?? query.data!.content.version;
    setDraft({ blocks: next, version });
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  };

  const title = renaming ?? entry.subject;
  const writable = blocks.filter((block) => isTextBlock(block.type) && blockText(block).trim());

  return (
    <Page>
      <Link
        to="/leadership"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Leadership
      </Link>

      <header className="mb-3">
        <input
          value={title}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => {
            if (renaming !== null && renaming !== entry.subject) void rename.mutateAsync(renaming);
            setRenaming(null);
          }}
          placeholder="Untitled entry"
          aria-label="Entry title"
          className="w-full bg-transparent font-display text-[26px] leading-tight outline-none placeholder:text-muted-foreground"
        />
        {/* Said once, plainly. A leader who has to be reassured on every screen
            is being asked to distrust what they are writing into. */}
        <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          Private to you. Nobody else can open this, whatever their role.
        </p>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-status-overdue/40 bg-status-overdue/5 px-4 py-3 text-[13px] leading-relaxed"
        >
          <p className="font-medium">
            This entry was changed in another tab while you were writing.
          </p>
          <p className="mt-1 text-muted-foreground">
            What you have typed is still here and has not been saved.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setSaveState("idle");
              setSaveError(null);
              invalidate();
            }}
            className="mt-2 font-medium underline underline-offset-2"
          >
            Open the other version
          </button>
        </div>
      ) : null}

      {choosing ? (
        <div className="mb-3 rounded-lg border border-border bg-surface-muted px-4 py-3.5">
          <h2 className="text-[14px] font-medium">What belongs in the summary?</h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Tick the lines you want to account for. They are <strong>copied</strong> into a new
            leadership report, which starts private and has its own audience. Everything you leave
            unticked stays here.
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {writable.map((block) => (
              <li key={block.id}>
                <label className="flex cursor-pointer items-start gap-2 text-[14px] leading-relaxed">
                  <input
                    type="checkbox"
                    checked={chosen.has(block.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(block.id);
                      else next.delete(block.id);
                      setChosen(next);
                    }}
                    className="mt-1 size-3.5 shrink-0"
                  />
                  <span>{blockText(block)}</span>
                </label>
              </li>
            ))}
          </ul>

          {writable.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Write something first — there is nothing to account for yet.
            </p>
          ) : null}

          {share.error ? (
            <p role="alert" className="mt-2 text-[13px] text-status-overdue">
              {errorMessage(share.error)}
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setChoosing(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={chosen.size === 0 || share.isPending}
              busy={share.isPending}
              onClick={() => void share.mutateAsync([...chosen]).catch(() => {})}
            >
              Draw a summary
            </Button>
          </div>
        </div>
      ) : null}

      {summary ? (
        <div className="mb-3 rounded-lg border border-border bg-surface px-4 py-3.5">
          <p className="text-[14px]">
            A leadership report was drawn from the lines you chose. It is <strong>private</strong>{" "}
            until you say who may read it.
          </p>
          <Link
            to="/leadership-reports/$reportId"
            params={{ reportId: summary.id }}
            search={{ edit: true }}
            className="mt-2 inline-flex text-[13px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Open the summary
          </Link>
        </div>
      ) : null}

      <MeetingToolbar
        activeType={blocks.find((b) => b.id === focusedId)?.type}
        canMakeTask={false}
        showTasks={false}
        showMeetingMarks={false}
        onCommand={(command) => {
          if (command.kind === "set-type" && focusedId) {
            write(
              blocks.map((b) =>
                b.id === focusedId
                  ? { ...b, type: command.type, ...(isTextBlock(command.type) ? {} : { html: "" }) }
                  : b,
              ),
            );
          }
          if (command.kind === "delete" && focusedId && blocks.length > 1) {
            write(blocks.filter((b) => b.id !== focusedId));
          }
        }}
      />

      <div className="rounded-lg border border-border bg-surface px-5 py-4">
        <MeetingDocument
          blocks={blocks}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onChange={(id, html) => write(blocks.map((b) => (b.id === id ? { ...b, html } : b)))}
          onEnter={(id) => {
            const created = { ...emptyBlock("paragraph"), id: newBlockId() };
            const at = blocks.findIndex((b) => b.id === id);
            const next = [...blocks];
            next.splice(at < 0 ? blocks.length : at + 1, 0, created);
            write(next);
            setFocusedId(created.id);
            return created.id;
          }}
          onRemove={(id) => {
            if (blocks.length <= 1) return;
            const index = blocks.findIndex((b) => b.id === id);
            write(blocks.filter((b) => b.id !== id));
            setFocusedId(blocks[index - 1]?.id ?? null);
          }}
          onToggleCheck={(id) =>
            write(blocks.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)))
          }
          onCycleFollowUp={() => {}}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              if (!(await confirm("journal.delete.confirm"))) return;
              await removeEntry({ data: { id: entryId } });
              void navigate({ to: "/leadership" });
            })();
          }}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete entry
        </button>

        <div className="flex items-center gap-3">
          {conflict ? null : saveState === "saving" ? (
            <span aria-live="polite" className="text-[12px] text-muted-foreground">
              Saving…
            </span>
          ) : saveState === "saved" ? (
            <span aria-live="polite" className="text-[12px] text-muted-foreground">
              Saved
            </span>
          ) : saveState === "error" ? (
            <span role="alert" className="text-[12px] text-status-overdue">
              {errorMessage(saveError)}
            </span>
          ) : null}

          {!choosing ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void flush();
                setChoosing(true);
              }}
            >
              <Share2 className="size-3.5" aria-hidden />
              Use in a summary
            </Button>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
