import { config } from "@/config";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Cloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Lock,
  MessageSquare,
  NotebookPen,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { SectionDocuments } from "@/components/oikonomia/section-documents";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Pagination } from "@/components/oikonomia/pagination";
import { PersonName } from "@/components/oikonomia/person";
import { StatusTag } from "@/components/oikonomia/report-status";
import { useReports } from "@/components/oikonomia/report-provider";
import { FilterChip } from "@/components/oikonomia/list-toolbar";
import { reportContextLabel } from "@/domain/leadership-report";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  documentTypeLabel,
  documentsOwnedBy,
  originNote,
  pinnedFirst,
  searchDocuments,
} from "@/domain/documents";
import {
  filterReports,
  reportStatusLabel,
  isRestricted,
  reportTypeLabel,
  knownReportTypes,
  visibilityLabel,
} from "@/domain/leadership-report";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { errorMessage } from "@/lib/calendar-client";
import { paginate } from "@/domain/pagination";
import { fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import type {
  BinderDocument,
  ContentSource,
  DocumentOrigin,
  LeadershipReport,
  ReportStatus,
  ReportType,
  ReportVisibility,
} from "@/domain/types";

type Tab = "mine" | "shared" | "documents";

/**
 * Reading state lives in the URL.
 *
 * A leader who has filtered to their September ministry reports and paged to
 * the third screen has done work; Back, a refresh, a bookmark or a link sent to
 * a colleague must all preserve it. `page` is a view of the result set, never a
 * stored position — changing any filter drops it, and `paginate` clamps what
 * remains, so narrowing a filter can never strand the reader on an empty page.
 */
type SearchState = {
  tab?: Tab;
  q?: string;
  status?: ReportStatus;
  type?: string;
  visibility?: ReportVisibility;
  ministry?: string;
  tag?: string;
  /** Where the report was written. A dimension of the list, not of access. */
  source?: string;
  page?: number;
};

/** A patch may clear a filter, which `Partial<T>` alone cannot express. */
type SearchPatch = { [K in keyof SearchState]?: SearchState[K] | undefined };

export const Route = createFileRoute("/leadership-reports/")({
  validateSearch: (search: Record<string, unknown>): SearchState => {
    const tabs: Tab[] = ["mine", "shared", "documents"];
    const str = (key: string) =>
      typeof search[key] === "string" && search[key] ? (search[key] as string) : undefined;
    const page = Number(search["page"]);
    const status = statuses.includes(search["status"] as ReportStatus)
      ? (search["status"] as ReportStatus)
      : undefined;
    const visibility = visibilities.includes(search["visibility"] as ReportVisibility)
      ? (search["visibility"] as ReportVisibility)
      : undefined;

    return {
      ...(tabs.includes(search["tab"] as Tab) && search["tab"] !== "mine"
        ? { tab: search["tab"] as Tab }
        : {}),
      ...(str("q") ? { q: str("q")! } : {}),
      ...(status ? { status } : {}),
      ...(str("type") ? { type: str("type")! } : {}),
      ...(visibility ? { visibility } : {}),
      ...(str("ministry") ? { ministry: str("ministry")! } : {}),
      ...(str("tag") ? { tag: str("tag")! } : {}),
      ...(str("source") ? { source: str("source")! } : {}),
      ...(Number.isFinite(page) && page > 1 ? { page: Math.floor(page) } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Leadership Reports — Oikonomia" },
      {
        name: "description",
        content: "Leadership reporting, development and confidential communication.",
      },
    ],
  }),
  component: LeadershipReportsPage,
});

/**
 * Drop cleared filters rather than writing `?tag=undefined` into the URL, and
 * keep the result assignable under `exactOptionalPropertyTypes`.
 */
function clean(patch: SearchPatch): SearchState {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as SearchState;
}

/**
 * Leadership Reports — binder section 7.
 *
 * A leader's working surface, not a reviewer's dashboard. Everything rendered
 * here comes from `store.visible`, which the provider has already filtered:
 * a report this viewer may not discover never reaches this file at all.
 */
function LeadershipReportsPage() {
  const { ministries, personById } = useOrganization();
  const { tab = "mine" } = Route.useSearch();

  return (
    <Page>
      <PageHeader
        title="Leadership Reports"
        description="Leadership reporting, development and confidential communication."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border">
        {/* Three tabs do not fit 320px; they scroll rather than wrap under the rule. */}
        <nav
          aria-label="Leadership Reports views"
          className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto sm:flex-none"
        >
          {(
            [
              { id: "mine", label: "My Reports" },
              { id: "shared", label: "Shared With Me" },
              { id: "documents", label: "Documents" },
            ] as const
          ).map(({ id, label }) => (
            <Link
              key={id}
              to="/leadership-reports"
              search={id === "mine" ? {} : { tab: id }}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
                tab === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab !== "documents" ? <NewReportMenu /> : null}
      </div>

      {tab === "documents" ? <Documents /> : <ReportList scope={tab} />}
    </Page>
  );
}

/* ------------------------------------------------------------------ lists */

function ReportList({ scope }: { scope: "mine" | "shared" }) {
  const { person } = useViewer();
  const { personById } = useOrganization();
  const nameOf = (id: string) => personById(id).name;
  const store = useReports();
  const state = Route.useSearch();
  const navigate = useNavigate();

  /*
   * Every filter change drops `page`, because page 4 of the old result set
   * means nothing in the new one. Paging keeps the filters and changes only
   * the page. Both replace rather than push: refining a search is one act of
   * reading, and Back should leave the list, not step through every keystroke.
   */
  const patch = (next: SearchPatch) =>
    navigate({
      to: "/leadership-reports",
      search: clean({ ...state, page: undefined, ...next }),
      replace: true,
    });

  const query = state.q ?? "";
  const status = state.status ?? null;
  const reportType = state.type ?? null;
  const visibility = state.visibility ?? null;
  const ministryId = state.ministry ?? null;
  const tag = state.tag ?? null;
  const source = state.source ?? null;

  const setQuery = (v: string) => patch({ q: v || undefined });
  const setStatus = (v: ReportStatus | null) => patch({ status: v ?? undefined });
  const setReportType = (v: ReportType | null) => patch({ type: v ?? undefined });
  const setVisibility = (v: ReportVisibility | null) => patch({ visibility: v ?? undefined });
  const setMinistryId = (v: string | null) => patch({ ministry: v ?? undefined });
  const setTag = (v: string | null) => patch({ tag: v ?? undefined });

  /* An empty list and an unreachable one look identical, and only one of them
     means "there is nothing here". */
  if (store.status === "loading") return <ListSkeleton rows={4} />;
  if (store.status === "error") {
    return (
      <ErrorState title="Reports could not be loaded" onRetry={store.retry}>
        Nothing is lost. This is a problem reaching them.
      </ErrorState>
    );
  }

  /* Scope first, then filters — both applied to an already-authorized set. */
  const scoped = store.visible.filter((report) =>
    scope === "mine" ? report.authorId === person.id : report.authorId !== person.id,
  );

  const visible = filterReports(
    scoped,
    {
      ...(status ? { status } : {}),
      ...(reportType ? { reportType } : {}),
      ...(visibility ? { visibility } : {}),
      ...(ministryId ? { ministryId } : {}),
      ...(tag ? { tag } : {}),
      ...(source ? { contextType: source as LeadershipReport["contextType"] } : {}),
      query,
    },
    nameOf,
    person,
  );

  const page = paginate(visible, state.page ?? 1);

  /* Tags counted from what this viewer may see, never from every report. */
  const tags = [...new Set(scoped.flatMap((r) => r.tags))].sort();
  const typesInUse = [...new Set(scoped.map((r) => r.reportType))].sort((a, b) =>
    reportTypeLabel(a).localeCompare(reportTypeLabel(b)),
  );
  const filtering = !!(
    status ||
    reportType ||
    visibility ||
    ministryId ||
    tag ||
    source ||
    query.trim()
  );

  /*
   * Where reports came from, counted from what this viewer can see.
   *
   * A leader writes in several places and should find everything in one — so
   * the module a report came from is a filter here, never a separate list to
   * navigate to.
   */
  const sources = [...new Set(scoped.map((r) => r.contextType).filter(Boolean))] as NonNullable<
    LeadershipReport["contextType"]
  >[];

  return (
    <div>
      {sources.length > 0 ? (
        <div className="mb-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5">
            <FilterChip
              active={!source}
              onClick={() => patch({ source: undefined, page: undefined })}
            >
              All sources
            </FilterChip>
            {sources.map((option) => (
              <FilterChip
                key={option}
                active={source === option}
                onClick={() =>
                  patch({ source: source === option ? undefined : option, page: undefined })
                }
                count={scoped.filter((r) => r.contextType === option).length}
              >
                {reportContextLabel({ contextType: option } as LeadershipReport)}
              </FilterChip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:w-64">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search reports</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>

        {/* Filters collapse behind one control on narrow screens. */}
        <Filters
          className="hidden sm:flex"
          {...{
            typesInUse,
            status,
            setStatus,
            reportType,
            setReportType,
            visibility,
            setVisibility,
            ministryId,
            setMinistryId,
          }}
        />
        <MobileFilters
          {...{
            typesInUse,
            status,
            setStatus,
            reportType,
            setReportType,
            visibility,
            setVisibility,
            ministryId,
            setMinistryId,
          }}
        />
      </div>

      {tags.length > 0 ? (
        <div className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5">
            {tags.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTag(tag === option ? null : option)}
                aria-pressed={tag === option}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                  tag === option
                    ? "border-primary/30 bg-accent-soft font-medium text-sidebar-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                #{option}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {page.items.length > 0 ? (
        <>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {page.items.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
          <Pagination
            window={page}
            onPage={(n) =>
              navigate({
                to: "/leadership-reports",
                search: clean({ ...state, page: n > 1 ? n : undefined }),
                replace: true,
              })
            }
            noun="report"
          />
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {filtering ? (
            <EmptyState icon={Search} title="No reports match" />
          ) : scope === "mine" ? (
            <EmptyState
              icon={NotebookPen}
              title="No leadership reports yet"
              action={<NewReportMenu />}
            >
              Create a report for leadership updates, development, evaluations or other reporting.
            </EmptyState>
          ) : (
            <EmptyState icon={NotebookPen} title="Nothing has been shared with you yet" />
          )}
        </div>
      )}

      {/*
       * Aggregate existence may be acknowledged; identity may not. This says
       * how many reports exist that this viewer cannot reach, and nothing
       * whatsoever about what they are or whom they concern.
       */}
      {store.withheld > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          {store.withheld} {store.withheld === 1 ? "report is" : "reports are"} held to an audience
          you are not part of.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One report in the list.
 *
 * Identity first, then confidentiality, then status — §29's hierarchy. The
 * restriction mark is noticeable without turning the page into a security
 * dashboard: ordinary leadership reports carry no mark at all.
 */
function ReportRow({ report }: { report: LeadershipReport }) {
  const { ministries } = useOrganization();
  const { person } = useViewer();
  const comments = report.comments.length;
  const aboutMe = report.subjectId === person.id;
  const ministry = ministries.find((m) =>
    report.links.some((l) => l.kind === "ministry" && l.id === m.id),
  );

  return (
    <li className="row-quiet border-b border-border last:border-b-0">
      <Link
        to="/leadership-reports/$reportId"
        params={{ reportId: report.id }}
        className="block px-4 py-3"
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
            {report.title || "Untitled report"}
          </span>
          {isRestricted(report) ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-status-overdue">
              <Lock className="size-3.5" aria-hidden />
              {visibilityLabel[report.visibility]}
            </span>
          ) : null}
          <StatusTag status={report.status} />
        </div>

        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {reportTypeLabel(report.reportType)}
          {ministry ? ` · ${ministry.name}` : ""}
          {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
        </p>

        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {aboutMe ? (
            <span className="text-status-info">About you · </span>
          ) : report.subjectId ? (
            <>
              About <PersonName personId={report.subjectId} /> ·{" "}
            </>
          ) : null}
          <PersonName personId={report.authorId} />
          {" · "}
          {format(fromISO(report.updatedAt.slice(0, 10)), "d MMM")}
          {comments > 0 ? ` · ${comments} ${comments === 1 ? "comment" : "comments"}` : ""}
        </p>

        {report.tags.length > 0 ? (
          <p className="mt-1 truncate text-[12px] text-muted-foreground">
            {report.tags.map((t) => `#${t}`).join(" ")}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

/* ---------------------------------------------------------------- filters */

interface FilterProps {
  /**
   * Types actually present, so the filter never offers a dead option and never
   * omits a type the church invented.
   */
  typesInUse: ReportType[];
  status: ReportStatus | null;
  setStatus: (v: ReportStatus | null) => void;
  reportType: ReportType | null;
  setReportType: (v: ReportType | null) => void;
  visibility: ReportVisibility | null;
  setVisibility: (v: ReportVisibility | null) => void;
  ministryId: string | null;
  setMinistryId: (v: string | null) => void;
}

/* Offered from configuration: a status an administrator stopped offering
   must not still appear in a filter. */
const statuses = config.options("reports.statuses").map((s) => s.id) as ReportStatus[];
const visibilities = config.options("reports.visibility").map((v) => v.id) as ReportVisibility[];

function Filters({ className, ...p }: FilterProps & { className?: string }) {
  const { ministries } = useOrganization();
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select
        label="Status"
        value={p.status}
        onChange={p.setStatus}
        options={statuses}
        render={(s) => reportStatusLabel[s]}
      />
      <Select
        label="Type"
        value={p.reportType}
        onChange={p.setReportType}
        options={p.typesInUse}
        render={(t) => reportTypeLabel(t)}
      />
      <Select
        label="Visibility"
        value={p.visibility}
        onChange={p.setVisibility}
        options={visibilities}
        render={(v) => visibilityLabel[v] ?? v}
      />
      <Select
        label="Ministry"
        value={p.ministryId}
        onChange={p.setMinistryId}
        options={ministries.map((m) => m.id)}
        render={(id) => ministries.find((m) => m.id === id)?.name ?? id}
      />
    </div>
  );
}

/** On a narrow screen the filters collapse behind one control, per §28. */
function MobileFilters(p: FilterProps) {
  const [open, setOpen] = useState(false);
  const active = [p.status, p.reportType, p.visibility, p.ministryId].filter(Boolean).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted sm:hidden">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {active > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-sidebar-accent-foreground">
            {active}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <Filters className="flex-col items-stretch" {...p} />
      </PopoverContent>
    </Popover>
  );
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: readonly T[];
  render: (v: T) => string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
        className={cn(
          "rounded-md border bg-surface px-2 py-1.5 text-[13px] outline-none",
          value ? "border-primary/30 text-foreground" : "border-border text-muted-foreground",
        )}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {render(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* --------------------------------------------------------------- creation */

/**
 * Starting a report.
 *
 * Two ways in, because a report's content may live here or in a document
 * somebody already keeps elsewhere — and either way the binder holds the
 * record.
 */
function NewReportMenu() {
  const { person } = useViewer();
  const store = useReports();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const [failure, setFailure] = useState<unknown>(null);

  const start = async (contentSource: ContentSource) => {
    setOpen(false);
    setFailure(null);
    try {
      /* The author is taken from the request, never from the caller. */
      const id = await store.createReport({
        authorId: person.id,
        reportType: "general",
        contentSource,
      });
      void navigate({
        to: "/leadership-reports/$reportId",
        params: { reportId: id },
        search: { edit: true },
      });
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <div>
      {failure ? (
        <p role="alert" className="mb-2 text-[12px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <Plus className="size-3.5" aria-hidden />
          New report
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          {(
            [
              {
                source: "native" as const,
                label: "Write report here",
                hint: "Use the binder's editor.",
              },
              {
                source: "linked-document" as const,
                label: "Link existing document",
                hint: "The content lives in a document you already keep.",
              },
            ] as const
          ).map(({ source, label, hint }) => (
            <button
              key={source}
              type="button"
              onClick={() => void start(source)}
              className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
            >
              <span className="block text-[14px] font-medium">{label}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                {hint}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* -------------------------------------------------------------- documents */

const originIcon: Record<DocumentOrigin, typeof FileText> = {
  binder: NotebookPen,
  file: Paperclip,
  drive: Cloud,
  link: Link2,
};

/**
 * Documents associated with Leadership Reports.
 *
 * An organizational view over document relationships, not a second Drive.
 * Documents attached to reports this viewer cannot discover are not listed,
 * because the attachment would disclose the report.
 */
function Documents() {
  /*
   * The registry gates these itself: a document reachable only through a
   * report this viewer cannot discover is not returned, because the
   * attachment would disclose the report.
   */
  return (
    <SectionDocuments
      section="leadership-reports"
      emptyLabel="No documents are filed under Leadership Reports yet. Registering one tells the binder it exists and where it lives."
    />
  );
}
