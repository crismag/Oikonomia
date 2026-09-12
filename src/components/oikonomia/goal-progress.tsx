import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, PauseCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { resolveAccess } from "@/domain/access";
import { goalsForYear, reportableFromGoals } from "@/domain/goals";
import { fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import { Section } from "./section";
import { useGoals } from "./goals-provider";
import { useForms } from "./forms-provider";
import { reportableFromRecords } from "@/domain/forms";
import type { ReportableItem } from "@/domain/types";

/**
 * Goal progress, available for a report.
 *
 * Assembled from the authoritative goal records rather than retyped each cycle,
 * so a leader writing a monthly report does not have to reconstruct the year
 * from memory. Selection is the leader's — nothing is placed in a report
 * automatically, and nothing here changes a goal.
 *
 * `ReportableItem` is deliberately generic: Meeting Notes will produce the same
 * shape when that section exists, and this surface will show them alongside.
 */
export function GoalProgressForReport({ year }: { year: number }) {
  const { goals, updates } = useGoals();
  const { records } = useForms();
  const { persona, person } = useViewer();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* Only goals the viewer can read can contribute to their report. */
  const readable = goalsForYear(goals, year).filter((goal) => {
    if (!goal.policy) return true;
    const level = resolveAccess(persona, person, goal.policy).level;
    return level === "full" || level === "limited";
  });

  /* Goals and form records produce the same ReportableItem shape, so they are
     offered together rather than in two competing panels. */
  const items = [...reportableFromGoals(readable, updates), ...reportableFromRecords(records)].sort(
    (a, b) => b.date.localeCompare(a.date),
  );
  if (items.length === 0) return null;

  const groups: { key: ReportableItem["emphasis"]; label: string }[] = [
    { key: "completed", label: "Completed" },
    { key: "progress", label: "In progress" },
    { key: "on-hold", label: "Needs attention" },
  ];

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Section
      title="Progress and exceptions"
      meta={
        selected.size > 0 ? `${selected.size} selected` : `${items.length} available for a report`
      }
      action={
        <Link
          to="/goals"
          search={{ year }}
          className="inline-flex min-h-6 items-center gap-1.5 inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
        >
          {year} Goals
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      <div className="divide-y divide-border">
        {groups.map(({ key, label }) => {
          const inGroup = items.filter((item) => item.emphasis === key);
          if (inGroup.length === 0) return null;

          return (
            <div key={key} className="px-4 py-3">
              <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</h3>
              <ul className="space-y-1">
                {inGroup.map((item) => (
                  /*
                   * The label covers the checkbox and the item's text, and
                   * stops there. The source link below it goes somewhere; if it
                   * sat inside the label, following it would silently tick the
                   * box on the way out.
                   */
                  <li key={item.id} className="flex min-h-6 items-start gap-2.5 py-0.5">
                    <input
                      id={`carry-${item.id}`}
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="mt-[3px] size-3.5 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <label
                        htmlFor={`carry-${item.id}`}
                        className="flex min-w-0 cursor-pointer items-start gap-1.5 text-[14px] leading-5"
                      >
                        {key === "completed" ? (
                          <Check
                            className="mt-0.5 size-3.5 shrink-0 text-status-done"
                            aria-hidden
                          />
                        ) : null}
                        {key === "on-hold" ? (
                          <PauseCircle
                            className="mt-0.5 size-3.5 shrink-0 text-status-waiting"
                            aria-hidden
                          />
                        ) : null}
                        <span className="min-w-0">{item.text}</span>
                      </label>
                      {item.source.kind === "goal" ? (
                        <Link
                          to="/goals/$goalId"
                          params={{ goalId: item.source.id }}
                          className="mt-0.5 inline-flex min-h-6 items-center text-[12px] text-muted-foreground transition-colors hover:text-primary"
                        >
                          {item.source.label} · {formatItemDate(item.date)}
                        </Link>
                      ) : (
                        <Link
                          to="/records/$recordId"
                          params={{ recordId: item.source.id }}
                          className="mt-0.5 inline-flex min-h-6 items-center text-[12px] text-muted-foreground transition-colors hover:text-primary"
                        >
                          {item.source.label} · {formatItemDate(item.date)}
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p
        className={cn(
          "border-t border-border px-4 py-2 text-[12px]",
          selected.size > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {selected.size > 0
          ? `${selected.size} ${selected.size === 1 ? "item" : "items"} ready to carry into a report.`
          : "Pick what belongs in this period's report. Nothing is included automatically."}
      </p>
    </Section>
  );
}

/** Accepts yyyy-MM or yyyy-MM-dd — goal records carry both. */
function formatItemDate(value: string): string {
  const parts = value.split("-");
  if (parts.length === 2) {
    return format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1), "MMMM yyyy");
  }
  return format(fromISO(value), "d MMMM yyyy");
}
