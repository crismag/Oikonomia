import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The four states every collection and detail surface can be in.
 *
 * Providers are in-memory today, so most screens are only ever `content`. The
 * contract exists now anyway: when persistence arrives, every list and detail
 * route needs loading and error states, and retrofitting them afterwards is how
 * a backend freezes UX mistakes into the UI. Establishing the shape first means
 * the later change is wiring, not redesign.
 */
export type AsyncState = "loading" | "error" | "empty" | "content";

/**
 * Skeleton rows for a list whose shape is already known.
 *
 * A skeleton matching the real row height keeps the page from jumping when the
 * data lands. A spinner in the middle of an empty page cannot do that, which is
 * why this is the default treatment for collections.
 */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-card",
        className,
      )}
      aria-hidden
    >
      <ul className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="h-3.5 w-16 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="min-w-0 flex-1">
              <span
                className="block h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none"
                /* Varied widths so it reads as text rather than a loading bar. */
                style={{ width: `${52 + ((i * 13) % 34)}%` }}
              />
              <span className="mt-1.5 block h-2.5 w-1/3 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same idea for a document-shaped surface. */
export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface shadow-card px-5 py-5", className)}
      aria-hidden
    >
      <span className="block h-5 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <span className="mt-2 block h-3 w-1/4 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
      <div className="mt-5 space-y-2">
        {[92, 86, 74, 90, 61].map((w, i) => (
          <span
            key={i}
            className="block h-3 animate-pulse rounded bg-muted/70 motion-reduce:animate-none"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Something that should have worked did not.
 *
 * Distinct from empty on purpose: empty means nothing is there, error means we
 * could not find out. Conflating them tells a leader their records are gone.
 *
 * Never renders the underlying exception — a leader can do nothing with a stack
 * trace, and it may carry information they should not see.
 */
export function ErrorState({
  title = "We couldn't load this",
  children,
  onRetry,
  className,
}: {
  title?: string;
  children?: ReactNode;
  onRetry?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-card px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-status-overdue-soft">
        <AlertTriangle className="size-[18px] text-status-overdue" aria-hidden />
      </div>
      <p className="mt-4 text-[15px] font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        {children ?? "Nothing has been lost. Try again in a moment."}
      </p>
      {onRetry ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={onRetry}>
            <RotateCw aria-hidden />
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Nothing here — and *why* there is nothing.
 *
 * "No records yet" and "nothing matches your filters" are different situations
 * needing different actions, so they are different props rather than one
 * message that has to serve both badly.
 */
export function CollectionEmpty({
  icon,
  title,
  children,
  action,
  filtered,
  onClearFilters,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** True when a search or filter caused the emptiness. */
  filtered?: boolean;
  onClearFilters?: (() => void) | undefined;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={icon}
        title="Nothing matches"
        action={
          onClearFilters ? (
            <Button type="button" variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null
        }
      >
        Try a different search, or remove a filter.
      </EmptyState>
    );
  }

  return (
    <EmptyState icon={icon} title={title} {...(action ? { action } : {})}>
      {children}
    </EmptyState>
  );
}

/**
 * Renders the right thing for the state a surface is in.
 *
 * Keeps the four cases in one place so a screen cannot accidentally implement
 * three of them and forget the fourth.
 */
export function AsyncBoundary({
  state,
  skeleton,
  error,
  empty,
  children,
}: {
  state: AsyncState;
  skeleton: ReactNode;
  error: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}) {
  if (state === "loading") return <>{skeleton}</>;
  if (state === "error") return <>{error}</>;
  if (state === "empty") return <>{empty}</>;
  return <>{children}</>;
}
