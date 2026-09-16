import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared index grammar: one search field plus one row of filter chips.
 *
 * Every module list uses this, so filtering looks and behaves the same
 * everywhere. The chip strip scrolls horizontally on narrow screens rather
 * than wrapping into a tall stack that pushes content off the fold.
 */

export function ListToolbar({
  query,
  onQuery,
  placeholder,
  children,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
      <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:w-72">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">{placeholder}</span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      {children ? (
        <div className="-mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
        active
          ? "border-primary/30 bg-area-soft font-medium text-area-ink"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      {/* The count is content, not chrome: it reads at the full token. */}
      {count !== undefined ? <span className="text-[12px] tabular-nums">{count}</span> : null}
    </button>
  );
}

/** Count line under a toolbar: "12 of 40 people". Keeps filters honest. */
export function ResultCount({
  shown,
  total,
  noun,
}: {
  shown: number;
  total: number;
  noun: string;
}) {
  return (
    <p className="mb-2 text-[12px] text-muted-foreground">
      {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
    </p>
  );
}
