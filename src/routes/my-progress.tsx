import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AttentionItem } from "@/components/oikonomia/attention-item";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { ProgressMeter, StatusChip, StatusDot } from "@/components/oikonomia/semantic-status";
import { Section } from "@/components/oikonomia/section";
import { WorkflowDetail } from "@/components/oikonomia/workflow-detail";
import { WorkflowRail } from "@/components/oikonomia/workflow-rail";
import { fetchDashboard, type Dashboard } from "@/lib/dashboard-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import {
  cadenceLabel,
  cycleProgress,
  dueLabel,
  needsAttention,
  statusLabel,
  tally,
  type LeadershipObligation,
  type ObligationStatus,
} from "@/domain/obligations";
import { toISO } from "@/domain/schedule";
import { CheckCircle2, ListChecks } from "lucide-react";

export const Route = createFileRoute("/my-progress")({
  head: () => ({
    meta: [
      { title: "My Progress — Oikonomia" },
      {
        name: "description",
        content:
          "How your leadership responsibilities are going: the cycle, what is complete, and what still needs you.",
      },
    ],
  }),
  component: LeaderDashboard,
});

/**
 * My Progress — how the leader's own responsibilities are going.
 *
 * **Not Home.** Home asks "what should I know or do right now?" and hands the
 * leader onward within seconds. This asks the slower question — *how am I doing
 * against what is expected of me?* — and answers it with the cycle, the
 * completion and the stages. Both are personal; they are different depths, and
 * collapsing them produces one page that does neither job.
 *
 * It answers, in the order a leader actually asks it:
 * **where do I stand, where am I in the cycle, and what comes next?**
 *
 * ## It is a projection, never a replacement
 *
 * `BINDER-INFORMATION-ARCHITECTURE.md` is firm that an application service must
 * not present itself as binder material, and that attention is legitimate
 * precisely because every item *points into* a binder section. So nothing is
 * written here. Every row, station and chip is derived from records a section
 * owns, and every action leaves for that section.
 *
 * ## Status is computed, and "done" means done
 *
 * `domain/obligations.ts` holds the rule. A gathering with attendance recorded
 * and no report written is in progress, not finished — telling a leader
 * otherwise would be worse than telling them nothing.
 */
