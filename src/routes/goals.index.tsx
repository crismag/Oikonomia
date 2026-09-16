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
  goalScopeLabel,
  goalStatusLabel,
  goalYears,
  goalsForMyWork,
  latestUpdate,
  needsAttention,
} from "@/domain/goals";
import { useViewer } from "@/domain/session";
import { canContribute as canContributeMinistry, relationshipTo } from "@/domain/ministry";
import { StarButton, useStarred } from "@/components/oikonomia/starred";
import type { Goal, GoalScope, GoalStatus, GoalUpdate } from "@/domain/types";

type GoalsView = "personal" | "ministry" | "other";
const goalViews: GoalsView[] = ["personal", "ministry", "other"];

export const Route = createFileRoute("/goals/")({
  validateSearch: (search: Record<string, unknown>): { year?: number; view?: GoalsView } => ({
    ...(typeof search["year"] === "number" ? { year: search["year"] } : {}),
    ...(goalViews.includes(search["view"] as GoalsView)
      ? { view: search["view"] as GoalsView }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Goals — Oikonomia" },
      {
        name: "description",
        content:
          "Your personal goals, each ministry's goals and other groups' goals for the year — kept apart, and where each one stands.",
      },
    ],
  }),
  component: GoalsIndex,
});

const statuses = config.options("goals.statuses").map((s) => s.id) as GoalStatus[];

/**
 * The annual goals page, one kind of goal at a time.
 *
 * Personal goals, a ministry's goals and another group's goals are different
 * things. One numbered list of all of them — every leader's personal goals
 * mixed with every ministry's — was a list nobody could read, and "Needs
 * attention" drawn from it mixed one leader's slipping goal with another
 * ministry's. So each kind has its own tab, a ministry's or group's goals stay
 * together under its name, and what needs attention is drawn from the tab
 * being looked at.
 *
 * Personal means **your own**. Another leader's personal goals are theirs; they
 * are reached from Reports to you or that person's page.
 */
