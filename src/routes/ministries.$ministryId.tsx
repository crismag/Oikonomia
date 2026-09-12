import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import {
  ChevronLeft,
  Cloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Megaphone,
  NotebookPen,
  Paperclip,
  Plus,
  Target,
  Upload,
} from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { useGoals } from "@/components/oikonomia/goals-provider";
import { useMeetings } from "@/components/oikonomia/meeting-provider";
import { Page } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { goalCounts, goalsForYear } from "@/domain/goals";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { createBinderDocument } from "@/lib/documents-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { useFiledDocuments } from "@/components/oikonomia/filed-documents";
import {
  activityFor,
  canContribute,
  canManage,
  notesForMinistry,
  relationshipLabel,
  relationshipTo,
} from "@/domain/ministry";
import { fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import type { Ministry, ResourceSearchResult } from "@/domain/types";

type View = "overview" | "goals" | "documents" | "activity";

export const Route = createFileRoute("/ministries/$ministryId")({
  validateSearch: (search: Record<string, unknown>): { view?: View } => {
    const views: View[] = ["overview", "goals", "documents", "activity"];
    return views.includes(search["view"] as View) ? { view: search["view"] as View } : {};
  },
  head: () => ({ meta: [{ title: "Ministry — Oikonomia" }] }),
  component: MinistryWorkspace,
});

const tabs: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "goals", label: "Goals" },
  { id: "documents", label: "Documents" },
  { id: "activity", label: "Activity" },
];

/**
 * A ministry working area.
 *
 * The ministry owns its information — goals, documents, announcements, files —
 * and that information stays with the ministry when leadership changes. What
 * *you* can do here depends on your relationship to it, not on who typed
 * something first.
 */
