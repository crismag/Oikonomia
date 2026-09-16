import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, FileText, NotebookPen } from "lucide-react";

import { AccessNotice } from "@/components/oikonomia/access";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { GoalsByWhose } from "@/components/oikonomia/goals-by-whose";
import { FilterChip, ListToolbar, ResultCount } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { useReadState } from "@/components/oikonomia/escalation-provider";
import { useReports } from "@/components/oikonomia/report-provider";
import { reportStatusLabel, reportTypeLabel, reportsToYou } from "@/domain/leadership-report";
import { cn } from "@/lib/utils";
import { useViewer } from "@/domain/session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports to you — Oikonomia" },
      {
        name: "description",
        content:
          "Reports that reached you from other leaders, a way back to your own, and what you have already read.",
      },
    ],
  }),
  component: ReportsPage,
});

/**
 * Reports to you.
 *
 * **Not a queue.** This page used to be called "Reports to Review", and the
 * name was the problem: a submitted report is information — published to the
 * people it is for, new until they read it, and then read. Nobody owes it
 * anything. A leader who wants to know what is being asked of them looks at
 * the Leadership Inbox, where the asks are.
 *
 * It used to list only work-kind reports, which a church that writes
 * Leadership Reports may never have — so the page was empty for a leader with
 * dozens of reports shared with them. It now shows, in order: a shortcut to
 * the leader's own Leadership Reports; the Leadership Reports that reached them
 * from others (by name, through a group, or by audience); the goals behind
 * their people's work; and work reports, when there are any. The two report
 * systems stay separate records — each row opens the record itself.
 *
 * What is filtered is **new and read**, never review states.
 */
