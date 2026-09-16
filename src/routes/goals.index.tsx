import { config } from "@/config";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Plus, Target } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { AccessNotice } from "@/components/oikonomia/access";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { errorMessage } from "@/lib/calendar-client";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { GoalStatusLine } from "@/components/oikonomia/goal-status";
import { useGoals } from "@/components/oikonomia/goals-provider";
import { FilterChip, ListToolbar } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  goalCounts,
  goalStatusLabel,
  goalYears,
  goalsForYear,
  latestUpdate,
  needsAttention,
} from "@/domain/goals";
import { useViewer } from "@/domain/session";
import { StarButton, useStarred } from "@/components/oikonomia/starred";
import type { Goal, GoalStatus } from "@/domain/types";

export const Route = createFileRoute("/goals/")({
  validateSearch: (search: Record<string, unknown>): { year?: number } =>
    typeof search["year"] === "number" ? { year: search["year"] } : {},
  head: () => ({
    meta: [
      { title: "Goals — Oikonomia" },
      {
        name: "description",
        content:
          "What the ministry said it wanted to improve this year, and where each goal stands now.",
      },
    ],
  }),
  component: GoalsIndex,
});

const statuses = config.options("goals.statuses").map((s) => s.id) as GoalStatus[];

/**
 * The annual binder page: a numbered list of goals for one year.
 *
 * Rows stay compact so twenty or thirty goals scan comfortably. This is
 * deliberately not a board — the paper page is a list, and a list is what makes
 * a year legible at a glance.
 */