function MinistryWorkspace() {
  const { campuses, ministries } = useOrganization();
  const { ministryId } = Route.useParams();
  const { view = "overview" } = Route.useSearch();
  const { person } = useViewer();

  const ministry = ministries.find((m) => m.id === ministryId);
  if (!ministry) throw notFound();

  const relationship = relationshipTo(ministry, person.id);
  const campus = campuses.find((c) => c.id === ministry.campusId);
  /*
   * The ministry's shelf is the document registry, narrowed to this ministry —
   * the same records resource search reads, never a second filing place.
   */
  const filed = useFiledDocuments("ministry", ministry.id);
  const docs = filed.documents;
  const team = ministry.teamIds.length;

  /* Naming the lead already says who leads it; repeating "You lead this
     ministry" underneath your own name is noise. Serving and sharing are not
     visible from the lead's name, so those are still worth a word. */
  const showRelationship = relationship === "participate" || relationship === "shared";

  return (
    <Page>
      <Link
        to="/ministries"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Ministries
      </Link>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{campus?.name}</p>
          <h1 className="mt-0.5 font-display text-[26px] leading-tight">{ministry.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <PersonAvatar personId={ministry.leadId} size="sm" />
              <PersonName personId={ministry.leadId} /> leads
            </span>
            {team > 0 ? <span>{team === 1 ? "1 on the team" : `${team} on the team`}</span> : null}
            {showRelationship ? <span>{relationshipLabel[relationship]}</span> : null}
          </p>
        </div>

        {canContribute(relationship) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <NewMenu
              ministryId={ministry.id}
              manage={canManage(relationship)}
              contribute={canContribute(relationship)}
            />
          </div>
        ) : null}
      </header>

      <nav
        aria-label="Ministry views"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to="/ministries/$ministryId"
            params={{ ministryId: ministry.id }}
            search={{ view: tab.id }}
            aria-current={view === tab.id ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
              view === tab.id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {view === "overview" ? <Overview ministry={ministry} documents={docs} shelf={filed} /> : null}
      {view === "goals" ? <Goals ministry={ministry} /> : null}
      {view === "documents" ? (
        <Documents documents={docs} shelf={filed} canEdit={canContribute(relationship)} />
      ) : null}
      {view === "activity" ? <Activity ministry={ministry} /> : null}
    </Page>
  );
}

/* --------------------------------------------------------------- overview */

/**
 * What the ministry is holding right now.
 *
 * Documents lead, because the ministry is a repository first. Goals and
 * meeting notes sit beside them rather than under them, so an area with little
 * filed yet still reads as a working shelf and not as an empty dashboard.
 */
type Shelf = ReturnType<typeof useFiledDocuments>;

function Overview({
  ministry,
  documents,
  shelf,
}: {
  ministry: Ministry;
  documents: ResourceSearchResult[];
  shelf: Shelf;
}) {
  const { goals } = useGoals();
  const { notes } = useMeetings();
  const year = new Date().getFullYear();
  const tally = goalCounts(goalsForYear(goals, year).filter((g) => g.ministryId === ministry.id));

  const announcements = documents.filter((doc) => doc.kind === "Announcement");
  const recent = documents.filter((doc) => doc.kind !== "Announcement").slice(0, 6);
  const ministryNotes = notesForMinistry(notes, ministry.id);

  return (
    <div className="space-y-4">
      {announcements.map((item) => (
        <div key={item.id} className="rounded-lg border border-border bg-surface-muted px-4 py-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Megaphone className="size-3.5" aria-hidden />
            Announcement
          </p>
          {/* A binder-native announcement is written on its own page, so the
              banner names it and hands the reader there rather than trying to
              show a block document inside a box. */}
          {item.openRoute ? (
            <Link
              to={item.openRoute}
              className="mt-1 block text-[14px] leading-relaxed hover:underline"
            >
              {item.title || "Untitled announcement"}
            </Link>
          ) : (
            <p className="mt-1 text-[14px] leading-relaxed">{item.description ?? item.title}</p>
          )}
        </div>
      ))}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section
          title="Recent documents"
          action={
            <Link
              to="/ministries/$ministryId"
              params={{ ministryId: ministry.id }}
              search={{ view: "documents" as const }}
              className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              All documents
            </Link>
          }
        >
          {shelf.status === "loading" ? (
            <ListSkeleton rows={3} />
          ) : shelf.status === "error" ? (
            <ErrorState title="This shelf could not be read" onRetry={shelf.retry}>
              Nothing is lost. This is a problem reaching the binder's index.
            </ErrorState>
          ) : recent.length > 0 ? (
            <ul className="divide-y divide-border">
              {recent.map((doc) => (
                <DocumentRow key={doc.id} document={doc} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={FolderOpen} title="Nothing filed yet">
              Plans, reports, schedules and files kept by this ministry appear here.
            </EmptyState>
          )}
        </Section>

        <div className="space-y-4">
          <Section
            title={`${year} Goals`}
            meta={tally.total > 0 ? `${tally.completed} of ${tally.total} complete` : undefined}
            action={
              <Link
                to="/ministries/$ministryId"
                params={{ ministryId: ministry.id }}
                search={{ view: "goals" as const }}
                className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
              >
                Open
              </Link>
            }
          >
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              {tally.total > 0
                ? `${tally.active} active · ${tally.completed} completed${
                    tally.onHold > 0 ? ` · ${tally.onHold} on hold` : ""
                  }`
                : "No goals set for this year."}
            </p>
          </Section>

          <Section title="Meeting notes">
            {ministryNotes.length > 0 ? (
              <ul className="divide-y divide-border">
                {ministryNotes.slice(0, 4).map((note) => (
                  <li key={note.id} className="row-quiet">
                    <Link
                      to="/meeting-notes"
                      search={{ note: note.id }}
                      className="flex items-baseline gap-3 px-4 py-2.5"
                    >
                      <span className="w-11 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {format(fromISO(note.date), "d MMM")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px]">{note.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                No meetings recorded for this ministry.
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ goals */

/**
 * The ministry's own goals.
 *
 * Listed here in full rather than linked away, so goals read as the ministry's
 * own rather than as a separate system that happens to know about ministries.
 */
function Goals({ ministry }: { ministry: Ministry }) {
  const { goals } = useGoals();
  const year = new Date().getFullYear();
  const mine = goalsForYear(goals, year).filter((g) => g.ministryId === ministry.id);

  return (
    <Section
      title={`${year} Goals`}
      meta={mine.length > 0 ? `${mine.length}` : undefined}
      action={
        mine.length > 0 ? (
          <Link
            to="/goals"
            search={{ year }}
            className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
          >
            Every goal this year
          </Link>
        ) : undefined
      }
    >
      {mine.length > 0 ? (
        <ol className="divide-y divide-border">
          {mine.map((goal) => (
            <li key={goal.id} className="row-quiet">
              <Link
                to="/goals/$goalId"
                params={{ goalId: goal.id }}
                className="flex items-start gap-3 px-4 py-2.5"
              >
                <span className="w-6 shrink-0 pt-0.5 text-right font-display text-[14px] tabular-nums text-foreground">
                  {String(goal.number).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{goal.title}</span>
                  {goal.description ? (
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {goal.description}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={Target} title="No goals set for this year yet">
          Goals set here stay with {ministry.name}.
        </EmptyState>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------- documents */

function Documents({
  documents,
  shelf,
  canEdit,
}: {
  documents: ResourceSearchResult[];
  shelf: Shelf;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = documents
    .filter((doc) => (kind ? doc.kind === kind : true))
    .filter(
      (doc) =>
        !q ||
        doc.title.toLowerCase().includes(q) ||
        (doc.description ?? "").toLowerCase().includes(q),
    );

  /* The kinds actually on this shelf, so the chips describe the ministry
     rather than the application's vocabulary. */
  const kinds = [...new Set(documents.map((doc) => doc.kind).filter(Boolean))] as string[];

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:w-64">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search documents</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="-mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5">
            <TypeChip active={kind === null} onClick={() => setKind(null)}>
              All
            </TypeChip>
            {kinds.map((option) => (
              <TypeChip
                key={option}
                active={kind === option}
                onClick={() => setKind(kind === option ? null : option)}
              >
                {option}
              </TypeChip>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {shelf.status === "loading" ? (
          <ListSkeleton rows={4} />
        ) : shelf.status === "error" ? (
          <ErrorState title="This shelf could not be read" onRetry={shelf.retry}>
            Nothing is lost. This is a problem reaching the binder's index.
          </ErrorState>
        ) : visible.length > 0 ? (
          <ul className="divide-y divide-border">
            {visible.map((doc) => (
              <DocumentRow key={doc.id} document={doc} showMeta />
            ))}
          </ul>
        ) : (
          <EmptyState icon={FolderOpen} title="No documents match">
            {canEdit
              ? "Register a document from Documents & Forms and file it under this ministry."
              : "Nothing has been shared with you here yet."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

/**
 * One document row.
 *
 * Only rows that actually go somewhere respond to the pointer — a document
 * whose content is not openable from here must not behave as though it were.
 * Opening an external one leaves the binder, and whoever keeps it decides
 * whether it opens; appearing on this shelf has never been a promise that it
 * will.
 */
function DocumentRow({
  document,
  showMeta,
}: {
  document: ResourceSearchResult;
  showMeta?: boolean;
}) {
  /* Binder-native documents open here; the rest open where they live. */
  const openable = !!document.openUrl || !!document.openRoute;
  const Icon = document.external ? Cloud : NotebookPen;

  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{document.title}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {[document.kind, document.provider].filter(Boolean).join(" · ")}
          {showMeta && document.addedById ? (
            <>
              {" · registered by "}
              <PersonName personId={document.addedById} />
            </>
          ) : null}
          {document.updatedAt ? ` · ${format(fromISO(document.updatedAt), "d MMM")}` : ""}
        </span>
      </span>
      {document.openUrl ? (
        <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );

  return (
    <li className={cn(openable && "row-quiet")}>
      {document.openRoute ? (
        <Link to={document.openRoute} className="flex items-start gap-3 px-4 py-2.5">
          {body}
        </Link>
      ) : document.openUrl ? (
        <a
          href={document.openUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 px-4 py-2.5"
        >
          {body}
        </a>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

function TypeChip({
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

/* --------------------------------------------------------------- activity */

function Activity({ ministry }: { ministry: Ministry }) {
  /*
   * Activity is a **reading of the ministry's own records**, not a feed
   * somebody writes to. It used to be a fixture list — plausible sentences
   * about people doing things, attached to a ministry that did not store any
   * of it.
   *
   * What is real is what the ministry has: progress noted against its goals,
   * and the notes taken at its meetings. Each entry below is one of those,
   * with the date and the person the record itself carries.
   */
  const { goals, updates } = useGoals();
  const { notes } = useMeetings();

  const goalIds = new Set(goals.filter((goal) => goal.ministryId === ministry.id).map((g) => g.id));
  const titleOf = (goalId: string) => goals.find((goal) => goal.id === goalId)?.title ?? "a goal";

  const entries = [
    ...updates
      .filter((update) => goalIds.has(update.goalId))
      .map((update) => ({
        id: update.id,
        at: update.date,
        actorId: update.authorId ?? "",
        summary: `noted progress on ${titleOf(update.goalId)}`,
      })),
    ...notesForMinistry(notes, ministry.id).map((note) => ({
      id: note.id,
      at: note.date,
      actorId: note.authorId ?? note.noteTakerId ?? "",
      summary: `recorded ${note.title}`,
    })),
  ]
    .filter((entry) => entry.actorId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <Section title="Recent activity">
      {entries.length > 0 ? (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-3 px-4 py-2.5">
              <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {format(fromISO(entry.at), "d MMM")}
              </span>
              <span className="min-w-0 flex-1 text-[14px]">
                <PersonName personId={entry.actorId} /> {entry.summary}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-[13px] text-muted-foreground">Nothing recorded yet.</p>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- creation */

type NewItem = {
  label: string;
  icon: typeof FileText;
  to?: "/goals" | "/meeting-notes" | "/forms";
  /** A kind the binder itself keeps, created here and opened for writing. */
  kind?: "Plan" | "Report" | "Announcement" | "Checklist" | "Update";
};

/**
 * What a leader can add to the ministry.
 *
 * Everything the ministry will eventually hold is listed, because the menu is
 * the honest shape of the product. What is not built yet is marked "Soon" and
 * genuinely disabled, so nothing here looks operational that is not.
 *
 * Plan, Report, Announcement and Checklist are real now: they create a document
 * the binder keeps and open it for writing. "Add existing material" is not —
 * registering a link is done from Documents & Forms, and the binder still
 * cannot store an uploaded file.
 */
function NewMenu({
  ministryId,
  manage,
  contribute,
}: {
  ministryId: string;
  manage: boolean;
  contribute: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const start = async (kind: NonNullable<NewItem["kind"]>) => {
    setBusy(true);
    setFailure(null);
    try {
      const created = unwrap(
        (await withTimeout(
          createBinderDocument({ data: { ministryId, kind, title: "" } }),
        )) as never,
      ) as { id: string };
      void queryClient.invalidateQueries({ queryKey: ["filed-documents"] });
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
      setOpen(false);
      void navigate({ to: "/documents/$documentId", params: { documentId: created.id } });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const binderNative: NewItem[] = [
    { label: "Goals", icon: Target, to: "/goals" },
    { label: "Meeting Note", icon: NotebookPen, to: "/meeting-notes" },
    { label: "Form", icon: FileText, to: "/forms" },
    { label: "Plan", icon: FileText, kind: "Plan" },
    { label: "Report", icon: FileText, kind: "Report" },
    { label: "Announcement", icon: Megaphone, kind: "Announcement" },
    { label: "Checklist", icon: FileText, kind: "Checklist" },
  ];

  const existing: NewItem[] = [
    { label: "Upload file", icon: Upload },
    { label: "Add from Drive", icon: Cloud },
    { label: "Add link", icon: Link2 },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-3.5" aria-hidden />
        New
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Create in the binder
        </p>
        <ul>
          {binderNative.map((item) => (
            <li key={item.label}>
              <MenuItem
                item={item}
                busy={busy}
                /* Writing a ministry's material is for the people who work in
                   it. Someone it is merely shared with is not shown a control
                   that would refuse them. */
                mayCreate={contribute}
                onNavigate={() => setOpen(false)}
                onCreate={start}
              />
            </li>
          ))}
        </ul>

        {failure ? (
          <p role="alert" className="px-2 py-1.5 text-[12px] text-status-overdue">
            {errorMessage(failure)}
          </p>
        ) : null}

        {manage ? (
          <>
            <div className="my-1.5 h-px bg-border" />
            <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              Add existing material
            </p>
            <ul>
              {existing.map((item) => (
                <li key={item.label}>
                  <MenuItem item={item} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>
            <p className="px-2 pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              A document kept elsewhere is registered from Documents &amp; Forms, and filed under
              this ministry from there.
            </p>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  item,
  onNavigate,
  onCreate,
  mayCreate = false,
  busy = false,
}: {
  item: NewItem;
  onNavigate: () => void;
  onCreate?: (kind: NonNullable<NewItem["kind"]>) => void;
  mayCreate?: boolean;
  busy?: boolean;
}) {
  const Icon = item.icon;
  const inner = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
    </>
  );

  if (item.kind && onCreate && mayCreate) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onCreate(item.kind!)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted disabled:opacity-60"
      >
        {inner}
      </button>
    );
  }

  if (item.to) {
    return (
      <Link
        to={item.to}
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted"
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled
      className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-disabled"
    >
      {inner}
      <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-disabled">
        Soon
      </span>
    </button>
  );
}
