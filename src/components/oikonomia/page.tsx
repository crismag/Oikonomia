import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared page grammar.
 *
 * Every module index and detail page uses these so headers, widths and rhythm
 * stay identical across the product. A module differs by what it *shows*, never
 * by how its page frame is built.
 */

/**
 * `width` says what the page is for, not how many pixels it gets.
 *
 * - `regular` and `wide` are for **reading and writing**: a report, a meeting
 *   note, a form. A measure that runs the width of a monitor is unreadable, so
 *   these stay capped.
 * - `workspace` is for **working**: a roster, an agenda, a calendar, a board.
 *   These are scanned across rather than read down, and capping them wastes the
 *   space the work needs.
 */
export function Page({
  children,
  width = "wide",
  className,
}: {
  children: ReactNode;
  width?: "wide" | "regular" | "workspace";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto px-4 py-6 sm:px-6 lg:py-8",
        width === "wide" && "max-w-6xl",
        width === "regular" && "max-w-5xl",
        /* Room to breathe at very wide sizes without becoming edge-to-edge. */
        width === "workspace" && "w-full max-w-[1600px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  /** Where this page sits, when the sidebar alone does not say it. */
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {eyebrow ? <p className="text-[12px] text-muted-foreground">{eyebrow}</p> : null}
          <h1 className={cn("text-[26px] leading-tight", eyebrow && "mt-0.5")}>{title}</h1>
          {description ? (
            <p className="mt-1 max-w-prose text-[14px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Detail header for any source object: where it lives, what it is, its state.
 * Mirrors the work/review context so a person, ministry or event page never
 * feels like a different product.
 */
export function DetailHeader({
  eyebrow,
  title,
  status,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 border-b border-border pb-5">
      {eyebrow ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 max-w-2xl text-[22px] leading-snug sm:text-[26px]">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {status}
          {actions}
        </div>
      </div>

      {meta ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </header>
  );
}

/** Two-column detail layout: content plus a sticky context rail. */
export function DetailLayout({ children, rail }: { children: ReactNode; rail: ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_248px]">
      <div className="min-w-0 space-y-5">{children}</div>
      <aside className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start">{rail}</aside>
    </div>
  );
}

export function RailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-medium text-muted-foreground">{label}</h2>
      {children}
    </section>
  );
}
