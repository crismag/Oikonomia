import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Cloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  MessageSquare,
  NotebookPen,
  Paperclip,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { SectionDocuments } from "@/components/oikonomia/section-documents";
import { Pagination } from "@/components/oikonomia/pagination";
import { PAGE_SIZE, windowFromMeta } from "@/domain/pagination";
import { errorMessage } from "@/lib/calendar-client";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { useReachOut } from "@/components/oikonomia/reach-out-provider";
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
  commentCount,
  displayTitle,
  laterContributors,
  preview,
  reportsNewestFirst,
  searchReports,
  shortDateLabel,
  wasEdited,
} from "@/domain/reach-out";
import { toISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { StarButton, starredFirst, useStarred } from "@/components/oikonomia/starred";
import type { BinderDocument, DocumentOrigin, ReachOutReport } from "@/domain/types";

type Tab = "reports" | "documents";

export const Route = createFileRoute("/reach-out/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    search["tab"] === "documents" ? { tab: "documents" } : {},
  head: () => ({
    meta: [
      { title: "Reach-Out — Oikonomia" },
      {
        name: "description",
        content: "Reach-Out reports and the working materials that go with them.",
      },
    ],
  }),
  component: ReachOutPage,
});

/**
 * Reach-Out.
 *
 * Two kinds of artifact in one small section: the reports leaders write, and
 * the working materials that support them. Neither is a category of outreach —
 * the section deliberately knows nothing about what the outreach *was*.
 */
function ReachOutPage() {
  const { personById } = useOrganization();
  const { tab = "reports" } = Route.useSearch();

  return (
    <Page>
      {/* The word is the church's, not a common one, so the page says what it
          holds. "Any leader" is the module's rule: authorship is provenance. */}
      <PageHeader
        title="Reach-Out"
        description="What happened when leaders reached out, written down so any leader can pick it up and continue."
      />

      <nav aria-label="Reach-Out views" className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            { id: "reports", label: "Reports" },
            { id: "documents", label: "Documents" },
          ] as const
        ).map(({ id, label }) => (
          <Link
            key={id}
            to="/reach-out"
            search={id === "reports" ? {} : { tab: id }}
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

      {tab === "reports" ? <Reports /> : <Documents />}
    </Page>
  );
}

/* ---------------------------------------------------------------- reports */

/**
 * The cumulative list of reports.
 *
 * A straightforward vertical scroll, newest first. Each row carries just
 * enough to find the one you want — date, title, who wrote it, the opening
 * words — because the report contents are the important information and the
 * list is only a way in.
 */
function Reports() {
  const { person } = useViewer();
  const store = useReachOut();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  /* Searching and paging happen in the database; the list renders what came
     back. `searchReports` stays in the domain for in-memory callers. */
  const { setQuery: ask } = store;
  useEffect(() => {
    ask({ page: 1, pageSize: PAGE_SIZE, ...(query.trim() ? { search: query.trim() } : {}) });
  }, [ask, query]);

  const starred = useStarred();
  const visible = starredFirst(reportsNewestFirst(store.reports), (r) =>
    starred.isStarred("reach-out-report", r.id),
  );
  const [failure, setFailure] = useState<unknown>(null);

  /* Open the report only once it exists — §20. */
  const add = async () => {
    setFailure(null);
    try {
      const id = await store.createReport(person.id, toISO(new Date()));
      void navigate({
        to: "/reach-out/$reportId",
        params: { reportId: id },
        search: { edit: true },
      });
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:max-w-xs">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search reports</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reports"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>

        <Button
          type="button"
          onClick={() => void add()}
          variant="primary"
          disabled={store.saving}
          busy={store.saving}
          className="shrink-0"
        >
          <Plus className="size-3.5" aria-hidden />
          Add report
        </Button>
      </div>

      {failure ? (
        <p role="alert" className="mb-3 text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      {store.status === "error" ? (
        <ErrorState title="Reach-Out could not be loaded" onRetry={store.retry}>
          Your reports are safe. This is a problem reaching them.
        </ErrorState>
      ) : store.status === "loading" ? (
        <ListSkeleton rows={5} />
      ) : visible.length > 0 ? (
        <>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {visible.map((report) => (
              <ReportRow key={report.id} report={report} starred={starred} />
            ))}
          </ul>
          <Pagination
            window={windowFromMeta(visible, store.page)}
            onPage={(n) => store.setQuery({ ...store.query, page: n })}
            noun="report"
          />
        </>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={NotebookPen} title={query ? "No reports match" : "No reports yet"}>
            {query
              ? "Try a different word from the report."
              : "Write what happened. Whatever you would tell another leader belongs here."}
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function ReportRow({
  report,
  starred,
}: {
  report: ReachOutReport;
  starred: ReturnType<typeof useStarred>;
}) {
  const comments = commentCount(report);
  const others = laterContributors(report);

  return (
    <li className="row-quiet border-b border-border last:border-b-0">
      <Link to="/reach-out/$reportId" params={{ reportId: report.id }} className="block px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <StarButton
            starred={starred.isStarred("reach-out-report", report.id)}
            onToggle={() => starred.toggle("reach-out-report", report.id)}
            label={displayTitle(report)}
          />
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {shortDateLabel(report.reportDate)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
            {displayTitle(report)}
          </span>
          {comments > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
              <MessageSquare className="size-3.5" aria-hidden />
              {comments}
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Reported by <PersonName personId={report.authorId} />
          {others.length > 0
            ? ` · with ${others.length} other ${others.length === 1 ? "leader" : "leaders"}`
            : wasEdited(report)
              ? " · updated"
              : ""}
        </p>

        {report.content.trim() ? (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {preview(report.content)}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] italic text-muted-foreground">Nothing written yet.</p>
        )}
      </Link>
    </li>
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
 * Reach-Out's working materials.
 *
 * The same binder documents Ministry keeps, owned by the section rather than by
 * a ministry. A document here supports the work in general; it is not filed
 * under any one report, and does not have to be.
 */
function Documents() {
  return (
    <SectionDocuments
      section="reach-out"
      emptyLabel="No documents are filed under Reach-Out yet. Registering one tells the binder it exists and where it lives; the document itself stays where it is."
    />
  );
}
