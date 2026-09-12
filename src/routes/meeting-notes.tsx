import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, NotebookPen, Plus, Printer, Search, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Combobox } from "@/components/oikonomia/combobox";
import { DetailSkeleton, ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import {
  MeetingDocument,
  MeetingToolbar,
  type BlockCommand,
} from "@/components/oikonomia/meeting-editor";
import { useMeetings } from "@/components/oikonomia/meeting-provider";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Pagination } from "@/components/oikonomia/pagination";
import { PersonName } from "@/components/oikonomia/person";
import { errorMessage } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  addTag,
  blockText,
  meetingActivity,
  meetingTypeLabel,
  meetingTypes,
  ministryContextId,
  noteTypeHint,
  noteTypeLabel,
  previousInSeries,
  readership,
  removeTag,
  setContext,
  suggestTags,
  tasksFor,
  unresolvedFrom,
} from "@/domain/meeting";
import { PAGE_SIZE, windowFromMeta } from "@/domain/pagination";
import { fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MeetingNote, MeetingNoteType } from "@/domain/types";

/**
 * The URL of the notebook.
 *
 * `note` is not a record address in the way `/people/$personId` is — it names
 * the note currently open on the writing surface, which is why it is a search
 * parameter rather than a path segment. Opening one is a change of workspace
 * state, and the list's own reading state (`q`, `type`, `tag`, `ministry`,
 * `page`) survives underneath it, so closing a note returns the leader to the
 * filtered page they were reading rather than to the top of everything.
 */
type SearchState = {
  note?: string;
  print?: boolean;
  q?: string;
  type?: MeetingNoteType;
  tag?: string;
  ministry?: string;
  page?: number;
};

type SearchPatch = { [K in keyof SearchState]?: SearchState[K] | undefined };

function clean(patch: SearchPatch): SearchState {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as SearchState;
}

export const Route = createFileRoute("/meeting-notes")({
  validateSearch: (search: Record<string, unknown>): SearchState => {
    const str = (key: string) =>
      typeof search[key] === "string" && search[key] ? (search[key] as string) : undefined;
    const page = Number(search["page"]);
    const noteType =
      search["type"] === "personal" || search["type"] === "minutes"
        ? (search["type"] as MeetingNoteType)
        : undefined;
    return {
      ...(str("note") ? { note: str("note")! } : {}),
      ...(search["print"] === true || search["print"] === "true" ? { print: true } : {}),
      ...(str("q") ? { q: str("q")! } : {}),
      ...(noteType ? { type: noteType } : {}),
      ...(str("tag") ? { tag: str("tag")! } : {}),
      ...(str("ministry") ? { ministry: str("ministry")! } : {}),
      ...(Number.isFinite(page) && page > 1 ? { page: Math.floor(page) } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Meeting Notes — Oikonomia" },
      {
        name: "description",
        content: "The leader's meeting notebook: write, decide, and track what follows.",
      },
    ],
  }),
  component: MeetingNotesPage,
});

/**
 * Meeting Notes — binder section 3.
 *
 * A writing surface first. The list exists to get you back into a document;
 * the document is the product. Tasks, decisions and follow-ups emerge from
 * what the leader writes rather than being demanded up front.
 */
function MeetingNotesPage() {
  const { ministries, people } = useOrganization();
  const { note: noteId, print } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const store = useMeetings();
  const { person } = useViewer();

  /*
   * The provider fetches whichever note the URL names, so arriving on
   * `?note=…` by link works even when that note is not on the page the list
   * happens to be showing.
   */
  const { select, flush } = store;
  useEffect(() => {
    select(noteId ?? null);
    /* Leaving the writing surface writes whatever has not been written yet. */
    if (!noteId) void flush();
  }, [noteId, select, flush]);

  const selected = store.notes.find((n) => n.id === noteId);

  if (noteId && !selected) {
    return (
      <Page width="regular">
        <DetailSkeleton />
      </Page>
    );
  }

  if (selected && print) return <PrintView note={selected} />;
  if (selected) return <Editor note={selected} />;

  /* Opening a note keeps the list's reading state, so closing it comes back here. */
  return (
    <MeetingList
      onOpen={(id) => navigate({ search: (prev) => ({ ...prev, note: id }) })}
      onCreate={(noteType) => {
        void store
          .createNote({ authorId: person.id, noteType })
          .then((id) => navigate({ search: (prev) => ({ ...prev, note: id }) }));
      }}
    />
  );
}