function LeaderDashboard() {
  const today = useMemo(() => toISO(new Date()), []);
  const [openStation, setOpenStation] = useState<string | null>(null);

  const query = useQuery<Dashboard>({
    queryKey: ["dashboard", today],
    queryFn: async () => unwrap(await withTimeout(fetchDashboard({ data: { today } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  if (query.isLoading) {
    return (
      <Page>
        <PageHeader title="My Progress" description="Where the week stands." />
        <ListSkeleton rows={5} />
      </Page>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Page>
        <PageHeader title="My Progress" description="Where the week stands." />
        {/* An empty week and an unreachable binder look identical, and only one
            of them means "nothing needs you". */}
        <ErrorState title="Your binder could not be read" onRetry={() => void query.refetch()}>
          Nothing is lost. This is a problem reaching it, not a quiet week.
        </ErrorState>
      </Page>
    );
  }

  const { weekly, monthly } = query.data;
  const all = [...weekly.obligations, ...monthly.obligations];
  const counts = tally(all);
  const attention = needsAttention(all);
  const weekProgress = cycleProgress(weekly.obligations);
  const monthProgress = cycleProgress(monthly.obligations);

  const station = all.find((o) => o.id === openStation) ?? null;

  return (
    <Page>
      <PageHeader
        title="My Progress"
        description="How your leadership responsibilities are going this week and this month."
      />

      {/* ------------------------------------------- A. the cycle summary */}

      <section
        aria-label="Leadership cycle"
        className="mb-5 rounded-lg border border-border bg-surface px-5 py-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-medium">This week</h2>
          <span className="text-[13px] text-muted-foreground">{weekly.period}</span>
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {(["blocked", "warning", "in_progress", "not_started", "done"] as ObligationStatus[]).map(
            (status) =>
              counts[status] > 0 ? (
                <li key={status} className="flex items-center gap-1.5">
                  <StatusDot status={status} size="sm" />
                  {/* The count and the word together. A coloured number is not a
                    statement anyone can read without a legend. */}
                  <span className="text-[13px]">
                    <span className="font-medium tabular-nums">{counts[status]}</span>{" "}
                    <span className="text-muted-foreground">{statusLabel[status]}</span>
                  </span>
                </li>
              ) : null,
          )}
        </ul>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ProgressMeter
            done={weekProgress.done}
            total={weekProgress.total}
            label="Weekly cycle"
            noun="steps"
          />
          <ProgressMeter
            done={monthProgress.done}
            total={monthProgress.total}
            label={`${monthly.period} cycle`}
            noun="steps"
          />
        </div>
      </section>

      {/* --------------------------------------- B. what needs attention */}

      <div className="mb-5">
        <Section
          title="Needs your attention"
          meta={attention.length > 0 ? `${attention.length}` : undefined}
        >
          {attention.length > 0 ? (
            <ul className="divide-y divide-border">
              {attention.map((obligation) => (
                <AttentionItem key={obligation.id} obligation={obligation} today={today} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing is waiting on you">
              Everything this week and this month has been recorded. What you have finished is
              below.
            </EmptyState>
          )}
        </Section>
      </div>

      {/* ------------------------------------------------ C. the week */}

      <div className="mb-5">
        <Section title="This week" meta={weekly.period}>
          <div className="px-4 py-4">
            <WorkflowRail
              label="This week's leadership cycle"
              stations={weekly.obligations}
              selectedId={openStation ?? undefined}
              onSelect={(id) => setOpenStation((current) => (current === id ? null : id))}
            />
            {station && weekly.obligations.some((o) => o.id === station.id) ? (
              <WorkflowDetail
                obligation={station}
                today={today}
                onClose={() => setOpenStation(null)}
              />
            ) : null}
          </div>
        </Section>
      </div>

      {/* ----------------------------------------------- D. the month */}

      <div className="mb-5">
        <Section title={monthly.period} meta="Monthly">
          <div className="px-4 py-4">
            <WorkflowRail
              label={`${monthly.period} leadership cycle`}
              stations={monthly.obligations}
              selectedId={openStation ?? undefined}
              onSelect={(id) => setOpenStation((current) => (current === id ? null : id))}
            />
            {station && monthly.obligations.some((o) => o.id === station.id) ? (
              <WorkflowDetail
                obligation={station}
                today={today}
                onClose={() => setOpenStation(null)}
              />
            ) : null}
          </div>
        </Section>
      </div>

      {/* --------------------------------------- E. the leadership areas */}

      <Section title="Leadership areas" meta={`${all.length}`}>
        <AreaBoard obligations={all} today={today} />
      </Section>
    </Page>
  );
}

/**
 * Every area, and where it stands.
 *
 * A table on a wide screen because the columns are worth comparing; stacked
 * rows below, because a five-column table at 390px is a table nobody reads.
 */
function AreaBoard({ obligations, today }: { obligations: LeadershipObligation[]; today: string }) {
  if (obligations.length === 0) {
    return (
      <EmptyState icon={ListChecks} title="Nothing is expected of you yet">
        Leadership areas appear here once the binder has something to go on.
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {obligations.map((obligation) => {
        const due =
          obligation.blockedReason ?? dueLabel(obligation.dueAt, today, obligation.status);
        return (
          <li key={obligation.id} className="row-quiet">
            <Link
              to={obligation.destination}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
            >
              <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                <span className="block truncate text-[14px]">{obligation.module}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {obligation.title}
                </span>
              </span>

              <StatusChip
                status={obligation.status}
                {...(obligation.statusNote ? { label: obligation.statusNote } : {})}
              />

              <span className="shrink-0 text-[12px] text-muted-foreground">
                {cadenceLabel[obligation.cadence]}
              </span>
              <span className="w-[92px] shrink-0 text-right text-[12px] text-muted-foreground">
                {due ?? "—"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
