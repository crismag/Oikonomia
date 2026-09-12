import { cn } from "@/lib/utils";
import { statusLabel, type ObligationStatus } from "@/domain/obligations";

/**
 * The five semantic states, as shared primitives.
 *
 * These exist so the meaning is enforced rather than merely repeated. Before
 * this, screens looked consistent because they were written consistently — the
 * frontend review called that out — so a state's colour lived wherever it was
 * used and could drift without anything noticing.
 *
 * **Colour is never the only carrier.** Every one of these renders a word as
 * well, because a leader who is colour-blind, printing the page, or reading it
 * in bright sun is still owed the answer.
 */

const tone: Record<ObligationStatus, string> = {
  done: "border-status-done/30 bg-status-done-soft text-status-done",
  in_progress: "border-status-info/30 bg-status-info-soft text-status-info",
  warning: "border-status-waiting/35 bg-status-waiting-soft text-status-waiting",
  blocked: "border-status-overdue/35 bg-status-overdue-soft text-status-overdue",
  not_started: "border-border bg-muted text-muted-foreground",
};

const dotTone: Record<ObligationStatus, string> = {
  done: "bg-status-done",
  in_progress: "bg-status-info",
  warning: "bg-status-waiting",
  blocked: "bg-status-overdue",
  not_started: "bg-border-strong",
};

/**
 * A state, said in a word.
 *
 * `label` overrides the generic word where the obligation has a truer one —
 * "Overdue" rather than "Needs attention" — but there is always a word.
 */
export function StatusChip({
  status,
  label,
  className,
}: {
  status: ObligationStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        tone[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotTone[status])} aria-hidden />
      {label ?? statusLabel[status]}
    </span>
  );
}

/**
 * A state, as a mark.
 *
 * Used where a word would not fit — on a workflow station, in a dense row. The
 * word still reaches a screen reader, and sighted readers get it from the text
 * beside the dot, which is why every caller of this places one there.
 */
export function StatusDot({
  status,
  label,
  size = "md",
  className,
}: {
  status: ObligationStatus;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "lg" ? "size-3.5" : size === "sm" ? "size-1.5" : "size-2.5";
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <span className={cn("rounded-full", px, dotTone[status])} aria-hidden />
      <span className="sr-only">{label ?? statusLabel[status]}</span>
    </span>
  );
}

/**
 * How far along, as a count.
 *
 * "8 of 12" rather than "66%", because the count says what the denominator is.
 * The bar is supporting; the number is the answer.
 */
export function ProgressMeter({
  done,
  total,
  label,
  noun = "complete",
  className,
}: {
  done: number;
  total: number;
  label?: string;
  noun?: string;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        {label ? <span className="text-[12px] text-muted-foreground">{label}</span> : null}
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {done} of {total} {noun}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${done} of ${total} ${noun}`}
        {...(label ? { "aria-label": label } : {})}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            done === total && total > 0 ? "bg-status-done" : "bg-status-info",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
