import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/oikonomia/semantic-status";
import type { ObligationStatus } from "@/domain/obligations";

/**
 * The figures across the top.
 *
 * Every one is a count of actual leadership work with a denominator a reader
 * can point at. There is no productivity score, no engagement index and no
 * rating — those would be numbers nobody could check, attached to people.
 *
 * A card that only shows a number is not worth its space, so each one either
 * leads somewhere or says what the number is of.
 */
export function MetricCard({
  label,
  value,
  detail,
  status,
  onClick,
  active,
}: {
  label: string;
  value: string;
  detail?: string;
  status?: ObligationStatus;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        {status ? <StatusDot status={status} size="sm" /> : null}
        <span className="text-[12px] text-muted-foreground">{label}</span>
      </span>
      <span className="mt-1 block text-[22px] leading-none tabular-nums">{value}</span>
      {detail ? (
        <span className="mt-1 block text-[12px] text-muted-foreground">{detail}</span>
      ) : null}
    </>
  );

  const className = cn(
    "block rounded-lg border border-border bg-surface px-4 py-3 text-left",
    onClick && "transition-colors hover:bg-muted",
    active && "border-border-strong bg-muted",
  );

  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * A completion bar for one work area.
 *
 * The ratio is the answer and the percentage supports it: 91% of eleven things
 * is a different situation from 91% of four hundred, and only the count says
 * which this is.
 */
export function AreaBar({
  label,
  done,
  total,
  onClick,
}: {
  label: string;
  done: number;
  total: number;
  onClick?: () => void;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const tone = pct >= 90 ? "bg-status-done" : pct >= 60 ? "bg-status-info" : "bg-status-waiting";

  const inner = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px]">{label}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {done} of {total} · {pct}%
        </span>
      </span>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${done} of ${total} complete, ${pct} percent`}
        className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {inner}
    </button>
  ) : (
    <div>{inner}</div>
  );
}
