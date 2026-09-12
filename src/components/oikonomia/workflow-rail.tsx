import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/oikonomia/semantic-status";
import { statusLabel, youAreHere, type LeadershipObligation } from "@/domain/obligations";

/**
 * A recurring leadership cycle, drawn as connected stations.
 *
 * The line means **progression through the cycle**, not dependency. LifeGroup
 * does not wait for the meeting notes to be written, and a diagram that implies
 * it does teaches a leader a rule the product does not have — so the connector
 * is a quiet rule, never an arrow.
 *
 * On a narrow screen it becomes a vertical list rather than a squeezed railway.
 * A five-station horizontal line at 320px is not a diagram, it is a smear.
 */

export function WorkflowRail({
  stations,
  selectedId,
  onSelect,
  label,
}: {
  stations: LeadershipObligation[];
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
  label: string;
}) {
  const here = youAreHere(stations);

  return (
    <div className="-mx-1 px-1">
      <ol
        aria-label={label}
        className={cn(
          "relative flex flex-col gap-1",
          /* The horizontal railway only above `sm`; below it, a list. */
          "sm:flex-row sm:items-start sm:gap-0",
        )}
      >
        {stations.map((station, index) => (
          <li
            key={station.id}
            className="relative flex min-w-0 items-center gap-3 sm:flex-1 sm:flex-col sm:items-stretch sm:gap-0"
          >
            {/* The connector. Decorative: the order is already in the list. */}
            <span
              aria-hidden
              className={cn(
                "absolute bg-border",
                "left-[7px] top-0 h-full w-px sm:left-0 sm:top-[15px] sm:h-px sm:w-full",
                index === 0 && "sm:left-1/2 sm:w-1/2",
                index === stations.length - 1 && "sm:w-1/2",
              )}
            />

            <button
              type="button"
              onClick={() => onSelect(station.id)}
              aria-current={here === station.id ? "step" : undefined}
              aria-expanded={selectedId === station.id}
              className={cn(
                "relative z-[1] flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted",
                "sm:flex-col sm:items-center sm:gap-1.5 sm:px-1 sm:text-center",
                selectedId === station.id && "bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2 bg-surface",
                  here === station.id ? "border-foreground" : "border-transparent",
                )}
              >
                <StatusDot status={station.status} label={statusLabel[station.status]} />
              </span>

              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{station.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {station.statusNote ?? statusLabel[station.status]}
                </span>
              </span>
            </button>

            {/*
             * "You are here", in words as well as by position. The arrow alone
             * is a shape; the sentence is what a screen reader and a hurried
             * reader both get.
             */}
            {here === station.id ? (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:mt-0.5 sm:block sm:text-center">
                You are here
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