function ReportsPage() {
  const { person } = useViewer();
  const readState = useReadState();
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState<"all" | "new" | "read">("all");

  /*
   * Already withheld by the services: a report closed to this viewer is not in
   * the browser, and one whose sections are stricter than itself arrived with
   * those sections removed.
   */
  const store = useWorkList({ kind: "report" as const });
  const reports = useReports();
  const work = store.work;

  const { yours, shared } = reportsToYou(reports.visible, person.id);
  const isNew = (id: string) => readState.isNew("leadership-report", id);

  const q = query.trim().toLowerCase();
  const sharedVisible = shared.filter((report) => {
    if (reading === "new" && !isNew(report.id)) return false;
    if (reading === "read" && isNew(report.id)) return false;
    if (!q) return true;
    return (
      report.title.toLowerCase().includes(q) ||
      (report.reportingPeriod ?? "").toLowerCase().includes(q)
    );
  });
  const newCount = shared.filter((report) => isNew(report.id)).length;
  const withheld = store.withheld + reports.withheld;

  if (store.status === "loading" || reports.status === "loading") {
    return (
      <Page>
        <ListSkeleton rows={5} />
      </Page>
    );
  }
  if (store.status === "error" || reports.status === "error") {
    return (
      <Page>
        <ErrorState
          title="Reports could not be loaded"
          onRetry={() => {
            store.retry();
            reports.retry();
          }}
        >
          Nothing is lost. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Reports to you"
        description="Reports that reached you from other leaders, and a way back to your own. A report here is information: it is here to read, and it asks nothing of you unless its author said so."
      />

      {withheld > 0 ? (
        <div className="mb-4">
          <AccessNotice
            decision={{
              level: "limited",
              rationale: `${withheld} ${withheld === 1 ? "report is" : "reports are"} closed to you and not listed`,
              restrictedSections: [],
            }}
          />
        </div>
      ) : null}

      <div className="mb-5">
        <Section
          title="Your reports"
          meta={yours.length > 0 ? `${yours.length}` : undefined}
          action={
            <Link
              to="/leadership-reports"
              search={{}}
              className="inline-flex min-h-6 items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              All your reports
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {yours.length > 0 ? (
            <ul className="divide-y divide-border">
              {yours.slice(0, YOURS_SHOWN).map((report) => (
                <li key={report.id} className="row-quiet">
                  <Link
                    to="/leadership-reports/$reportId"
                    params={{ reportId: report.id }}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">
                        {report.title || "Untitled report"}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {reportTypeLabel(report.reportType)}
                        {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {reportStatusLabel[report.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={NotebookPen} title="You have not written a report yet">
              Your Leadership Reports are written in your binder, under Leadership Reports.
            </EmptyState>
          )}
        </Section>
      </div>

      <div className="mb-5">
        <Section
          title="Shared with you"
          meta={shared.length > 0 ? `${shared.length}` : undefined}
          action={
            shared.length > SHARED_SHOWN ? (
              <Link
                to="/leadership-reports"
                search={{ tab: "shared" }}
                className="inline-flex min-h-6 items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
              >
                All shared with you
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : undefined
          }
        >
          {shared.length > 0 ? (
            <>
              <div className="border-b border-border px-4 py-2">
                <ListToolbar query={query} onQuery={setQuery} placeholder="Search shared reports">
                  {/* Reading states, not review states: whether you have opened it is
                      the useful question about a report you were sent. */}
                  <FilterChip active={reading === "all"} onClick={() => setReading("all")}>
                    All
                  </FilterChip>
                  <FilterChip
                    active={reading === "new"}
                    onClick={() => setReading(reading === "new" ? "all" : "new")}
                    count={newCount}
                  >
                    New
                  </FilterChip>
                  <FilterChip
                    active={reading === "read"}
                    onClick={() => setReading(reading === "read" ? "all" : "read")}
                  >
                    Read
                  </FilterChip>
                </ListToolbar>
              </div>
              {sharedVisible.length > 0 ? (
                <ul className="divide-y divide-border">
                  {sharedVisible.slice(0, SHARED_SHOWN).map((report) => (
                    <li key={report.id} className="row-quiet">
                      <Link
                        to="/leadership-reports/$reportId"
                        params={{ reportId: report.id }}
                        onClick={() => readState.markRead("leadership-report", report.id)}
                        className="flex items-start gap-3 px-4 py-3"
                      >
                        <PersonAvatar personId={report.authorId} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-[14px]",
                              isNew(report.id) && "font-medium",
                            )}
                          >
                            {report.title || "Untitled report"}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {report.confidential ? (
                              <span className="text-status-overdue">Confidential · </span>
                            ) : null}
                            <PersonName personId={report.authorId} /> ·{" "}
                            {reportTypeLabel(report.reportType)}
                            {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {isNew(report.id) ? "New" : "Read"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No shared reports match those filters.
                </p>
              )}
              {sharedVisible.length > SHARED_SHOWN ? (
                <p className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                  Showing the newest {SHARED_SHOWN} of {sharedVisible.length}.{" "}
                  <Link
                    to="/leadership-reports"
                    search={{ tab: "shared" }}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    See them all in Leadership Reports
                  </Link>
                  .
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState icon={FileText} title="Nothing has been shared with you yet">
              A report reaches you when its author names you, addresses a group you belong to, or
              shares it with leadership you are part of.
            </EmptyState>
          )}
        </Section>
      </div>

      <div className="mb-5">
        <GoalsByWhose year={new Date().getFullYear()} />
      </div>

      {work.length > 0 ? (
        <Section title="Work reports" meta={`${work.length}`}>
          <ul className="divide-y divide-border">
            {work.map((item) => (
              <li key={item.id} className="row-quiet">
                <Link
                  to="/work/$workId"
                  params={{ workId: item.id }}
                  onClick={() => readState.markRead("work", item.id)}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <PersonAvatar personId={item.ownerId} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{item.subject}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      <PersonName personId={item.ownerId} /> · {item.contextLabel}
                      {item.period ? ` · ${item.period}` : ""}
                    </span>
                  </span>
                  {item.ownerId === person.id ? (
                    <StatusBadge status={item.status} />
                  ) : (
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {readState.isNew("work", item.id) ? "New" : "Read"}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}

/** Enough to get back to what you were writing; the library has the rest. */
const YOURS_SHOWN = 5;
/** The newest shared reports; Leadership Reports lists and filters them all. */
const SHARED_SHOWN = 25;
