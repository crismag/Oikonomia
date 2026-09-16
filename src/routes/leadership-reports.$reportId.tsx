import { config } from "@/config";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ExternalLink,
  Lock,
  MessagesSquare,
  Pencil,
  Printer,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ActivityTimeline } from "@/components/oikonomia/activity";
import { CommentItem } from "@/components/oikonomia/discussion";
import { EmptyState } from "@/components/oikonomia/empty-state";
import {
  MeetingDocument,
  MeetingToolbar,
  type BlockCommand,
} from "@/components/oikonomia/meeting-editor";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { Page } from "@/components/oikonomia/page";
import { Combobox, type Suggestion } from "@/components/oikonomia/combobox";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { useOpenedReport, useReports } from "@/components/oikonomia/report-provider";
import { GuideHint } from "@/features/guide";
import { useConfirm } from "@/config/messages/handlers";
import { StatusTag } from "@/components/oikonomia/report-status";
import {
  followUpOnWeek,
  openFollowUps,
  planTransition,
  statusBehavior,
  transitionsFrom,
} from "@/domain/leadership-report";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { cn } from "@/lib/utils";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { fetchConfidentialReads } from "@/lib/reports-api";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useFiledDocuments } from "@/components/oikonomia/filed-documents";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { AskedOfYou } from "@/components/oikonomia/put-on-week";
import { useResourceSearch } from "@/components/oikonomia/resource-search-provider";
import { documentTypeLabel, originNote } from "@/domain/documents";
import {
  discussionPolicyLabel,
  hasTemplate,
  isRestricted,
  mayRemoveReport,
  namedAudience,
  relatedKindFor,
  reportContextLabel,
  reportContextPath,
  reportTypeLabel,
  subjectMattersFor,
  suggestReportTypes,
  templateFor,
  visibilityHint,
  visibilityLabel,
} from "@/domain/leadership-report";
import { categoryLabelOf, triggersAttention } from "@/domain/categories";
import { emptyBlock, sanitizeInline } from "@/domain/meeting";
import { fromISO, toISO, weekOf } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import type {
  DiscussionPolicy,
  LeadershipReport,
  MeetingBlock,
  ReportCapabilities,
  ReportType,
  ReportVisibility,
} from "@/domain/types";

type Tab = "report" | "discussion" | "documents" | "activity";

export const Route = createFileRoute("/leadership-reports/$reportId")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; edit?: true; print?: true } => {
    const tabs: Tab[] = ["report", "discussion", "documents", "activity"];
    return {
      ...(tabs.includes(search["tab"] as Tab) && search["tab"] !== "report"
        ? { tab: search["tab"] as Tab }
        : {}),
      ...(search["edit"] ? { edit: true as const } : {}),
      ...(search["print"] ? { print: true as const } : {}),
    };
  },
  /* Generic on purpose: a browser tab title must never disclose a subject. */
  head: () => ({ meta: [{ title: "Leadership report — Oikonomia" }] }),
  component: ReportPage,
});

/**
 * One leadership report.
 *
 * `store.byId` returns nothing for a report this viewer may not discover, so
 * an unauthorized deep link is indistinguishable from a report that does not
 * exist — the correct answer, and the only safe one.
 *
 * Every control below is gated on a capability rather than hidden after the
 * fact: what a person cannot do is not rendered disabled, it is not rendered.
 */