function GoalsIndex() {
  const { ministries, groups } = useOrganization();
  const { person } = useViewer();
  const { year: yearParam, view = "personal" } = Route.useSearch();
  const store = useGoals();
  const { goals, updates } = store;

  const year = yearParam ?? new Date().getFullYear();

  /* Tells the provider which year to fetch, so changing years changes data. */
  const { setYear } = store;
  useEffect(() => setYear(year), [year, setYear]);

  const years = store.years.length > 0 ? store.years : goalYears(goals);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<GoalStatus | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const starred = useStarred();

  /*
   * A goal the viewer cannot read never arrives here — the service filtered it
   * and counted it. The page states the count because a leader seeing four
   * goals should know whether that is the year or only their part of it.
   */
  const withheld = store.withheld;
  const sorted = goalsForMyWork(goals, { year, viewerId: person.id, ministries, groups });

  const inView: Goal[] =
    view === "personal"
      ? sorted.personal
      : (view === "ministry" ? sorted.ministries : sorted.groups).flatMap((g) => g.goals);

  const q = query.trim().toLowerCase();
  const matches = (goal: Goal) => {
    if (status && goal.status !== status) return false;
    if (starredOnly && !starred.isStarred("goal", goal.id)) return false;
    if (!q) return true;
    return (
      goal.title.toLowerCase().includes(q) || (goal.description ?? "").toLowerCase().includes(q)
    );
  };
  const filtering = !!(query || status || starredOnly);
  const starredCount = inView.filter((goal) => starred.isStarred("goal", goal.id)).length;
  const counts = goalCounts(inView);

  const nameOf = (id: string) =>
    view === "ministry"
      ? (ministries.find((m) => m.id === id)?.name ?? "A ministry")
      : id
        ? (groups.find((g) => g.id === id)?.name ?? "A group")
        : "Not filed under a group";

  /* Grouped the same way the tab is, so an item never loses whose it is. */
  const buckets: { id: string; name: string; goals: Goal[]; yours: boolean }[] =
    view === "personal"
      ? [{ id: "", name: "", goals: sorted.personal, yours: true }]
      : (view === "ministry" ? sorted.ministries : sorted.groups).map((g) => ({
          ...g,
          name: nameOf(g.id),
        }));

  const attention = buckets
    .map((bucket) => ({ ...bucket, goals: needsAttention(bucket.goals) }))
    .filter((bucket) => bucket.goals.length > 0);

  const tabCount: Record<GoalsView, number> = {
    personal: sorted.personal.length,
    ministry: sorted.ministries.reduce((n, g) => n + g.goals.length, 0),
    other: sorted.groups.reduce((n, g) => n + g.goals.length, 0),
  };

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
            ? `${goalScopeLabel[view]}: ${counts.total} · ${counts.completed} completed · ${counts.active} active${counts.onHold > 0 ? ` · ${counts.onHold} on hold` : ""}`
            : "Nothing set here for this year yet."
        }
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
              {years.map((option) => (
                <Link
                  key={option}
                  to="/goals"
                  search={{ year: option, view }}
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
            <AddGoal year={year} scope={view} />
          </>
        }
      />

      <nav
        aria-label="Kinds of goal"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {goalViews.map((option) => (
          <Link
            key={option}
            to="/goals"
            search={{ year, view: option }}
            aria-current={view === option ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
              view === option
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {goalScopeLabel[option]}
            {tabCount[option] > 0 ? ` · ${tabCount[option]}` : ""}
          </Link>
        ))}
      </nav>

      {attention.length > 0 ? (
        <section className="mb-4 rounded-lg border border-border bg-surface-muted px-4 py-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            Needs attention · {goalScopeLabel[view]}
          </h2>
          {attention.map((bucket) => (
            <div key={bucket.id || "personal"} className="mt-1.5">
              {view !== "personal" ? (
                <h3 className="text-[12px] font-medium text-foreground">{bucket.name}</h3>
              ) : null}
              <ul className="space-y-1">
                {bucket.goals.map((goal) => (
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
            </div>
          ))}
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
          const n = inView.filter((goal) => goal.status === s).length;
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
      ) : view === "personal" ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {sorted.personal.filter(matches).length > 0 ? (
            <ol className="divide-y divide-border">
              {sorted.personal.filter(matches).map((goal) => (
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
                filtering ? "No goals match those filters" : "No personal goals for this year yet"
              }
            >
              Your own goals for the year — what you want to grow in as a leader. Other
              leaders&apos; goals are theirs, and are on their pages.
            </EmptyState>
          )}
        </div>
      ) : (
        <GoalBuckets
          buckets={buckets
            .map((bucket) => ({ ...bucket, goals: bucket.goals.filter(matches) }))
            .filter((bucket) => bucket.goals.length > 0)}
          updates={updates}
          starred={starred}
          empty={
            filtering
              ? "No goals match those filters"
              : view === "ministry"
                ? "No ministry goals for this year yet"
                : "No goals for other groups this year yet"
          }
          emptyDetail={
            view === "ministry"
              ? "A ministry's goals are what the ministry wants to improve this year. They are set for a ministry you work in."
              : "Goals of the groups the church has named — a council, a team — set by that group's members."
          }
        />
      )}
    </Page>
  );
}

/**
 * Each ministry's or group's goals under its own name.
 *
 * Yours are open; the rest are closed until asked for, so a church with a
 * dozen ministries is a dozen names rather than one long list of goals.
 */
function GoalBuckets({
  buckets,
  updates,
  starred,
  empty,
  emptyDetail,
}: {
  buckets: { id: string; name: string; goals: Goal[]; yours: boolean }[];
  updates: GoalUpdate[];
  starred: ReturnType<typeof useStarred>;
  empty: string;
  emptyDetail: string;
}) {
  if (buckets.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EmptyState icon={Target} title={empty}>
          {emptyDetail}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {buckets.map((bucket) => (
        <details
          key={bucket.id || "unfiled"}
          open={bucket.yours}
          className="group overflow-hidden rounded-lg border border-border bg-surface"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[15px]">{bucket.name}</span>
            {bucket.yours ? (
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                Yours
              </span>
            ) : null}
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {bucket.goals.length} {bucket.goals.length === 1 ? "goal" : "goals"}
            </span>
          </summary>
          <ol className="divide-y divide-border border-t border-border">
            {bucket.goals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                latest={latestUpdate(updates, goal.id)?.text}
                starred={starred}
              />
            ))}
          </ol>
        </details>
      ))}
    </div>
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

/**
 * Setting a goal starts with whose it is.
 *
 * Personal, a ministry's, or another group's — chosen, not inferred. A
 * ministry or group is offered only if the leader works in it or belongs to
 * it; the server refuses anything else anyway. A personal goal may say which
 * ministry it relates to without becoming that ministry's goal.
 */
function AddGoal({ year, scope: initialScope }: { year: number; scope: GoalScope }) {
  const { addGoal, saving } = useGoals();
  const { activeMinistries, groups } = useOrganization();
  const { person } = useViewer();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<GoalScope>(initialScope);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [ministryId, setMinistryId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

  const myMinistries = activeMinistries.filter((ministry) =>
    canContributeMinistry(relationshipTo(ministry, person.id)),
  );
  const myGroups = groups.filter((group) => group.active && group.memberIds.includes(person.id));

  const missing =
    !title.trim() || (scope === "ministry" && !ministryId) || (scope === "other" && !groupId);

  /*
   * Close only once the goal is saved. Closing first and failing afterwards
   * would tell a leader they had set a goal that does not exist — §20.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missing) return;

    setFailure(null);
    try {
      await addGoal({
        title: title.trim(),
        year,
        scope,
        ...(target ? { target: { precision: "month" as const, value: target } } : {}),
        ...(scope !== "other" && ministryId ? { ministryId } : {}),
        ...(scope === "other" && groupId ? { groupId } : {}),
      });
      setTitle("");
      setTarget("");
      setMinistryId("");
      setGroupId("");
      setOpen(false);
    } catch (error) {
      setFailure(error);
    }
  }

  const field =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setScope(initialScope);
      }}
    >
      <PopoverTrigger className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-3.5" aria-hidden />
        Add goal
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <form onSubmit={(e) => void submit(e)} className="space-y-2.5">
          <fieldset>
            <legend className="mb-1 block text-[11px] text-muted-foreground">
              Whose goal is it?
            </legend>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ["personal", "Mine"],
                  ["ministry", "A ministry's"],
                  ["other", "A group's"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-md border px-2 py-1.5 text-[12px] transition-colors",
                    scope === value
                      ? "border-primary/40 bg-accent-soft text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="goal-scope"
                    value={value}
                    checked={scope === value}
                    onChange={() => setScope(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {scope === "ministry" ? (
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">Ministry</span>
              {myMinistries.length > 0 ? (
                <select
                  value={ministryId}
                  onChange={(e) => setMinistryId(e.target.value)}
                  className={field}
                >
                  <option value="">Choose the ministry</option>
                  {myMinistries.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>
                      {ministry.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="block text-[12px] text-muted-foreground">
                  You do not lead or serve in a ministry, so there is none to set a goal for.
                </span>
              )}
            </label>
          ) : null}

          {scope === "other" ? (
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">Group</span>
              {myGroups.length > 0 ? (
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className={field}
                >
                  <option value="">Choose the group</option>
                  {myGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="block text-[12px] text-muted-foreground">
                  You are not a member of any group, so there is none to set a goal for.
                </span>
              )}
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">Goal</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                scope === "personal" ? "What do I want to grow in?" : "What do we want to improve?"
              }
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
            />
          </label>

          {scope === "personal" && activeMinistries.length > 0 ? (
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">
                Relates to a ministry — optional
              </span>
              <select
                value={ministryId}
                onChange={(e) => setMinistryId(e.target.value)}
                className={field}
              >
                <option value="">None</option>
                {activeMinistries.map((ministry) => (
                  <option key={ministry.id} value={ministry.id}>
                    {ministry.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                It stays your goal; this only says what it is about.
              </span>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Target month — optional
            </span>
            <input
              type="month"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={field}
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
            <Button type="submit" variant="primary" disabled={saving || missing} busy={saving}>
              Add
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
