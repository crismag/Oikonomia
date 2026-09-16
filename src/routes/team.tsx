import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Users } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { ConsistencyGrid, TrendChart } from "@/components/oikonomia/consistency";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { LeaderMatrix, LeaderQuickView } from "@/components/oikonomia/leader-matrix";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { AreaBar, MetricCard } from "@/components/oikonomia/team-metrics";
import { Section } from "@/components/oikonomia/section";
import { StatusChip, StatusDot } from "@/components/oikonomia/semantic-status";
import { fetchTeamOverview, type TeamOverview } from "@/lib/team-overview-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import type { ObligationStatus } from "@/domain/obligations";
import { attentionReasonLabel, completion, overallLabel } from "@/domain/team-overview";
import { toISO } from "@/domain/schedule";

type Filter = ObligationStatus | "all";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team Overview — Oikonomia" },
      {
        name: "description",
        content:
          "How the leadership team's work and reporting are doing, and where attention should go.",
      },
    ],
  }),
  component: TeamOverviewPage,
});

/**
 * Team Overview — the organization's leadership work, one level up.
 *
 * **Not a bigger My Binder.** My Binder is for doing your work; this is for
 * seeing how the team's work is going, recognizing exceptions, and deciding
 * where attention should go. It is why the page reads
 * *health → exception → person or area → go and look*, and why it contains no
 * way to do any of the work itself.
 *
 * Three things it deliberately is not, each of which it would be easy to drift
 * into:
 *
 * - **Not a leaderboard.** No score, no rank, no best-to-worst. Ordering exists
 *   so nothing urgent is missed. A church is not a league table.
 * - **Not a report viewer.** Everything here is workflow state. That a report
 *   is late is organizational; what it says is not.
 * - **Not the reports library.** Investigation and discussion happen
 *   there, and every link from here leads to it rather than reproducing it.
 */
