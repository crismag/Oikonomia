import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Gavel, Inbox as InboxIcon } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { EscalationRow } from "@/components/oikonomia/escalation-row";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { useLeadershipInbox, useReadState } from "@/components/oikonomia/escalation-provider";
import { useReports } from "@/components/oikonomia/report-provider";
import { cn } from "@/lib/utils";
import { toISO } from "@/domain/schedule";
import { text } from "@/config";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Leadership Inbox — Oikonomia" },
      {
        name: "description",
        content: "What leaders have asked of you, and what has come in since you last looked.",
      },
    ],
  }),
  component: InboxPage,
});

type Tab = "all" | "new" | "attention" | "actions" | "approvals";

/**
 * The Leadership Inbox.
 *
 * This page used to be a review queue: everything routed to a leader, with
 * *Done* meaning "out of my way". Forty leaders reporting weekly filled it
 * with forty items, none of which had asked for anything.
 *
 * It now answers the question the product is built around — **what actually
 * needs me?** — and answers it with the things people explicitly asked for:
 * a decision, a task, or a look. Everything else is information, listed
 * underneath, marked new until it is read, and asking nothing of anybody.
 *
 * The ordering is the claim: decisions, then work, then things to consider,
 * then what happened. Reports are last on purpose.
 */
function InboxPage() {
  const inbox = useLeadershipInbox();
  const reports = useReports();
  const readState = useReadState();
  const [tab, setTab] = useState<Tab>("all");
  const today = toISO(new Date());

  if (inbox.status === "loading") {
    return (
      <Page>
        <ListSkeleton rows={5} />
      </Page>
    );
  }
  if (inbox.status === "error") {
    return (
      <Page>
        <ErrorState title="Your inbox could not be loaded" onRetry={inbox.retry}>
          Nothing is lost. This is a problem reaching the server.
        </ErrorState>
      </Page>
    );
  }

  /* Information, newest first. Not obligations — they are listed above. */
  const recent = [...reports.visible]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 12);
  const unread = recent.filter((report) => readState.isNew("leadership-report", report.id));

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: inbox.mine.length + inbox.flagged.length + unread.length },
    { id: "new", label: "New", count: unread.length },
    {
      id: "attention",
      label: "Attention",
      count: inbox.attention.length + inbox.flagged.length,
    },
    { id: "actions", label: "Actions", count: inbox.actions.length },
    { id: "approvals", label: "Approvals", count: inbox.approvals.length },
  ];

  const showEscalations =
    tab === "all" || tab === "attention" || tab === "actions" || tab === "approvals";
  const groups = [
    {
      id: "approvals" as const,
      title: "Approval requested",
      icon: Gavel,
      items: inbox.approvals,
      empty: text("empty.approvals"),
    },
    {
      id: "actions" as const,
      title: "Action requested",
      icon: CheckCircle2,
      items: inbox.actions,
      empty: text("empty.actions"),
    },
    {
      id: "attention" as const,
      title: "Needs attention",
      icon: AlertCircle,
      items: inbox.attention,
      empty: text("empty.attention"),
    },
  ].filter((group) => tab === "all" || tab === group.id);

  return (
    <Page>
      <PageHeader
        title="Leadership Inbox"
        description="What leaders have asked of you, what is flagged as needing a look, and what has come in since you last looked. Reports do not become work simply by being submitted. An action can be put on your week from here."
      />

      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                "inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors",
                tab === t.id
                  ? "border-primary/40 bg-accent-soft text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
              {t.count > 0 ? (
                <span className="text-[12px] tabular-nums text-muted-foreground">{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {showEscalations ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <Section
              key={group.id}
              title={group.title}
              meta={group.items.length > 0 ? `${group.items.length}` : undefined}
            >
              {group.items.length > 0 ? (
                <ul className="divide-y divide-border">
                  {group.items.map((item) => (
                    <EscalationRow key={item.id} item={item} today={today} />
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-4 text-[13px] text-muted-foreground">{group.empty}</p>
              )}
            </Section>
          ))}
        </div>
      ) : null}

      {(tab === "all" || tab === "attention") && inbox.flagged.length > 0 ? (
        <div className={cn(showEscalations && "mt-4")}>
          <Section title="Flagged by their category" meta={`${inbox.flagged.length}`}>
            {/*
             * Records whose own nature asks to be looked at — a concern, a
             * follow-up — rather than a request addressed to this leader.
             * Each row opens the report itself: this is a projection, and
             * there is no second copy of anything to keep in step.
             */}
            <ul className="divide-y divide-border">
              {inbox.flagged.map((item) => (
                <li key={item.id} className="row-quiet">
                  <Link to={item.path} className="flex items-start gap-3 px-4 py-3">
                    <AlertCircle
                      className="mt-0.5 size-4 shrink-0 text-status-waiting"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{item.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {item.categoryLabel}
                        {item.contextLabel ? ` · ${item.contextLabel}` : ""} ·{" "}
                        <PersonName personId={item.authorId} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}

      {tab === "all" || tab === "new" ? (
        <div className={cn(showEscalations && "mt-4")}>
          <Section
            title={tab === "new" ? "New reports" : "Recent reports"}
            meta={unread.length > 0 ? `${unread.length} new` : undefined}
          >
            {(tab === "new" ? unread : recent).length > 0 ? (
              <ul className="divide-y divide-border">
                {(tab === "new" ? unread : recent).map((report) => {
                  const isNew = readState.isNew("leadership-report", report.id);
                  return (
                    <li key={report.id} className="row-quiet">
                      <Link
                        to="/leadership-reports/$reportId"
                        params={{ reportId: report.id }}
                        search={{}}
                        onClick={() => readState.markRead("leadership-report", report.id)}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            isNew ? "bg-primary" : "bg-transparent",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn("block truncate text-[14px]", isNew && "font-medium")}
                          >
                            {report.title || "Untitled report"}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            <PersonName personId={report.authorId} />
                            {report.reportingPeriod ? ` · ${report.reportingPeriod}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {isNew ? "New" : "Read"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={tab === "new" ? InboxIcon : FileText}
                title={tab === "new" ? text("empty.newReports") : "No reports yet"}
              >
                {tab === "new"
                  ? undefined
                  : "Reports your leaders publish appear here to read, not to process."}
              </EmptyState>
            )}
          </Section>
        </div>
      ) : null}

      {inbox.raisedByMe.length > 0 ? (
        <div className="mt-4">
          <Section title="What you are waiting on" meta={`${inbox.raisedByMe.length}`}>
            <ul className="divide-y divide-border">
              {inbox.raisedByMe.map((item) => (
                <EscalationRow key={item.id} item={item} today={today} />
              ))}
            </ul>
          </Section>
        </div>
      ) : null}
    </Page>
  );
}