function GoalsIndex() {
  const { ministries } = useOrganization();
  const { year: yearParam } = Route.useSearch();
  const store = useGoals();
  const { goals, updates } = store;

  const year = yearParam ?? new Date().getFullYear();

  /* Tells the provider which year to fetch, so changing years changes data. */
  const { setYear } = store;
  useEffect(() => setYear(year), [year, setYear]);

  const years = store.years.length > 0 ? store.years : goalYears(goals);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<GoalStatus | null>(null);
  const [ministryId, setMinistryId] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const starred = useStarred();

  /*
   * A goal the viewer cannot read never arrives here — the service filtered it
   * and counted it. The page states the count because a leader seeing four
   * goals should know whether that is the year or only their part of it.
   */
  const readable = goalsForYear(goals, year);
  const withheld = store.withheld;

  const q = query.trim().toLowerCase();
  const visible = readable.filter((goal) => {
    if (status && goal.status !== status) return false;
    if (ministryId && goal.ministryId !== ministryId) return false;
    if (starredOnly && !starred.isStarred("goal", goal.id)) return false;
    if (!q) return true;
    return (
      goal.title.toLowerCase().includes(q) || (goal.description ?? "").toLowerCase().includes(q)
    );
  });
  const starredCount = readable.filter((goal) => starred.isStarred("goal", goal.id)).length;

  const counts = goalCounts(readable);
  const attention = needsAttention(readable);
  const usedMinistries = ministries.filter((m) =>
    readable.some((goal) => goal.ministryId === m.id),
  );

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <Link to="/ministries" className="transition-colors hover:text-primary">
              Ministry
            </Link>{" "}
            · Goals
          </>
        }
        title={`${year} Goals`}
        description={
          counts.total > 0
            ? `${counts.total} goals · ${counts.completed} completed · ${counts.active} active${counts.onHold > 0 ? ` · ${counts.onHold} on hold` : ""}`
            : "Nothing set for this year yet."
        }
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
              {years.map((option) => (
                <Link
                  key={option}
                  to="/goals"
                  search={{ year: option }}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-[13px] tabular-nums transition-colors",
                    option === year
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option}
                </Link>
              ))}
            </div>
            <AddGoal year={year} />
          </>
        }
      />

      {attention.length > 0 ? (
        <section className="mb-4 rounded-lg border border-border bg-surface-muted px-4 py-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">Needs attention</h2>
          <ul className="mt-1.5 space-y-1">
            {attention.map((goal) => (
              <li
                key={goal.id}
                className="flex min-h-6 min-w-0 items-baseline gap-2 py-0.5 text-[13px]"
              >
                <span className="tabular-nums text-muted-foreground">
                  {String(goal.number).padStart(2, "0")}
                </span>
                <Link
                  to="/goals/$goalId"
                  params={{ goalId: goal.id }}
                  className="inline-flex min-h-6 min-w-0 items-center truncate transition-colors hover:text-primary"
                >
                  {goal.title}
                </Link>
                <GoalStatusLine goal={goal} className="shrink-0" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {withheld > 0 ? (
        <div className="mb-4">
          <AccessNotice
            decision={{
              level: "limited",
              rationale: `${withheld} goal${withheld === 1 ? " is" : "s are"} held to a narrower audience and not listed`,
              restrictedSections: [],
            }}
          />
        </div>
      ) : null}

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search goals">
        <FilterChip active={status === null} onClick={() => setStatus(null)}>
          All
        </FilterChip>
        {statuses.map((s) => {
          const n = readable.filter((goal) => goal.status === s).length;
          if (n === 0) return null;
          return (
            <FilterChip
              key={s}
              active={status === s}
              onClick={() => setStatus(status === s ? null : s)}
              count={n}
            >
              {goalStatusLabel[s]}
            </FilterChip>
          );
        })}
        {usedMinistries.length > 1
          ? usedMinistries.map((m) => (
              <FilterChip
                key={m.id}
                active={ministryId === m.id}
                onClick={() => setMinistryId(ministryId === m.id ? null : m.id)}
              >
                {m.name}
              </FilterChip>
            ))
          : null}
        {starredCount > 0 ? (
          <FilterChip
            active={starredOnly}
            onClick={() => setStarredOnly((v) => !v)}
            count={starredCount}
          >
            Starred
          </FilterChip>
        ) : null}
      </ListToolbar>

      {store.status === "error" ? (
        <ErrorState title="This year's goals could not be loaded" onRetry={store.retry}>
          Your goals are safe. This is a problem reaching them.
        </ErrorState>
      ) : store.status === "loading" ? (
        <ListSkeleton rows={5} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {visible.length > 0 ? (
            <ol className="divide-y divide-border">
              {visible.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  latest={latestUpdate(updates, goal.id)?.text}
                  starred={starred}
                />
              ))}
            </ol>
          ) : (
            <EmptyState
              icon={Target}
              title={
                query || status || ministryId || starredOnly
                  ? "No goals match those filters"
                  : "No goals set for this year yet"
              }
            >
              Set what the ministry wants to improve this year, and annotate it as you go.
            </EmptyState>
          )}
        </div>
      )}
    </Page>
  );
}

/** One numbered row. Stacks on narrow screens rather than scrolling sideways. */
function GoalRow({
  goal,
  latest,
  starred,
}: {
  goal: Goal;
  latest?: string | undefined;
  starred: ReturnType<typeof useStarred>;
}) {
  return (
    <li className="row-quiet">
      <Link
        to="/goals/$goalId"
        params={{ goalId: goal.id }}
        className="flex items-start gap-3 px-3 py-3 sm:gap-4 sm:px-4"
      >
        {/*
         * The binder's "03" is content — it is how a leader refers to the
         * goal out loud — so it reads at a full token rather than at a
         * fraction of one. `text-foreground/60` came to 4.38:1, just under AA.
         */}
        <span
          className={cn(
            "w-6 shrink-0 pt-0.5 text-right font-display text-[15px] tabular-nums",
            goal.status === "completed" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {String(goal.number).padStart(2, "0")}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[15px] leading-snug",
              goal.status === "completed" && "text-muted-foreground",
            )}
          >
            {goal.title}
          </span>

          {goal.description ? (
            <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted-foreground">
              {goal.description}
            </span>
          ) : null}

          <GoalStatusLine goal={goal} className="mt-1.5" />

          {latest && goal.status !== "completed" ? (
            <span className="mt-1 block truncate text-[12px] text-muted-foreground">
              Latest: {latest}
            </span>
          ) : null}
        </span>

        <StarButton
          starred={starred.isStarred("goal", goal.id)}
          onToggle={() => starred.toggle("goal", goal.id)}
          label={goal.title}
        />
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/50" aria-hidden />
      </Link>
    </li>
  );
}

/** Title, optional target, done. Adding a goal should feel like writing a row. */
function AddGoal({ year }: { year: number }) {
  const { addGoal, saving } = useGoals();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

  /*
   * Close only once the goal is saved. Closing first and failing afterwards
   * would tell a leader they had set a goal that does not exist — §20.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;

    setFailure(null);
    try {
      await addGoal({
        title: value,
        year,
        ...(target ? { target: { precision: "month" as const, value: target } } : {}),
      });
      setTitle("");
      setTarget("");
      setOpen(false);
    } catch (error) {
      setFailure(error);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-3.5" aria-hidden />
        Add goal
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <form onSubmit={(e) => void submit(e)} className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">Goal</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What do we want to improve?"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Target month — optional
            </span>
            <input
              type="month"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>
          {failure ? (
            <p role="alert" className="text-[12px] text-status-overdue">
              {errorMessage(failure)}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <Button type="submit" variant="primary" disabled={saving} busy={saving}>
              Add
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
