import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { resolveAccess } from "@/domain/access";
import { goalsByWhose } from "@/domain/goals";
import { useViewer } from "@/domain/session";
import type { Goal } from "@/domain/types";
import { GoalStatusLine } from "./goal-status";
import { useGoals } from "./goals-provider";
import { useOrganization } from "./organization-provider";
import { Section } from "./section";

/**
 * The goals behind the reports a leader receives — one person or ministry at
 * a time.
 *
 * This replaced a panel that pooled every readable goal's progress into one
 * list sorted by status. A leader's goals are personal; mixed with everybody
 * else's they read as noise. Here each group is somebody's or some ministry's,
 * closed until opened, and every row is a way into that goal's own record.
 * Nothing is summarised across people.
 */
export function GoalsByWhose({ year }: { year: number }) {
  const { goals } = useGoals();
  const { people, ministries, ministryById } = useOrganization();
  const { persona, person } = useViewer();

  /* Only goals this viewer may read. */
  const readable = goals.filter((goal) => {
    if (!goal.policy) return true;
    const level = resolveAccess(persona, person, goal.policy).level;
    return level === "full" || level === "limited";
  });

  const grouped = goalsByWhose(readable, { year, viewerId: person.id, people, ministries });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";

  if (grouped.people.length + grouped.ministries.length + grouped.shared.length === 0) {
    return null;
  }

  return (
    <Section
      title={`${year} goals`}
      action={
        <Link
          to="/goals"
          search={{ year }}
          className="inline-flex min-h-6 items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
        >
          All goals
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
        Each leader&apos;s goals are their own. Open a person or a ministry to see theirs, and a
        goal to read it.
      </p>

      <div className="divide-y divide-border">
        {grouped.people.length > 0 ? (
          <Group label="People who report to you">
            {grouped.people.map(({ personId, goals: theirs }) => (
              <Whose key={personId} name={nameOf(personId)} goals={theirs} showMinistry />
            ))}
          </Group>
        ) : null}

        {grouped.ministries.length > 0 ? (
          <Group label="Ministries">
            {grouped.ministries.map(({ ministryId, goals: theirs }) => (
              <Whose
                key={ministryId}
                name={ministryById(ministryId)?.name ?? "A ministry"}
                goals={theirs}
              />
            ))}
          </Group>
        ) : null}

        {grouped.shared.length > 0 ? (
          <Group label="Shared">
            <Whose name="Shared goals" goals={grouped.shared} />
          </Group>
        ) : null}
      </div>
    </Section>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">{label}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/** One person's or one ministry's goals, closed until asked for. */
function Whose({
  name,
  goals,
  showMinistry = false,
}: {
  name: string;
  goals: Goal[];
  showMinistry?: boolean;
}) {
  const { ministryById } = useOrganization();
  return (
    <li>
      <details className="group">
        <summary className="-mx-2 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-[14px] transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {goals.length} {goals.length === 1 ? "goal" : "goals"}
          </span>
        </summary>
        <ul className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-border pl-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Link
                to="/goals/$goalId"
                params={{ goalId: goal.id }}
                className="-mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-muted"
              >
                <span className="block text-[13px] leading-5">
                  <span className="mr-1.5 tabular-nums text-muted-foreground">
                    {String(goal.number).padStart(2, "0")}
                  </span>
                  {goal.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-2">
                  {/* A ministry on an owned goal is where it belongs, not whose it is. */}
                  {showMinistry && goal.ministryId ? (
                    <span className="text-[12px] text-muted-foreground">
                      {ministryById(goal.ministryId)?.name}
                    </span>
                  ) : null}
                  <GoalStatusLine goal={goal} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
