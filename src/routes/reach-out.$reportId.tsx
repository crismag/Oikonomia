import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, Pencil, Printer, Trash2 } from "lucide-react";

import { CalendarError } from "@/lib/calendar-client";
import { useConfirm } from "@/config/messages/handlers";

import { Button, buttonVariants } from "@/components/ui/button";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { Page } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { useReachOut } from "@/components/oikonomia/reach-out-provider";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { AskedOfYou } from "@/components/oikonomia/put-on-week";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  canContribute,
  canDeleteReport,
  commentsInOrder,
  displayTitle,
  contributorsOf,
  laterContributors,
  reportById,
  reportDateLabel,
} from "@/domain/reach-out";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import type { ReachOutReport } from "@/domain/types";

export const Route = createFileRoute("/reach-out/$reportId")({
  validateSearch: (search: Record<string, unknown>): { edit?: true; print?: true } => ({
    ...(search["edit"] ? { edit: true as const } : {}),
    ...(search["print"] ? { print: true as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Reach-Out report — Oikonomia" }] }),
  component: ReportPage,
});

/**
 * One Reach-Out report.
 *
 * Reading, writing and discussing the same document. Nothing classifies what
 * the report says: the leader wrote about a family, a park, a phone call or a
 * street, and the binder simply keeps it.
 */
function ReportPage() {
  const { personById } = useOrganization();
  const { reportId } = Route.useParams();
  const { edit, print } = Route.useSearch();
  const { person } = useViewer();
  const store = useReachOut();

  /* The provider fetches whichever report the URL names, so a link to one that
     is not on the list's current page still opens. */
  const { select } = store;
  useEffect(() => select(reportId), [reportId, select]);

  const report = reportById(store.reports, reportId);

  /* Absent is not the same as missing while it is still loading — and until
     the store has been asked for this report, it has not started loading it.
     A report opened straight after it was created is on no page of the list. */
  if (!report && (store.status === "loading" || store.selectedId !== reportId)) {
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
          Your reports are safe. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }
  if (!report) throw notFound();

  const canEdit = canContribute(report, person.id);

  if (print) return <PrintSheet report={report} />;
  if (edit && canEdit) return <Editor report={report} />;

  return <Reading report={report} canEdit={canEdit} />;
}

/* ---------------------------------------------------------------- reading */

function Reading({ report, canEdit }: { report: ReachOutReport; canEdit: boolean }) {
  return (
    <Page>
      <BackLink />

      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] leading-tight">{displayTitle(report)}</h1>
          <Byline report={report} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to="/reach-out/$reportId"
            params={{ reportId: report.id }}
            search={{ print: true as const }}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Printer className="size-3.5" aria-hidden />
            Printable view
          </Link>
          {canEdit ? (
            <Link
              to="/reach-out/$reportId"
              params={{ reportId: report.id }}
              search={{ edit: true as const }}
              className={buttonVariants({ variant: "primary" })}
            >
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Link>
          ) : null}
        </div>
      </header>

      <article className="rounded-2xl border border-border bg-surface shadow-card px-5 py-5">
        {report.content.trim() ? (
          <Body content={report.content} />
        ) : (
          <p className="text-[14px] italic text-muted-foreground">
            Nothing written yet.
            {canEdit ? " Open the editor to write the report." : ""}
          </p>
        )}
      </article>

      <div className="mt-4 space-y-3">
        <AskedOfYou sourceType="reach-out-report" sourceId={report.id} />
        <EscalationControl
          sourceType="reach-out-report"
          sourceId={report.id}
          contextLabel={report.title || "Reach-Out report"}
        />
      </div>

      <Comments report={report} />
    </Page>
  );
}

/**
 * Who this account came from.
 *
 * The first author is named because it is useful to know whose account this is.
 * Leaders who added to it afterwards are named beside them — the report belongs
 * to the work, not to whoever typed first.
 */
function Byline({ report }: { report: ReachOutReport }) {
  const others = laterContributors(report);

  return (
    <p className="mt-1 text-[13px] text-muted-foreground">
      {reportDateLabel(report.reportDate)} · Reported by <PersonName personId={report.authorId} />
      {others.length > 0 ? (
        <>
          {" · with "}
          {others.map((id, i) => (
            <span key={id}>
              {i > 0 ? " & " : ""}
              <PersonName personId={id} />
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

/**
 * The report as written.
 *
 * Blank lines become paragraphs and nothing else is interpreted — the leader is
 * writing prose, not markup, and a stray character should never change how the
 * report reads.
 */
function Body({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).filter((block) => block.trim());

  return (
    <div className="space-y-3">
      {paragraphs.map((block, i) => (
        <p key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {block.trim()}
        </p>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- comments */

/**
 * Discussion around the report.
 *
 * Visually secondary to the report, and it never touches the report body — a
 * reviewer responds without editing the leader's words.
 */
function Comments({ report }: { report: ReachOutReport }) {
  const { personById } = useOrganization();
  const { person } = useViewer();
  const store = useReachOut();
  const [draft, setDraft] = useState("");

  const comments = commentsInOrder(report);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    store.addComment(report.id, person.id, body);
    setDraft("");
  };

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-medium text-muted-foreground">Comments</h2>

      {comments.length > 0 ? (
        <ul className="mt-2 space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <PersonAvatar personId={comment.authorId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-muted-foreground">
                  {personById(comment.authorId)?.name ?? "Unknown"}
                  {comment.at.includes("T")
                    ? ` · ${format(new Date(comment.at), "d MMM, h:mm a")}`
                    : ""}
                </p>
                <p className="text-[14px] leading-relaxed">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 rounded-2xl border border-border bg-surface shadow-card px-3 py-2.5">
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
    </section>
  );
}

/* ---------------------------------------------------------------- editing */

/**
 * Writing the report.
 *
 * Three things: when it was, what to call it, and what happened. The leader
 * should be thinking "what do I need to report?", never "which fields does
 * this expect me to complete?".
 */
function Editor({ report }: { report: ReachOutReport }) {
  const { person } = useViewer();
  const store = useReachOut();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const conflict = store.saveError instanceof CalendarError && store.saveError.code === "conflict";

  /* Typing is saved on a debounce, so leaving is where anything still pending
     has to land. `flush` says whether it did; if it did not, this stays on the
     editor so what was refused is seen rather than walked away from. */
  const done = () => {
    void store.flush().then((landed) => {
      if (!landed) return;
      void navigate({
        to: "/reach-out/$reportId",
        params: { reportId: report.id },
        search: {},
      });
    });
  };

  /* An untouched report was created by pressing Add; leaving should not litter
     the list with an empty one, so discarding is offered plainly. */
  const untouched = !report.title.trim() && !report.content.trim();

  const discard = async () => {
    /* An untouched report has nothing in it to lose, so discarding it is not a
       destructive act and is not worth a dialog. One that has been written in
       is: there is no undo and no trash. */
    const named = report.title.trim();
    if (
      !untouched &&
      !(await confirm(
        named ? "reports.delete.confirm" : "reports.delete.confirm.untitled",
        named ? { title: named } : undefined,
      ))
    ) {
      return;
    }
    store.removeReport(report.id);
    void navigate({ to: "/reach-out", search: {} });
  };

  return (
    <Page>
      <BackLink />

      <h1 className="mb-4 font-display text-[26px] leading-tight">Reach-Out report</h1>

      {conflict ? (
        /* Shared work: the other leader's writing is on the server, this
           leader's is still on screen. Neither is thrown away without them
           saying so. */
        <div
          role="alert"
          className="mb-3 rounded-lg border border-status-overdue/40 bg-status-overdue/5 px-4 py-3 text-[13px] leading-relaxed"
        >
          <p className="font-medium">Another leader added to this report while you were writing.</p>
          <p className="mt-1 text-muted-foreground">
            What you have typed is still here and has not been saved. Open their version to see what
            they wrote — you will need to add your part to it again.
          </p>
          <button
            type="button"
            onClick={() => {
              /* Straight to reading, not through `done`: there is nothing left
                 to save, and flushing here would re-send the draft that was
                 just thrown away. */
              store.discardDraft(report.id);
              void navigate({
                to: "/reach-out/$reportId",
                params: { reportId: report.id },
                search: {},
              });
            }}
            className="mt-2 font-medium underline underline-offset-2"
          >
            Open their version
          </button>
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border border-border bg-surface shadow-card px-5 py-5">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Date</span>
          <input
            type="date"
            value={report.reportDate}
            onChange={(e) =>
              store.updateReport(report.id, { reportDate: e.target.value }, person.id)
            }
            className="rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-[14px] outline-none focus:border-border-strong"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Title</span>
          <input
            value={report.title}
            onChange={(e) => store.updateReport(report.id, { title: e.target.value }, person.id)}
            placeholder="Weekly reach-out"
            className="w-full rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Report</span>
          <textarea
            value={report.content}
            onChange={(e) => store.updateReport(report.id, { content: e.target.value }, person.id)}
            rows={16}
            placeholder="Write the Reach-Out report…"
            className="w-full resize-y rounded-md border border-border bg-surface-muted px-3 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* Anyone may continue a report; only whoever started it may remove
            it. Offering Delete to anyone else would end in a refusal. */}
        {canDeleteReport(report, person.id) ? (
          <button
            type="button"
            onClick={() => void discard()}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {untouched ? "Discard" : "Delete report"}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          <SaveState state={store.saveState} conflict={conflict} />
          <Button type="button" onClick={done} variant="primary">
            Save report
          </Button>
        </div>
      </div>
    </Page>
  );
}

/** What the binder has, in words rather than a spinner. */
function SaveState({
  state,
  conflict,
}: {
  state: ReturnType<typeof useReachOut>["saveState"];
  conflict: boolean;
}) {
  if (conflict) return null;
  const said =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Not saved yet — still trying"
          : null;
  if (!said) return null;
  return (
    <span aria-live="polite" className="text-[12px] text-muted-foreground">
      {said}
    </span>
  );
}

function BackLink() {
  return (
    <Link
      to="/reach-out"
      search={{}}
      className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      Reach-Out reports
    </Link>
  );
}

/* ------------------------------------------------------------------ print */

/**
 * The binder page.
 *
 * A report, and nothing else — no controls, no cards, no counts. The Documents
 * side of Reach-Out is a working area and has no business on paper.
 */
function PrintSheet({ report }: { report: ReachOutReport }) {
  const { personById } = useOrganization();
  return (
    <Page>
      <div data-print="hide" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/reach-out/$reportId"
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
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Reach-Out
          </p>
          <p className="mt-2 text-[13px]">Date: {reportDateLabel(report.reportDate)}</p>
          <p className="text-[13px]">Leader: {personById(report.authorId)?.name ?? "Unknown"}</p>
          <h1 className="mt-3 font-display text-[22px] leading-tight">{displayTitle(report)}</h1>
        </header>

        <div data-print="section" className="mt-4">
          <Body content={report.content} />
        </div>
      </article>
    </Page>
  );
}