function ReportPage() {
  const { ministries, people, personById } = useOrganization();
  const { reportId } = Route.useParams();
  const { tab = "report", edit, print } = Route.useSearch();
  const store = useReports();

  /* The listed copy, or — for a confidential report someone else wrote — the
     report opened on its own, which is the read that gets recorded. */
  const opened = useOpenedReport(reportId);
  const report = opened.report;

  if (opened.failed) {
    return (
      <Page>
        <ErrorState title="This report could not be opened" onRetry={opened.retry}>
          Nothing is lost. This is a problem reaching it.
        </ErrorState>
      </Page>
    );
  }

  /* Absent is not the same as missing while it is still loading, and an
     unreachable binder is not a report that does not exist. */
  if (!report && (store.status === "loading" || opened.opening)) {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (!report && store.status === "error") {
    return (
      <Page>
        <ErrorState title="This report could not be loaded" onRetry={store.retry}>
          Nothing is lost. This is a problem reaching it.
        </ErrorState>
      </Page>
    );
  }
  /* Withheld and absent are the same answer here, deliberately: saying "you
     may not see this" would confirm that a report about somebody exists. */
  if (!report) throw notFound();

  const can = store.can(report);

  if (print) return <PrintSheet report={report} />;
  if (edit && can.edit) return <Editor report={report} />;

  return (
    <Page>
      <BackLink />
      <Header report={report} can={can} />
      <OpenedBy report={report} />

      <nav
        aria-label="Report views"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {(
          [
            { id: "report", label: "Report" },
            { id: "discussion", label: "Discussion" },
            { id: "documents", label: "Documents" },
            { id: "activity", label: "Activity" },
          ] as const
        ).map(({ id, label }) => (
          <Link
            key={id}
            to="/leadership-reports/$reportId"
            params={{ reportId: report.id }}
            search={id === "report" ? {} : { tab: id }}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
              tab === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {id === "discussion" && report.comments.length > 0
              ? ` · ${report.comments.length}`
              : ""}
          </Link>
        ))}
      </nav>

      {tab === "report" ? (
        <div className="space-y-4">
          <ReportBody report={report} />
          <FollowUpsForYourWeek report={report} />
          <AskedOfYou sourceType="leadership-report" sourceId={report.id} />
          {/*
           * A report is information. This is where its author says that one
           * part of it needs something from leadership, and where a leader who
           * read it decides something has to be done about it — without the
           * report itself becoming anybody's task.
           */}
          <EscalationControl
            sourceType="leadership-report"
            sourceId={report.id}
            contextLabel={report.title || "Leadership report"}
          />
        </div>
      ) : null}
      {tab === "discussion" ? <Discussion report={report} can={can} /> : null}
      {tab === "documents" ? <Documents report={report} /> : null}
      {tab === "activity" ? <Activity report={report} /> : null}
    </Page>
  );
}

/**
 * Where this report may go next.
 *
 * The buttons are the stages **this church** configured, not four named
 * actions compiled into the product. Which of them are offered is decided by
 * what each move turns out to require — freezing the content needs the
 * capability to submit, thawing it needs the one that survives submission —
 * so a church that adds a stage gets a working button for it and a church that
 * removes one loses the button, without a code change.
 *
 * A move the viewer may not make is not shown, and the server refuses it
 * again: this is a convenience, never the gate.
 */
function StatusActions({
  report,
  can,
  onMoved,
}: {
  report: LeadershipReport;
  can: ReportCapabilities;
  onMoved?: () => void;
}) {
  const store = useReports();

  const moves = transitionsFrom(report.status)
    .map((target) => ({ ...target, plan: planTransition(report.status, target.id) }))
    .filter((move) => can[move.plan.capability]);

  if (moves.length === 0) return null;

  return (
    <>
      {moves.map((move) => (
        <Button
          key={move.id}
          type="button"
          variant={move.plan.marksFinal ? "primary" : "secondary"}
          onClick={() => {
            store.moveTo(report.id, move.id);
            onMoved?.();
          }}
        >
          {move.label}
        </Button>
      ))}
    </>
  );
}

function BackLink() {
  return (
    <Link
      to="/leadership-reports"
      search={{}}
      className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      Leadership Reports
    </Link>
  );
}

/**
 * Delete a report that is still being worked on.
 *
 * Offered only where the server allows it — the author, while the content is
 * editable. There is no undo and no trash, so it always asks first. Once the
 * report is the submitted record it is archived instead, and this is not shown.
 */
function DeleteReport({ report }: { report: LeadershipReport }) {
  const { person } = useViewer();
  const store = useReports();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!mayRemoveReport(report, person.id)) return null;

  const remove = async () => {
    const named = report.title.trim();
    const agreed = await confirm(
      named ? "reports.delete.confirm" : "reports.delete.confirm.untitled",
      named ? { title: named } : undefined,
    );
    if (!agreed) return;
    setError(null);
    setDeleting(true);
    try {
      await store.removeReport(report.id);
      void navigate({ to: "/leadership-reports", search: {} });
    } catch (cause) {
      setDeleting(false);
      setError(errorMessage(cause));
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={deleting}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue disabled:opacity-60"
      >
        <Trash2 className="size-3.5" aria-hidden />
        {deleting ? "Deleting…" : "Delete report"}
      </button>
      {error ? (
        <span role="alert" className="text-[12px] text-status-overdue">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/* ----------------------------------------------------------------- header */

/**
 * Identity, then confidentiality, then status — §29's hierarchy.
 *
 * The restriction mark is noticeable without turning the page into a security
 * dashboard: an ordinary leadership report carries none.
 */
function Header({ report, can }: { report: LeadershipReport; can: ReportCapabilities }) {
  const sourcePath = reportContextPath(report);
  const { person } = useViewer();
  const store = useReports();
  const [showAccess, setShowAccess] = useState(false);

  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] leading-tight">
            {report.title || "Untitled report"}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
            <span>{reportTypeLabel(report.reportType)}</span>
            {report.reportingPeriod ? <span>{report.reportingPeriod}</span> : null}
            <StatusTag status={report.status} />
            {/*
             * What kind of information this is — and, where the category asks
             * for attention, said so plainly. It is not a status: the report is
             * published either way, and nobody has to process it.
             */}
            {report.category && report.category !== "general" ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  triggersAttention(report.category)
                    ? "border-status-waiting/35 bg-status-waiting-soft text-status-waiting"
                    : "border-border text-muted-foreground",
                )}
              >
                {categoryLabelOf(report.category)}
              </span>
            ) : null}
            {/*
             * Where it was written. Context, not a filing cabinet: the leader
             * manages it here, and this only offers the way back.
             */}
            {sourcePath ? (
              <Link
                to={sourcePath.to}
                {...(sourcePath.search ? { search: sourcePath.search } : {})}
                className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {reportContextLabel(report)}
              </Link>
            ) : reportContextLabel(report) ? (
              <span>{reportContextLabel(report)}</span>
            ) : null}
            {report.confidential ? (
              <span className="inline-flex items-center rounded-full border border-status-overdue/35 px-2 py-0.5 text-[11px] font-medium text-status-overdue">
                Confidential
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setShowAccess((v) => !v)}
              aria-expanded={showAccess}
              className={cn(
                "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
                isRestricted(report) ? "text-status-overdue" : "text-muted-foreground",
              )}
            >
              <Lock className="size-3.5" aria-hidden />
              {visibilityLabel[report.visibility]}
            </button>
          </div>

          <p className="mt-1.5 text-[13px] text-muted-foreground">
            <PersonName personId={report.authorId} />
            {report.subjectId || report.subjectText ? (
              <>
                {" · about "}
                {report.subjectId === person.id ? (
                  <span className="text-status-info">you</span>
                ) : report.subjectId ? (
                  <PersonName personId={report.subjectId} />
                ) : (
                  report.subjectText
                )}
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to="/leadership-reports/$reportId"
            params={{ reportId: report.id }}
            search={{ print: true as const }}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Printer className="size-3.5" aria-hidden />
            Print
          </Link>

          {can.edit ? (
            <Link
              to="/leadership-reports/$reportId"
              params={{ reportId: report.id }}
              search={{ edit: true as const }}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Link>
          ) : null}

          <StatusActions report={report} can={can} />
        </div>
      </div>

      {mayRemoveReport(report, person.id) ? (
        <div className="mt-2">
          <DeleteReport report={report} />
        </div>
      ) : null}

      {showAccess ? <AccessPanel report={report} can={can} /> : null}

      {!statusBehavior(report.status).editable ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {config.label("reports.statuses", report.status)}
          {report.publishedAt
            ? ` ${format(fromISO(report.publishedAt.slice(0, 10)), "d MMMM")}`
            : ""}
          . The report content is the submitted record; discussion continues below.
          {/* Said to the author, who is the one who would look for Delete. */}
          {report.authorId === person.id
            ? can.archive
              ? " It cannot be deleted — archive it when it is no longer current."
              : " It cannot be deleted."
            : ""}
        </p>
      ) : null}
    </header>
  );
}

/**
 * Who can reach this report.
 *
 * Named plainly, right where the label is, rather than buried in settings — a
 * leader writing something confidential should be able to see the audience
 * without hunting for it.
 */
function AccessPanel({ report, can }: { report: LeadershipReport; can: ReportCapabilities }) {
  const store = useReports();
  const audience = namedAudience(report);

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-muted px-4 py-3">
      <p className="text-[13px] font-medium">{visibilityLabel[report.visibility]}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {visibilityHint[report.visibility]}
      </p>

      {report.visibility !== "leadership" ? (
        <>
          <p className="mt-2.5 text-[12px] font-medium text-muted-foreground">Visible to</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {audience.map((personId) => (
              <li key={personId} className="flex items-center gap-1.5 text-[13px]">
                <PersonAvatar personId={personId} size="sm" />
                <PersonName personId={personId} />
                {personId === report.authorId ? (
                  <span className="text-[11px] text-muted-foreground">author</span>
                ) : personId === report.subjectId ? (
                  <span className="text-[11px] text-muted-foreground">subject</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-2.5 text-[12px] text-muted-foreground">
        {discussionPolicyLabel[report.discussionPolicy]}
      </p>

      {can.manageAccess ? (
        <Link
          to="/leadership-reports/$reportId"
          params={{ reportId: report.id }}
          search={{ edit: true as const }}
          className="mt-2 inline-flex min-h-6 items-center gap-1.5 inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
        >
          <Users className="size-3.5" aria-hidden />
          Manage access
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ body */

/**
 * The report content.
 *
 * Native reports render through the binder's existing document renderer —
 * there is no second editor. A linked report shows what and where, because the
 * record is real here even when the writing lives elsewhere.
 */
function ReportBody({ report }: { report: LeadershipReport }) {
  /* Documents filed against this report, from the registry. Nothing is
     resolved against a list compiled into the application any more, so a
     report can only point at a document somebody actually registered. */
  const filed = useFiledDocuments("leadership-report", report.id);

  if (report.contentSource === "linked-document") {
    const document = filed.documents.find((d) => d.id === report.primaryDocumentId);
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-card px-5 py-4">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          Report content
        </p>
        <p className="mt-1 text-[15px]">{document?.title ?? "No document linked yet"}</p>
        {document ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {[document.kind, document.provider].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {document?.openUrl ? (
          <a
            href={document.openUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
          >
            Open the document
          </a>
        ) : null}
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          The content of this report is kept in a document. The binder holds the report itself — who
          wrote it, who may read it, and the discussion around it.
        </p>
      </div>
    );
  }

  const blocks = report.blocks ?? [];
  if (blocks.length === 0 || blocks.every((b) => !b.html)) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <EmptyState icon={Pencil} title="Nothing written yet" />
      </div>
    );
  }

  return (
    <article className="rounded-2xl border border-border bg-surface shadow-card px-5 py-4">
      <MeetingDocument blocks={blocks} readOnly />
    </article>
  );
}

/**
 * The author's own follow-ups, onto their own week.
 *
 * A follow-up line is the author saying something needs doing. Only the author
 * is offered this: the report stays information for everyone else, and asking
 * another leader for something is what "Does this need anything from
 * leadership?" is for. A line goes on the week — filed to this week rather
 * than to a day nobody chose — and once there it links to the week instead.
 */
function FollowUpsForYourWeek({ report }: { report: LeadershipReport }) {
  const { person } = useViewer();
  const schedule = useSchedule();
  const [failure, setFailure] = useState<unknown>(null);

  const followUps = openFollowUps(report);
  if (report.authorId !== person.id || followUps.length === 0) return null;

  const thisWeek = weekOf(toISO(new Date()));

  return (
    <section
      aria-label="Follow-ups in this report"
      className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3.5"
    >
      <h3 className="text-[13px] font-medium">Follow-ups in this report</h3>
      <p className="text-[12px] text-muted-foreground">
        Put one on your week to carry it out. It is filed to the week, not to a day.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {followUps.map((item) => {
          const onWeek = followUpOnWeek(schedule.agenda, report.id, item.blockId);
          return (
            <li
              key={item.blockId}
              className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
            >
              <span className="min-w-0 flex-1 text-[14px] leading-6">{item.text}</span>
              {onWeek ? (
                <Link
                  to="/weekly-agenda"
                  search={{ date: onWeek.date ?? onWeek.weekOf ?? thisWeek }}
                  className="inline-flex min-h-6 items-center px-2.5 py-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  On your week
                </Link>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={schedule.saving}
                  onClick={() => {
                    setFailure(null);
                    void schedule
                      .addAgenda({
                        text: item.text,
                        weekOf: thisWeek,
                        reportId: report.id,
                        reportBlockId: item.blockId,
                      })
                      .catch(setFailure);
                  }}
                >
                  Put on my week
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {failure ? (
        <p role="alert" className="mt-1.5 text-[12px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Who has opened a confidential report — shown to its author, and to nobody
 * else. Only openings by other people are recorded; the author's own are not.
 */
function OpenedBy({ report }: { report: LeadershipReport }) {
  const { person } = useViewer();
  const mine = report.confidential && report.authorId === person.id;
  const reads = useQuery<{ actorId: string; at: string }[]>({
    queryKey: ["confidential-reads", report.id],
    queryFn: async () =>
      unwrap(await withTimeout(fetchConfidentialReads({ data: { id: report.id } }))),
    enabled: !!mine,
    networkMode: "always",
  });
  if (!mine) return null;
  const rows = reads.data ?? [];

  return (
    <section
      aria-label="Opened by"
      className="mb-4 rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-[13px]"
    >
      <p className="font-medium">Confidential · who has opened it</p>
      {rows.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {rows.slice(0, 20).map((row, index) => (
            <li key={`${row.actorId}-${row.at}-${index}`}>
              <PersonName personId={row.actorId} /> ·{" "}
              {format(new Date(row.at), "d MMM yyyy, HH:mm")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-muted-foreground">
          {reads.isPending ? "Checking…" : "Nobody else has opened it yet."}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- discussion */

/**
 * Continuing feedback.
 *
 * Separate from publication on purpose: a published report is the submitted
 * record and does not change, while the conversation about it stays open. That
 * separation is what makes an accountability record usable.
 */
function Discussion({ report, can }: { report: LeadershipReport; can: ReportCapabilities }) {
  const { person } = useViewer();
  const store = useReports();
  const [draft, setDraft] = useState("");

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    store.addComment(report.id, person.id, body);
    setDraft("");
  };

  return (
    <div>
      {report.comments.length > 0 ? (
        <ul className="mb-4 space-y-1">
          {report.comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      ) : (
        <div className="mb-4 rounded-2xl border border-border bg-surface shadow-card">
          <EmptyState icon={MessagesSquare} title="No discussion yet">
            {can.comment
              ? "Questions, responses and feedback about this report go here."
              : undefined}
          </EmptyState>
        </div>
      )}

      {can.comment ? (
        <div className="rounded-2xl border border-border bg-surface shadow-card px-3 py-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={draft ? 3 : 1}
            placeholder="Add comment…"
            className="min-h-8 w-full resize-y bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          {draft.trim() ? (
            <div className="mt-1.5 flex justify-end">
              <Button type="button" onClick={submit} variant="primary">
                Comment
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {report.discussionPolicy === "disabled"
            ? "Discussion is closed on this report."
            : "Discussion here is limited to selected people."}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- documents */

function Documents({ report }: { report: LeadershipReport }) {
  const filed = useFiledDocuments("leadership-report", report.id);
  const primary = filed.documents.find((d) => d.id === report.primaryDocumentId);
  const related = report.relatedDocumentIds
    .map((id) => filed.documents.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d);

  const rows = [
    ...(primary ? [{ document: primary, role: "Report content" }] : []),
    ...related.map((document) => ({ document, role: "Supporting" })),
  ];

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <EmptyState icon={Users} title="No documents on this report" />
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      {rows.map(({ document, role }) => {
        const openable = !!document.openUrl;
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{document.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {[role, document.kind, document.provider].filter(Boolean).join(" · ")}
              </span>
            </span>
          </>
        );
        return (
          <li
            key={document.id}
            className={cn("border-b border-border last:border-b-0", openable && "row-quiet")}
          >
            {openable ? (
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
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- activity */

function Activity({ report }: { report: LeadershipReport }) {
  if (report.activity.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <EmptyState icon={Users} title="Nothing recorded yet" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3">
      <ActivityTimeline entries={report.activity} />
    </div>
  );
}

/* ---------------------------------------------------------------- editing */

const visibilities = config.options("reports.visibility").map((v) => v.id) as ReportVisibility[];
const policies: DiscussionPolicy[] = ["disabled", "viewers", "selected"];

/**
 * Writing and classifying the report.
 *
 * Metadata sits above the document as a compact row, never as a wall of fields
 * in front of the writing. The document itself uses the binder's existing
 * editor — headings, lists, checklists, links and all — because a second
 * editor would be a second thing to maintain and a second thing to learn.
 */
function Editor({ report }: { report: LeadershipReport }) {
  const { person } = useViewer();
  const store = useReports();
  const can = store.can(report);
  const navigate = useNavigate();
  const [focusedId, setFocusedId] = useState<string | null>(report.blocks?.[0]?.id ?? null);
  const [tagDraft, setTagDraft] = useState("");

  const blocks = report.blocks ?? [];
  const focused = blocks.find((b) => b.id === focusedId);

  const setBlocks = (next: MeetingBlock[]) => store.setBlocks(report.id, next);

  const command = (cmd: BlockCommand) => {
    if (!focused) return;
    if (cmd.kind === "set-type") {
      setBlocks(blocks.map((b) => (b.id === focused.id ? { ...b, type: cmd.type } : b)));
    }
    if (cmd.kind === "delete") setBlocks(blocks.filter((b) => b.id !== focused.id));
  };

  const done = () =>
    void navigate({
      to: "/leadership-reports/$reportId",
      params: { reportId: report.id },
      search: {},
    });

  return (
    <Page>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        <Button type="button" onClick={done} variant="primary">
          Done
        </Button>
      </div>

      <input
        value={report.title}
        onChange={(e) => store.updateReport(report.id, { title: e.target.value })}
        placeholder="What is this report?"
        aria-label="Report title"
        className="w-full rounded-md border border-transparent bg-transparent font-display text-[26px] leading-tight outline-none transition-colors hover:border-border focus:border-ring"
      />

      <MetadataRow report={report} />

      {/* Confidentiality is a first-class control, not a settings screen. */}
      <div className="mt-3 rounded-xl border border-border bg-surface-muted px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Field label="Who can read this">
            <select
              value={report.visibility}
              onChange={(e) =>
                store.updateReport(report.id, {
                  visibility: e.target.value as ReportVisibility,
                })
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none"
            >
              {visibilities.map((v) => (
                <option key={v} value={v}>
                  {visibilityLabel[v]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Discussion">
            <select
              value={report.discussionPolicy}
              onChange={(e) =>
                store.updateReport(report.id, {
                  discussionPolicy: e.target.value as DiscussionPolicy,
                })
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none"
            >
              {policies.map((p) => (
                <option key={p} value={p}>
                  {discussionPolicyLabel[p]}
                </option>
              ))}
            </select>
          </Field>

          {/* The author's mark, set with the audience. It does not change who may
              read the report; it changes how anyone else's reading is handled. */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={!!report.confidential}
              onChange={(e) => store.updateReport(report.id, { confidential: e.target.checked })}
              className="size-3.5 accent-[var(--color-primary)]"
            />
            Confidential
          </label>
          <GuideHint topic="reports.confidential" label="What does Confidential do?" />
          <p className="basis-full text-[12px] text-muted-foreground">
            {report.confidential
              ? "Marked confidential. Anyone else who may read it opens it on its own, and each opening is recorded for you to see."
              : "Mark it confidential if it must be handled that way. It does not change who may read it."}
          </p>
        </div>

        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {visibilityHint[report.visibility]}
        </p>
        {/* A draft is not shared: the audience set here reads it only once the
            author moves it on. The server refuses it to them until then. */}
        {!statusBehavior(report.status).visibleToAudience && report.visibility !== "private" ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Nobody else can read it while it is a {config.label("reports.statuses", report.status)}.
            Share or publish it when it is ready.
          </p>
        ) : null}

        {report.visibility === "restricted" || report.visibility === "shared" ? (
          <AudiencePicker report={report} />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {report.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[12px]"
          >
            #{tag}
            <button
              type="button"
              onClick={() =>
                store.updateReport(report.id, { tags: report.tags.filter((t) => t !== tag) })
              }
              aria-label={`Remove #${tag}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const tag = tagDraft.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
            if (tag && !report.tags.includes(tag)) {
              store.updateReport(report.id, { tags: [...report.tags, tag] });
            }
            setTagDraft("");
          }}
          placeholder="+ tag"
          aria-label="Add a tag"
          className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[12px] outline-none transition-colors hover:border-border focus:w-28 focus:border-ring"
        />
      </div>

      {report.contentSource === "native" ? (
        <div className="mt-4">
          <MeetingToolbar
            {...(focused ? { activeType: focused.type } : {})}
            onCommand={command}
            canMakeTask={false}
            showTasks={false}
          />
          <MeetingDocument
            blocks={blocks}
            focusedId={focusedId}
            onFocus={setFocusedId}
            onChange={(id, html) =>
              setBlocks(blocks.map((b) => (b.id === id ? { ...b, html: sanitizeInline(html) } : b)))
            }
            onEnter={(afterId) => {
              const next = emptyBlock("paragraph");
              const at = blocks.findIndex((b) => b.id === afterId);
              setBlocks([...blocks.slice(0, at + 1), next, ...blocks.slice(at + 1)]);
              setFocusedId(next.id);
            }}
            onRemove={(id) => setBlocks(blocks.filter((b) => b.id !== id))}
            onToggleCheck={(id) =>
              setBlocks(blocks.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)))
            }
          />
        </div>
      ) : (
        <LinkedDocumentPicker report={report} />
      )}

      {statusBehavior(report.status).editable ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-[12px] text-muted-foreground">
            {config.label("reports.statuses", report.status)} · saved as you type. Moving it on
            makes the content the submitted record.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <DeleteReport report={report} />
            <StatusActions report={report} can={can} onMoved={done} />
          </div>
        </div>
      ) : null}
    </Page>
  );
}

/**
 * Type, about and related — all free entry with structured suggestions.
 *
 * None of these is a closed list. The church may need a report type nobody
 * anticipated, may write about a group rather than a person, and may relate a
 * report to something this application does not model. Suggestions make the
 * common case fast; typing anything else is always allowed and keeps working.
 */
function MetadataRow({ report }: { report: LeadershipReport }) {
  const { ministries, people, personById } = useOrganization();
  const store = useReports();

  const typeText = reportTypeLabel(report.reportType);
  const subjectText = report.subjectId
    ? (personById(report.subjectId)?.name ?? "")
    : (report.subjectText ?? "");
  const relatedMinistry = ministries.find(
    (m) => m.id === report.links.find((l) => l.kind === "ministry")?.id,
  );
  const relatedText = relatedMinistry?.name ?? report.relatedText ?? "";

  /* A ministry report offers ministries first; other types offer them too, but
     below whatever else is relevant. Suggestions follow the type. */
  const wantsMinistry = relatedKindFor(report.reportType) === "ministry";
  const relatedSuggestions: Suggestion[] = ministries.map((m) => ({
    id: m.id,
    label: m.name,
    group: wantsMinistry ? "Ministries" : "Ministries and teams",
  }));

  const peopleSuggestions: Suggestion[] = people
    .filter((p) => p.id !== report.authorId)
    .map((p) => ({ id: p.id, label: p.name, hint: p.role, group: "People" }));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
      <Field label="Type">
        <Combobox
          label="Report type"
          value={typeText}
          placeholder="Any type"
          width="w-56"
          suggestions={suggestReportTypes("").map((known) => ({
            id: known.id,
            label: known.label,
            ...(known.hint ? { hint: known.hint } : {}),
          }))}
          onChange={(text, id) => applyType(store, report, text, id)}
        />
      </Field>

      <Field label={subjectMattersFor(report.reportType) ? "About" : "About (optional)"}>
        <Combobox
          label="Who or what this report is about"
          value={subjectText}
          placeholder={subjectMattersFor(report.reportType) ? "Who is this about?" : "Optional"}
          width="w-48"
          suggestions={peopleSuggestions}
          onChange={(text, id) =>
            store.updateReport(report.id, {
              subjectId: id,
              subjectText: id ? undefined : text || undefined,
            })
          }
        />
      </Field>

      <Field label="Related to">
        <Combobox
          label="What this report relates to"
          value={relatedText}
          placeholder="Optional"
          width="w-48"
          suggestions={relatedSuggestions}
          onChange={(text, id) =>
            store.updateReport(report.id, {
              links: [
                ...report.links.filter((l) => l.kind !== "ministry"),
                ...(id ? [{ kind: "ministry" as const, id }] : []),
              ],
              relatedText: id ? undefined : text || undefined,
            })
          }
        />
      </Field>

      <Field label="Period">
        <input
          value={report.reportingPeriod ?? ""}
          onChange={(e) =>
            store.updateReport(report.id, { reportingPeriod: e.target.value || undefined })
          }
          placeholder="September 2026"
          className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring"
        />
      </Field>
    </div>
  );
}

/**
 * Changing the type.
 *
 * A known type stores its id so its label, suggestions and form follow; an
 * unknown one stores exactly what was typed. Where the new type has a defined
 * form and the document is still empty, the form is applied — but a report
 * that has been written in is never overwritten. Offering the form is the
 * editor's job; destroying somebody's writing is not.
 */
function applyType(
  store: ReturnType<typeof useReports>,
  report: LeadershipReport,
  text: string,
  id?: string,
) {
  const next = id ?? text.trim();
  if (!next || next === report.reportType) return;

  store.updateReport(report.id, { reportType: next });

  const template = templateFor(next);
  const empty = (report.blocks ?? []).every((b) => !b.html.trim());
  if (template && empty && report.contentSource === "native") {
    store.setBlocks(report.id, template);
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Naming who may read a restricted report, beside the choice that needs it. */
function AudiencePicker({ report }: { report: LeadershipReport }) {
  const { people } = useOrganization();
  const store = useReports();
  const candidates = people.filter((p) => p.id !== report.authorId && p.id !== report.subjectId);

  return (
    <div className="mt-2.5">
      <p className="text-[12px] font-medium text-muted-foreground">Also visible to</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {candidates.map((p) => {
          const on = report.audienceIds.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                store.updateReport(report.id, {
                  audienceIds: on
                    ? report.audienceIds.filter((id) => id !== p.id)
                    : [...report.audienceIds, p.id],
                })
              }
              aria-pressed={on}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px] transition-colors",
                on
                  ? "border-primary/30 bg-area-soft font-medium text-area-ink"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Choosing the document that holds a linked report's content. */
function LinkedDocumentPicker({ report }: { report: LeadershipReport }) {
  const store = useReports();
  /* Every document this viewer may see in the registry. The list used to be
     filtered out of a fixture array, which offered documents that existed
     nowhere. */
  const registry = useResourceSearch({ page: 1 });
  const options = registry.page.items;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface shadow-card px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">Report content</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
        The writing lives in a document. The binder keeps the report — its title, author, audience
        and discussion.
      </p>
      <select
        value={report.primaryDocumentId ?? ""}
        onChange={(e) =>
          store.updateReport(report.id, { primaryDocumentId: e.target.value || undefined })
        }
        className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none"
      >
        <option value="">Choose a document</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ print */

/**
 * The binder page.
 *
 * Metadata a reader of paper needs, the content, and nothing else. A
 * confidential report says so on the page, because a printed sheet leaves the
 * application's access controls behind entirely.
 */
function PrintSheet({ report }: { report: LeadershipReport }) {
  const { personById } = useOrganization();
  const filed = useFiledDocuments("leadership-report", report.id);
  const document = filed.documents.find((d) => d.id === report.primaryDocumentId);

  return (
    <Page>
      <div data-print="hide" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/leadership-reports/$reportId"
          params={{ reportId: report.id }}
          search={{}}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Back to the report
        </Link>
        <Button type="button" onClick={() => window.print()} variant="primary">
          <Printer className="size-3.5" aria-hidden />
          Print
        </Button>
      </div>

      <article
        data-print="sheet"
        className="mx-auto max-w-[820px] rounded-2xl border border-border bg-surface shadow-card px-6 py-6"
      >
        <header data-print="section" className="border-b border-border pb-3">
          {isRestricted(report) ? (
            <p className="mb-2 inline-flex items-center gap-1.5 border border-status-overdue/40 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-status-overdue">
              <Lock className="size-3" aria-hidden />
              {visibilityLabel[report.visibility]} — handle accordingly
            </p>
          ) : null}

          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {reportTypeLabel(report.reportType)}
          </p>
          <h1 className="mt-1 font-display text-[22px] leading-tight">
            {report.title || "Untitled report"}
          </h1>

          <p className="mt-2 text-[13px]">
            Author: {personById(report.authorId)?.name ?? "Unknown"}
          </p>
          {report.subjectId ? (
            <p className="text-[13px]">
              Subject: {personById(report.subjectId)?.name ?? "Unknown"}
            </p>
          ) : null}
          {report.reportingPeriod ? (
            <p className="text-[13px]">Period: {report.reportingPeriod}</p>
          ) : null}
          <p className="text-[13px]">
            Date: {format(fromISO(report.updatedAt.slice(0, 10)), "d MMMM yyyy")}
          </p>
        </header>

        <div data-print="section" className="mt-4">
          {report.contentSource === "linked-document" ? (
            <p className="text-[14px] leading-relaxed">
              The content of this report is kept in {document?.title ?? "a separate document"}.
            </p>
          ) : (
            <MeetingDocument blocks={report.blocks ?? []} readOnly />
          )}
        </div>
      </article>
    </Page>
  );
}
