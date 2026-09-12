import { cn } from "@/lib/utils";
import { config, type SemanticState } from "@/config";
import type { WorkKind, WorkStatus } from "@/domain/types";

/**
 * Source-object status — a property of the shared object, not of my routing.
 * Rendered as a bordered badge so it never reads as an attention reason.
 *
 * ## Where the words and the colours come from
 *
 * The **words** are configuration: an administrator may one day call "In
 * review" something else, and nothing but the label should change when they
 * do. The **colours** are not, and never were the church's business — a status
 * carries a semantic state (`success`, `warning`, `danger`…) and this file is
 * the one place that decides what each of those looks like.
 *
 * That split is why there is a lookup here and a `semanticState` in
 * configuration, rather than a class name sitting in a settings file.
 */

/** The design system's answer to each semantic state. The only copy of it. */
export const semanticTone: Record<SemanticState, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-status-info/30 bg-status-info-soft text-status-info",
  success: "border-status-done/30 bg-status-done-soft text-status-done",
  warning: "border-status-waiting/35 bg-status-waiting-soft text-status-waiting",
  danger: "border-status-overdue/35 bg-status-overdue-soft text-status-overdue",
};

/** Kept as a map because callers render `statusLabel[status]` in many places. */
export const statusLabel: Record<WorkStatus, string> = config.labels("work.statuses") as Record<
  WorkStatus,
  string
>;

export function StatusBadge({ status, className }: { status: WorkStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        semanticTone[config.semanticOf("work.statuses", status)],
        className,
      )}
    >
      {config.label("work.statuses", status)}
    </span>
  );
}

export const kindLabel: Record<WorkKind, string> = {
  report: "Report",
  concern: "Concern",
  decision: "Decision",
  review: "Review",
  "gathering-follow-up": "Gathering follow-up",
  "development-record": "Development record",
};

export function KindLabel({ kind }: { kind: WorkKind }) {
  return <span className="text-[12px] text-muted-foreground">{kindLabel[kind]}</span>;
}
