import { useId, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The parts a working surface is built from.
 *
 * A workspace is a page a leader *works in* rather than reads: views over one
 * set of records, a way to narrow them, and a way to move through time. These
 * exist so that the next one — and there will be a next one — is assembled
 * rather than designed again, which is the only thing that actually keeps
 * screens consistent.
 *
 * Deliberately quiet. Only creation is emphasized; everything that rearranges
 * what is already on screen is a plain control, because a toolbar of primary
 * buttons is a toolbar nobody reads.
 */

/** Views belong to the workspace, never to the application sidebar. */
export function WorkspaceTabs<T extends string>({
  views,
  active,
  onChange,
  label,
}: {
  views: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-1">
      {views.map((view) => (
        <button
          key={view.id}
          role="tab"
          type="button"
          aria-selected={active === view.id}
          onClick={() => onChange(view.id)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            active === view.id
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Moving through time.
 *
 * The period is a heading, not a control: a leader should be able to read what
 * they are looking at without opening anything.
 */
export function PeriodNav({
  label,
  onPrevious,
  onToday,
  onNext,
  unit,
}: {
  label: string;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  /** "week", "month" — used in the button labels a screen reader hears. */
  unit: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPrevious}
        aria-label={`Previous ${unit}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Today
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label={`Next ${unit}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
      <span className="ml-1.5 text-[14px] font-medium">{label}</span>
    </div>
  );
}

/** Search within this workspace. Not the application's global search. */
export function WorkspaceSearch({
  value,
  onChange,
  placeholder = "Search this week…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

/**
 * A quiet menu that rearranges what is on screen.
 *
 * `active` is shown as a word beside the label, because a control that has been
 * changed and does not say so is how a leader comes to believe the workspace is
 * hiding things at random.
 */
export function WorkspaceMenu({
  label,
  active,
  children,
}: {
  label: string;
  active?: string | undefined;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
          active
            ? "border-border-strong bg-muted text-foreground"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {label}
        {active ? <span className="text-muted-foreground">· {active}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function MenuOption({
  children,
  selected,
  onSelect,
}: {
  children: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted",
        selected && "font-medium",
      )}
    >
      {children}
      {selected ? <span aria-hidden>✓</span> : null}
    </button>
  );
}

/**
 * One view failing is not the workspace failing.
 *
 * The shell, its tabs and its toolbar stay usable, so a leader whose calendar
 * will not draw can still switch to the agenda and get on — rather than being
 * shown one page-sized apology for the whole week.
 */
export function ViewError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-muted px-4 py-3 text-[13px]"
    >
      <span>{what} could not be loaded. Your entries are safe.</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Try again
      </button>
    </p>
  );
}
