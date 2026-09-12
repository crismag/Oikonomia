import { cn } from "@/lib/utils";
import { reportStatusLabel } from "@/domain/leadership-report";
import type { ReportStatus } from "@/domain/types";

/**
 * A report's place in its own life.
 *
 * Calm rather than alarming: status is third in the visual hierarchy, after
 * identity and confidentiality, and an ordinary draft should not shout.
 */
const statusTone: Record<ReportStatus, string> = {
  draft: "border-status-waiting/35 bg-status-waiting-soft text-status-waiting",
  shared: "border-status-info/35 bg-status-info-soft text-status-info",
  published: "border-status-done/30 bg-status-done-soft text-status-done",
  archived: "border-border bg-surface-muted text-muted-foreground",
};

export function StatusTag({ status }: { status: ReportStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-5",
        statusTone[status],
      )}
    >
      {reportStatusLabel[status]}
    </span>
  );
}