/**
 * Whether what is on screen has reached the database.
 *
 * Quiet when there is nothing to say, and loud only when something failed —
 * a save that did not happen is the one thing a leader must not miss.
 */
function SaveIndicator() {
  const { saveState, saveError, flush } = useMeetings();

  if (saveState === "error") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-status-overdue" role="alert">
        {errorMessage(saveError)}
        <button
          type="button"
          onClick={() => void flush()}
          className="inline-flex min-h-6 items-center rounded px-1.5 underline-offset-2 hover:underline"
        >
          Try again
        </button>
      </span>
    );
  }

  return (
    <span className="text-[12px] text-muted-foreground" aria-live="polite">
      {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Up to date"}
    </span>
  );
}

/* ------------------------------------------------------------------ list */

function MeetingList({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: (noteType: MeetingNoteType) => void;
}) {
  const { ministries } = useOrganization();
  const store = useMeetings();
  const { notes, tasks } = store;
  const state = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const query = state.q ?? "";
  const noteType = state.type ?? null;
  const tag = state.tag ?? null;
  const ministryId = state.ministry ?? null;

  const patch = (next: SearchPatch) =>
    navigate({ search: clean({ ...state, page: undefined, ...next }), replace: true });

  const setQuery = (v: string) => patch({ q: v || undefined });
  const setNoteType = (v: MeetingNoteType | null) => patch({ type: v ?? undefined });
  const setTag = (v: string | null) => patch({ tag: v ?? undefined });
  const setMinistryId = (v: string | null) => patch({ ministry: v ?? undefined });

  /*
   * Filtering and paging happen in the database (§19), so the screen states
   * what it wants and renders what comes back. `filterNotes` remains in the
   * domain for anything still holding notes in memory; this is not one.
   */
  const { setQuery: ask } = store;
  useEffect(() => {
    ask({
      page: state.page ?? 1,
      pageSize: PAGE_SIZE,
      ...(query ? { search: query } : {}),
      ...(noteType ? { noteType } : {}),
      ...(tag ? { tag } : {}),
      ...(ministryId ? { ministryId } : {}),
    });
  }, [ask, state.page, query, noteType, tag, ministryId]);

  const visible = notes;
  const page = windowFromMeta(notes, store.page);

  /*
   * Filter options come from the whole readable set, counted in the database,
   * so they do not change when the leader turns a page or narrows a search.
   */
  const tags = store.facets.tags;
  const withMeetings = ministries.filter((m) => store.facets.ministryIds.includes(m.id));

  return (
    <Page width="regular">
      <PageHeader
        title="Meeting Notes"
        description="What was said and decided, written down while it is fresh."
        actions={<NewNoteMenu onCreate={onCreate} />}
      />

      {notes.length > 0 ? (
        <div className="mb-3 space-y-2.5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:w-64">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Search meetings</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search meetings and tags"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </label>

            <div className="flex items-center gap-1.5">
              <Chip active={noteType === null} onClick={() => setNoteType(null)}>
                All
              </Chip>
              {(["personal", "minutes"] as MeetingNoteType[]).map((option) => (
                <Chip
                  key={option}
                  active={noteType === option}
                  onClick={() => setNoteType(noteType === option ? null : option)}
                >
                  {option === "personal" ? "Personal" : "Minutes"}
                </Chip>
              ))}
            </div>

            {withMeetings.length > 0 ? (
              <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground sm:ml-auto">
                <span className="sr-only">Filter by ministry</span>
                <select
                  value={ministryId ?? ""}
                  onChange={(e) => setMinistryId(e.target.value || null)}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none"
                >
                  <option value="">Any context</option>
                  {withMeetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {tags.length > 0 ? (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="flex items-center gap-1.5">
                {tags.map((option) => (
                  <Chip
                    key={option}
                    active={tag === option}
                    onClick={() => setTag(tag === option ? null : option)}
                  >
                    #{option}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {store.status === "error" ? (
        <ErrorState title="The notebook could not be loaded" onRetry={store.retry}>
          Your notes are safe. This is a problem reaching them.
        </ErrorState>
      ) : store.status === "loading" ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {page.items.length > 0 ? (
            <ul className="divide-y divide-border">
              {page.items.map((note) => {
                const activity = meetingActivity(note, tasks);
                const contextName = ministries.find((m) => m.id === ministryContextId(note))?.name;
                const bits = [
                  activity.openTasks > 0 ? `${activity.openTasks} open` : null,
                  activity.decisions > 0
                    ? `${activity.decisions} ${activity.decisions === 1 ? "decision" : "decisions"}`
                    : null,
                  activity.openFollowUps > 0 ? `${activity.openFollowUps} unresolved` : null,
                ].filter(Boolean);

                return (
                  <li key={note.id} className="row-quiet">
                    <button
                      type="button"
                      onClick={() => onOpen(note.id)}
                      className="flex w-full items-start gap-4 px-4 py-3 text-left"
                    >
                      <span className="w-16 shrink-0 pt-0.5 text-[12px] tabular-nums text-muted-foreground">
                        {format(fromISO(note.date), "d MMM")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">
                          {note.title || "Untitled meeting"}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                          {noteTypeLabel[note.noteType]}
                          {contextName ? ` · ${contextName}` : ""}
                          {bits.length > 0 ? ` · ${bits.join(" · ")}` : ""}
                        </span>
                        {note.tags.length > 0 ? (
                          <span className="mt-1 block truncate text-[12px] text-muted-foreground">
                            {note.tags.map((t) => `#${t}`).join(" ")}
                          </span>
                        ) : null}
                      </span>
                      {note.status === "draft" ? (
                        <span className="shrink-0 rounded-full border border-status-waiting/35 bg-status-waiting-soft px-2 py-0.5 text-[11px] leading-5 text-status-waiting">
                          Draft
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={NotebookPen}
              title={
                query || tag || noteType || ministryId
                  ? "No meeting matches"
                  : "No meeting notes yet"
              }
              action={
                query || tag || noteType || ministryId ? null : <NewNoteMenu onCreate={onCreate} />
              }
            >
              Record notes from leadership, ministry or other meetings so they stay part of your
              binder.
            </EmptyState>
          )}
        </div>
      )}

      {store.status === "ready" ? (
        <Pagination
          window={page}
          onPage={(n) =>
            navigate({ search: clean({ ...state, page: n > 1 ? n : undefined }), replace: true })
          }
          noun="meeting note"
        />
      ) : null}
    </Page>
  );
}

/**
 * Choosing what kind of note this is.
 *
 * The one decision worth asking for before writing, because it changes what
 * the document opens with and who can read it. Both options are offered
 * directly rather than behind a modal — creation should be fast.
 */
function NewNoteMenu({ onCreate }: { onCreate: (noteType: MeetingNoteType) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-3.5" aria-hidden />
        New meeting note
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        {(["personal", "minutes"] as MeetingNoteType[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setOpen(false);
              onCreate(option);
            }}
            className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="block text-[14px] font-medium">{noteTypeLabel[option]}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
              {noteTypeHint[option]}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
        active
          ? "border-primary/30 bg-accent-soft font-medium text-sidebar-accent-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Context, tags and who can read it.
 *
 * A second, quieter line under the meeting details. **Related to** is an
 * explicit link to a real record — a ministry meeting points at Music Ministry
 * itself, not at a `#music` tag — which is what lets that ministry list its own
 * meetings without anything being copied.
 */
function MetaRow({ note }: { note: MeetingNote }) {
  const { ministries } = useOrganization();
  const store = useMeetings();
  const ministryId = ministryContextId(note);
  const related = ministries.find((m) => m.id === ministryId)?.name ?? note.relatedText ?? "";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <span className="shrink-0">Related to</span>
        {/* Free entry with suggestions: a meeting may concern something this
            application does not model, and a closed list would refuse it. */}
        <Combobox
          label="What this meeting relates to"
          value={related}
          placeholder="General / none"
          width="w-44"
          suggestions={ministries.map((m) => ({ id: m.id, label: m.name, group: "Ministries" }))}
          onChange={(text, id) =>
            store.updateNote(note.id, {
              links: setContext(note.links, "ministry", id),
              relatedText: id ? undefined : text || undefined,
            })
          }
        />
      </label>

      <TagEditor note={note} />

      {/*
       * A statement rather than a dropdown.
       *
       * The control here used to offer "Private to me / Selected leaders /
       * Leaders" and none of the three did anything: readability follows
       * from the note's type, and there was never a way to name a selected
       * leader. A setting that does not set anything is worse than no
       * setting — see `readership` in `domain/meeting.ts`.
       */}
      <span className="text-[12px] text-muted-foreground">{readership(note)}</span>
    </div>
  );
}

/**
 * Tags on a note.
 *
 * Existing tags are suggested as the leader types, so spelling converges
 * without anybody defining a vocabulary in advance. A tag describes the note;
 * it is never how an organizational relationship is recorded.
 */
function TagEditor({ note }: { note: MeetingNote }) {
  const store = useMeetings();
  const { notes } = useMeetings();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const suggestions = suggestTags(notes, draft, note.tags);

  const commit = (raw: string) => {
    const next = addTag(note.tags, raw);
    if (next !== note.tags) store.updateNote(note.id, { tags: next });
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {note.tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[12px]"
        >
          #{tag}
          <button
            type="button"
            onClick={() => store.updateNote(note.id, { tags: removeTag(note.tags, tag) })}
            aria-label={`Remove #${tag}`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      <div className="relative">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
            if (e.key === "Backspace" && !draft && note.tags.length > 0) {
              store.updateNote(note.id, { tags: note.tags.slice(0, -1) });
            }
          }}
          placeholder="+ tag"
          aria-label="Add a tag"
          className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[12px] outline-none transition-colors hover:border-border focus:w-28 focus:border-ring"
        />

        {open && suggestions.length > 0 ? (
          <ul className="absolute left-0 top-full z-20 mt-1 min-w-32 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-md">
            {suggestions.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(tag)}
                  className="block w-full px-2.5 py-1 text-left text-[12px] transition-colors hover:bg-muted"
                >
                  #{tag}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

function Editor({ note }: { note: MeetingNote }) {
  /* `activePeople` for the assignee picker: somebody who has left the church
     is not somebody a task may newly be given to. */
  const { activePeople: people } = useOrganization();
  const store = useMeetings();
  const { person } = useViewer();
  const [focusedId, setFocusedId] = useState<string | null>(note.blocks[0]?.id ?? null);

  const focused = note.blocks.find((b) => b.id === focusedId);
  const activity = meetingActivity(note, store.tasks);
  const myTasks = tasksFor(store.tasks, note.id);
  const previous = previousInSeries(store.notes, note);
  const unresolved = previous ? unresolvedFrom(previous, store.tasks) : [];
  const alreadyCarried = note.blocks.some((b) => blockText(b) === "Previous actions");

  function command(cmd: BlockCommand) {
    if (!focused) return;
    if (cmd.kind === "set-type") store.setBlockType(note.id, focused.id, cmd.type);
    if (cmd.kind === "delete") store.removeBlock(note.id, focused.id);
    if (cmd.kind === "make-task") {
      const title = blockText(focused);
      if (title) store.createTask({ meetingId: note.id, title, blockId: focused.id });
    }
  }

  return (
    <Page width="regular">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/meeting-notes"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Meeting Notes
        </Link>
        <div className="flex items-center gap-2">
          {/*
           * This used to say "saved as you type" whatever was happening. Now
           * it says what is actually true, because the claim is checkable:
           * edits are written behind a short debounce and this reports the
           * state of that write (§20).
           */}
          <SaveIndicator />
          <Link
            to="/meeting-notes"
            search={{ note: note.id, print: true }}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Printer className="size-3.5" aria-hidden />
            Print
          </Link>
          {note.status === "draft" ? (
            <Button
              type="button"
              onClick={() => store.updateNote(note.id, { status: "complete" })}
              variant="primary"
            >
              Mark complete
            </Button>
          ) : null}
        </div>
      </div>

      {/* Header: compact, and never in the way of writing. */}
      <header className="mb-3">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          {noteTypeLabel[note.noteType]}
        </p>
        <input
          value={note.title}
          onChange={(e) => store.updateNote(note.id, { title: e.target.value })}
          placeholder={
            note.noteType === "minutes" ? "What meeting is this?" : "What are these notes about?"
          }
          aria-label="Meeting title"
          className="mt-0.5 w-full rounded-md border border-transparent bg-transparent font-display text-[26px] leading-tight outline-none transition-colors hover:border-border focus:border-ring"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <input
            type="date"
            value={note.date}
            onChange={(e) => store.updateNote(note.id, { date: e.target.value })}
            aria-label="Meeting date"
            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
          />
          <input
            type="time"
            value={note.time ?? ""}
            onChange={(e) => store.updateNote(note.id, { time: e.target.value })}
            aria-label="Meeting time"
            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
          />
          <select
            value={note.type ?? ""}
            onChange={(e) =>
              store.updateNote(note.id, {
                type: (e.target.value || undefined) as MeetingNote["type"],
              })
            }
            aria-label="Meeting type"
            className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
          >
            <option value="">No type</option>
            {meetingTypes.map((type) => (
              <option key={type} value={type}>
                {meetingTypeLabel[type]}
              </option>
            ))}
          </select>
          <Participants note={note} />
        </div>

        <MetaRow note={note} />
      </header>

      {/* Continuity: what was left open last time. */}
      {previous && unresolved.length > 0 && !alreadyCarried ? (
        <div
          data-print="hide"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2.5"
        >
          <p className="text-[13px]">
            {unresolved.length} unresolved {unresolved.length === 1 ? "item" : "items"} from{" "}
            {format(fromISO(previous.date), "d MMM")}
          </p>
          <button
            type="button"
            onClick={() =>
              store.bringForward(
                note.id,
                unresolved.map((item) => ({ text: item.text, kind: item.kind })),
              )
            }
            className="inline-flex min-h-6 items-center gap-1.5 inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
          >
            Bring into this meeting
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <MeetingToolbar
        activeType={focused?.type}
        canMakeTask={Boolean(focused && blockText(focused) && !focused.taskId)}
        onCommand={command}
      />

      <MeetingDocument
        blocks={note.blocks}
        focusedId={focusedId}
        onFocus={setFocusedId}
        onChange={(id, html) => store.setBlockHtml(note.id, id, html)}
        onEnter={(id) => setFocusedId(store.insertAfter(note.id, id))}
        onRemove={(id) => {
          const index = note.blocks.findIndex((b) => b.id === id);
          store.removeBlock(note.id, id);
          setFocusedId(note.blocks[index - 1]?.id ?? null);
        }}
        onToggleCheck={(id) => store.toggleCheck(note.id, id)}
        onCycleFollowUp={(id) => store.cycleFollowUp(note.id, id)}
      />

      {/* Activity sits under the document, never beside the writing. */}
      <section data-print="hide" className="mt-8 border-t border-border pt-4">
        <h2 className="text-[13px] font-medium text-muted-foreground">Meeting activity</h2>
        <p className="mt-1 text-[13px]">
          {activity.tasks} {activity.tasks === 1 ? "task" : "tasks"} · {activity.decisions}{" "}
          {activity.decisions === 1 ? "decision" : "decisions"} · {activity.followUps}{" "}
          {activity.followUps === 1 ? "follow-up" : "follow-ups"}
        </p>

        {myTasks.length > 0 ? (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {myTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <input
                  type="checkbox"
                  checked={task.status === "done"}
                  onChange={() =>
                    store.updateTask(task.id, {
                      status: task.status === "done" ? "open" : "done",
                    })
                  }
                  aria-label={task.title}
                  className="size-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px]",
                    task.status === "done" && "text-muted-foreground line-through",
                  )}
                >
                  {task.title}
                </span>
                <select
                  value={task.assigneeId ?? ""}
                  onChange={(e) =>
                    store.updateTask(task.id, { assigneeId: e.target.value || undefined })
                  }
                  aria-label={`Assign ${task.title}`}
                  className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] outline-none focus:border-ring"
                >
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={task.dueDate ?? ""}
                  onChange={(e) =>
                    store.updateTask(task.id, { dueDate: e.target.value || undefined })
                  }
                  aria-label={`Due date for ${task.title}`}
                  className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] outline-none focus:border-ring"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Select a line and choose <span className="text-foreground">Create task</span> to track
            something that came out of this meeting.
          </p>
        )}
      </section>

      {/*
       * Notes are what was said, kept for whoever needs them. Nobody has to
       * read this, and nobody has to sign it off. Where the meeting produced
       * something that needs a leader outside the room, it is asked for here.
       */}
      <div className="mt-4">
        <EscalationControl
          sourceType="meeting-note"
          sourceId={note.id}
          contextLabel={note.title || "Meeting note"}
        />
      </div>
    </Page>
  );
}

function Participants({ note }: { note: MeetingNote }) {
  /* Choosing who was at a meeting offers whoever is here now. */
  const { activePeople: people } = useOrganization();
  const { updateNote } = useMeetings();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-[13px] transition-colors hover:bg-muted"
      >
        {note.participantIds.length > 0
          ? `${note.participantIds.length} participants`
          : "+ Add participants"}
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {people.map((p) => {
        const on = note.participantIds.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              updateNote(note.id, {
                participantIds: on
                  ? note.participantIds.filter((id) => id !== p.id)
                  : [...note.participantIds, p.id],
              })
            }
            className={cn(
              "rounded-md border px-2 py-1 text-[12px] transition-colors",
              on
                ? "border-primary/30 bg-accent-soft text-sidebar-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {p.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1.5 text-[12px] text-muted-foreground hover:text-foreground"
      >
        Done
      </button>
    </span>
  );
}

/* ----------------------------------------------------------------- print */

function PrintView({ note }: { note: MeetingNote }) {
  const { ministries } = useOrganization();
  const { tasks } = useMeetings();
  const own = tasksFor(tasks, note.id);
  const context = ministries.find((m) => m.id === ministryContextId(note));

  return (
    <div className="px-4 py-6">
      <div data-print="hide" className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2">
        <Link
          to="/meeting-notes"
          search={{ note: note.id }}
          className={buttonVariants({ variant: "secondary" })}
        >
          Back to the meeting
        </Link>
        <Button type="button" onClick={() => window.print()} variant="primary">
          <Printer className="size-3.5" aria-hidden />
          Print
        </Button>
      </div>

      <article data-print="sheet" className="mx-auto max-w-3xl">
        <header className="border-b border-border-strong pb-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {noteTypeLabel[note.noteType]}
          </p>
          <h1 className="mt-1 font-display text-[22px] leading-tight">
            {note.title || "Untitled meeting"}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {format(fromISO(note.date), "d MMMM yyyy")}
            {note.time ? ` · ${note.time}` : ""}
            {note.location ? ` · ${note.location}` : ""}
            {note.type ? ` · ${meetingTypeLabel[note.type]}` : ""}
          </p>
          {context ? <p className="mt-1 text-[13px]">{context.name}</p> : null}

          {note.facilitatorId || note.noteTakerId ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {note.facilitatorId ? (
                <>
                  Chaired by <PersonName personId={note.facilitatorId} />
                </>
              ) : null}
              {note.facilitatorId && note.noteTakerId ? " · " : ""}
              {note.noteTakerId ? (
                <>
                  Minuted by <PersonName personId={note.noteTakerId} />
                </>
              ) : null}
            </p>
          ) : null}

          {note.participantIds.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Present:{" "}
              {note.participantIds.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : ""}
                  <PersonName personId={id} />
                </span>
              ))}
            </p>
          ) : null}

          {note.absenteeIds && note.absenteeIds.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Apologies:{" "}
              {note.absenteeIds.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : ""}
                  <PersonName personId={id} />
                </span>
              ))}
            </p>
          ) : null}

          {note.tags.length > 0 ? (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {note.tags.map((t) => `#${t}`).join(" ")}
            </p>
          ) : null}
        </header>

        <div data-print="section" className="mt-4">
          <MeetingDocument blocks={note.blocks} readOnly />
        </div>

        {own.length > 0 ? (
          <section data-print="section" className="mt-6 border-t border-border pt-3">
            <h2 className="text-[13px] font-semibold">Actions</h2>
            <ul className="mt-1.5 space-y-1">
              {own.map((task) => (
                <li key={task.id} className="text-[14px]">
                  {task.status === "done" ? "☑" : "☐"} {task.title}
                  {task.assigneeId ? (
                    <span className="text-muted-foreground">
                      {" — "}
                      <PersonName personId={task.assigneeId} />
                    </span>
                  ) : null}
                  {task.dueDate ? (
                    <span className="text-muted-foreground">
                      {" · due "}
                      {format(fromISO(task.dueDate), "d MMM")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  );
}
