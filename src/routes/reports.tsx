import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { FileText } from "lucide-react";

import { AccessNotice } from "@/components/oikonomia/access";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { GoalProgressForReport } from "@/components/oikonomia/goal-progress";
import { FilterChip, ListToolbar, ResultCount } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { useReadState } from "@/components/oikonomia/escalation-provider";
import { useViewer } from "@/domain/session";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports to you — Oikonomia" },
      {
        name: "description",
        content: "Reports published to you and by you, with what you have already read.",
      },
    ],
  }),
  component: ReportsPage,
});

/**
 * The reports library.
 *
 * **Not a queue.** This page used to be called "Reports to Review", and the
 * name was the problem: a submitted report is information — published to the
 * people it is for, new until they read it, and then read. Nobody owes it
 * anything. A leader who wants to know what is being asked of them looks at
 * the Leadership Inbox, where the asks are.
 *
 * So what is filtered here is **new and read**, not review states, and a
 * report that has been formally reviewed is an unusual one that says so.
 */
function ReportsPage() {
  const { person } = useViewer();
  const readState = useReadState();
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState<"all" | "new" | "read">("all");

  /*
   * Already withheld by the service: a report closed to this viewer is not in
   * the browser, and one whose sections are stricter than itself arrived with
   * those sections removed.
   */
  const store = useWorkList({ kind: "report" as const });
  const readable = store.work.map((work) => ({ work }));
  const withheld = store.withheld;

  const isNew = (id: string) => readState.isNew("work", id);

  const q = query.trim().toLowerCase();
  const visible = readable.filter(({ work }) => {
    if (reading === "new" && !isNew(work.id)) return false;
    if (reading === "read" && isNew(work.id)) return false;
    if (!q) return true;
    return work.subject.toLowerCase().includes(q) || work.contextLabel.toLowerCase().includes(q);
  });

  const newCount = readable.filter(({ work }) => isNew(work.id)).length;

  const mine = readable.filter(({ work }) => work.ownerId === person.id);

  if (store.status === "loading") {
    return (
      <Page>
        <ListSkeleton rows={5} />
      </Page>
    );
  }
  if (store.status === "error") {
    return (
      <Page>
        <ErrorState title="Reports could not be loaded" onRetry={store.retry}>
          Nothing is lost. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Reports to you"
        description="Work reports published to you and by you. This is not Leadership Reports — those are the confidential accounts you write in your binder. A report here is information: it is here to read, and it asks nothing of you unless its author said so."
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
        <GoalProgressForReport year={new Date().getFullYear()} />
      </div>

      {mine.length > 0 ? (
        <div className="mb-5">
          <Section title="Mine" meta={`${mine.length}`}>
            <ul className="divide-y divide-border">
              {mine.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  <Link
                    to="/work/$workId"
                    params={{ workId: work.id }}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px]">{work.subject}</span>
                    <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:block">
                      {work.period}
                    </span>
                    <StatusBadge status={work.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search reports">
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

      <ResultCount shown={visible.length} total={readable.length} noun="reports" />

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {visible.length > 0 ? (
          <ul className="divide-y divide-border">
            {visible.map(({ work }) => (
              <li key={work.id} className="row-quiet">
                <Link
                  to="/work/$workId"
                  params={{ workId: work.id }}
                  onClick={() => readState.markRead("work", work.id)}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <PersonAvatar personId={work.ownerId} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{work.subject}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      <PersonName personId={work.ownerId} /> · {work.contextLabel}
                      {work.period ? ` · ${work.period}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {isNew(work.id) ? "New" : "Read"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FileText} title="No reports match those filters">
            Reports published to you collect here to read. They do not need processing.
          </EmptyState>
        )}
      </div>
    </Page>
  );
}