function TeamOverviewPage() {
  const today = useMemo(() => toISO(new Date()), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [openLeader, setOpenLeader] = useState<string | null>(null);
  const navigate = useNavigate();

  const query = useQuery<TeamOverview>({
    queryKey: ["team-overview", today],
    queryFn: async () => unwrap(await withTimeout(fetchTeamOverview({ data: { today } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  if (query.isLoading) {
    return (
      <Page>
        <PageHeader title="Team Overview" description="How the leadership team's work is going." />
        <ListSkeleton rows={6} />
      </Page>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Page>
        <PageHeader title="Team Overview" description="How the leadership team's work is going." />
        <ErrorState
          title="The overview could not be assembled"
          onRetry={() => void query.refetch()}
        >
          Nothing is lost. This is a problem reaching the binder, not a quiet week.
        </ErrorState>
      </Page>
    );
  }

  const overview = query.data;
  const { counts, reporting, scope } = overview;
  const areas = overview.workAreas.map((a) => a.module);
  const onTrack = completion(
    counts.done,
    Object.values(counts).reduce((a, b) => a + b, 0),
  );

  const attention =
    filter === "all"
      ? overview.attention
      : overview.attention.filter((item) => item.status === filter);

  const leaders =
    filter === "all"
      ? overview.leaders
      : overview.leaders.filter((leader) => leader.overall === filter);

  const selected = overview.leaders.find((l) => l.personId === openLeader) ?? null;

  return (
    <Page>
      <PageHeader
        title="Team Overview"
        description="How the leadership team's work and reporting are going, and where attention should go."
      />

      {/* The reader has to be able to tell what they are looking at the whole
          of. A page that quietly shows a subset reads as the whole church. */}
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{scope.label}</span>
        <span aria-hidden>·</span>
        <span>{scope.reason}</span>
      </p>

      {overview.leaderCount === 0 ? (
        <EmptyState icon={Users} title="No leaders in this overview">
          Nobody in your scope is currently expected to record leadership work.
        </EmptyState>
      ) : (
        <>
          {/* ------------------------------------- 1. organizational health */}

          <section aria-label="Organizational health" className="mb-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard
                label="Leaders"
                value={`${overview.leaderCount}`}
                detail={scope.namesVisible ? "Listed below" : "Counted, not named"}
              />
              <MetricCard
                label="On track"
                value={`${onTrack.pct}%`}
                detail={`${onTrack.done} of ${onTrack.total} obligations`}
                status="done"
              />
              <MetricCard
                label="Reporting"
                value={`${completion(reporting.submitted, reporting.expected).pct}%`}
                detail={`${reporting.submitted} of ${reporting.expected} submitted`}
                status="in_progress"
              />
              {/* Each of these filters the page rather than merely stating a
                  number — a card that can only be read is not worth its space. */}
              <MetricCard
                label="Need attention"
                value={`${counts.warning}`}
                detail="Due soon or incomplete"
                status="warning"
                onClick={() => setFilter(filter === "warning" ? "all" : "warning")}
                active={filter === "warning"}
              />
              <MetricCard
                label="Overdue"
                value={`${counts.blocked}`}
                detail="Past the date, or stopped"
                status="blocked"
                onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")}
                active={filter === "blocked"}
              />
            </div>

            {filter !== "all" ? (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-2 text-[12px] text-primary underline-offset-2 hover:underline"
              >
                {/* The same word the card used. Two names for one state on one
                    page makes a reader wonder whether they are two states. */}
                Showing {overallLabel[filter].toLowerCase()} only — show everything
              </button>
            ) : null}
          </section>

          {/* ------------------------------------------------ 2. attention */}

          <div className="mb-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Section
              title="Needs attention"
              meta={attention.length > 0 ? `${attention.length}` : undefined}
            >
              {attention.length > 0 ? (
                <ul className="divide-y divide-border">
                  {attention.map((item) => (
                    <li key={item.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <StatusChip
                              status={item.status}
                              label={attentionReasonLabel[item.reason]}
                            />
                            <span className="text-[12px] text-muted-foreground">{item.module}</span>
                          </div>
                          <p className="mt-1 text-[14px]">
                            {item.personId ? (
                              <PersonName personId={item.personId} />
                            ) : (
                              <span className="text-muted-foreground">
                                Someone in {scope.label}
                              </span>
                            )}
                            <span className="text-muted-foreground"> · {item.period}</span>
                          </p>
                        </div>
                        <Link
                          to={item.destination}
                          className="shrink-0 text-[13px] text-primary underline-offset-2 hover:underline"
                        >
                          Look into it
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={ShieldCheck} title="Everything tracked is on schedule">
                  Nothing in {scope.label} is overdue or close to it.
                </EmptyState>
              )}
            </Section>

            {/* ------------------------------------------ 3. reporting */}

            <Section title="Reporting" meta={`${overview.trend.length} periods`}>
              <dl className="divide-y divide-border">
                {[
                  ["Expected", reporting.expected, undefined],
                  ["Submitted", reporting.submitted, undefined],
                  ["Submitted on time", reporting.onTime, undefined],
                  ["Submitted late", reporting.late, "warning"],
                  /* Never written and not yet read are completely different
                     problems; one number would hide which. Neither is a queue:
                     reporting completion is about whether leaders wrote, not
                     about whether leadership processed. */
                  ["Not submitted", reporting.outstanding, "blocked"],
                  ["You have not read", reporting.unread, undefined],
                ].map(([label, value, status]) => (
                  <div
                    key={label as string}
                    className="flex items-center justify-between px-4 py-2"
                  >
                    <dt className="text-[13px] text-muted-foreground">{label as string}</dt>
                    <dd className="inline-flex items-center gap-2">
                      {status ? (
                        <StatusChip status={status as ObligationStatus} label={" "} />
                      ) : null}
                      <span className="text-[14px] tabular-nums">{value as number}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="px-4 pb-3 pt-1">
                <Link
                  to="/reports"
                  className="text-[13px] text-primary underline-offset-2 hover:underline"
                >
                  Open Reports to you
                </Link>
              </div>
            </Section>
          </div>

          {/* ------------------------------------------- 4. leader status */}

          {scope.namesVisible ? (
            <div className="mb-5">
              <Section title="Leaders" meta={`${leaders.length}`}>
                <LeaderMatrix
                  leaders={leaders}
                  areas={areas}
                  onSelect={(id) => setOpenLeader((current) => (current === id ? null : id))}
                />
                {selected ? (
                  <div className="px-4 pb-4">
                    <LeaderQuickView
                      leader={selected}
                      areas={areas}
                      onClose={() => setOpenLeader(null)}
                    />
                  </div>
                ) : null}
              </Section>
            </div>
          ) : (
            <div className="mb-5">
              <Section title="Leaders">
                <div className="px-4 py-4">
                  <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
                    {overview.leaderCount} leaders are counted in the figures above. Who is behind
                    is shown to the people responsible for following it up —{" "}
                    {scope.reason.toLowerCase()}
                  </p>
                </div>
              </Section>
            </div>
          )}

          {/* ----------------------------------- 5. work areas and trend */}

          <div className="mb-5 grid items-start gap-4 lg:grid-cols-2">
            <Section title="Work areas">
              <div className="space-y-3 px-4 py-4">
                {overview.workAreas.map((area) => (
                  <AreaBar
                    key={area.module}
                    label={area.module}
                    done={area.done}
                    total={area.total}
                    onClick={() => void navigate({ to: area.destination })}
                  />
                ))}
              </div>
            </Section>

            <Section title="Reporting over time">
              <div className="px-4 py-4">
                <TrendChart points={overview.trend} noun="Reports submitted" />
              </div>
            </Section>
          </div>

          {/* --------------------------------------------- 6. consistency */}

          {scope.namesVisible ? (
            <Section title="Reporting consistency" meta="Recent periods">
              <ConsistencyGrid
                periods={overview.heatmap.periods}
                cells={overview.heatmap.cells}
                personIds={leaders.map((l) => l.personId)}
              />
            </Section>
          ) : null}
        </>
      )}
    </Page>
  );
}
