import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The card every Home widget is built from.
 *
 * It exists because of a finding from the frontend review: consistency here
 * held because the screens were written together, not because anything enforced
 * it. A shared card makes the header, the count, the footer link and the
 * spacing the same by construction rather than by care.
 *
 * Quiet on purpose. A border, generous padding, no shadow and no colour: the
 * status marks inside carry the meaning, and a wall of tinted cards would drown
 * them. §7 — large card backgrounds stay neutral.
 */
export function WorkspaceCard({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  /** A number worth knowing at a glance. Omitted rather than shown as zero. */
  count?: number;
  /** Where the authoritative version of this lives. */
  action?: { label: string; to: string; search?: Record<string, unknown> };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface", className)}
    >
      <header className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-4">
        <h2 className="text-[14px] font-medium">
          {title}
          {count !== undefined && count > 0 ? (
            <span className="ml-2 text-[13px] font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h2>
        {action ? (
          /*
           * Every card is a window into a module, never a copy of one. The
           * footer link is where the authoritative version lives, and it is
           * present even when the card is empty.
           */
          <Link
            to={action.to}
            {...(action.search ? { search: action.search } : {})}
            className="shrink-0 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {action.label}
          </Link>
        ) : null}
      </header>

      <div className="min-w-0 flex-1 px-5 pb-4">{children}</div>
    </section>
  );
}

/**
 * One object, previewed.
 *
 * A row says what the thing is, one line of context, and where it stands —
 * and then gets out of the way. Home is scanned, not read: the twenty-column
 * table belongs in the module.
 *
 * The whole row is the target, because guessing which part of a row is
 * clickable is the thing §33 is about.
 */
export function ObjectRow({
  to,
  search,
  onClick,
  title,
  context,
  meta,
  action,
  mark,
  muted,
}: {
  to?: string;
  search?: Record<string, unknown>;
  onClick?: () => void;
  title: string;
  context?: string;
  /** The right-hand word: a due date, a state, a count. */
  meta?: ReactNode;
  /**
   * The next step, when the row is a dispatch rather than a preview.
   *
   * Shown in the product's action colour so a scan of Home answers "what
   * would I press?" without opening anything. Never a second control: the
   * whole row still is the target.
   */
  action?: string;
  /** A small status mark. Never the only carrier of meaning. */
  mark?: ReactNode;
  muted?: boolean;
}) {
  const body = (
    <>
      {mark ? <span className="mt-[5px] shrink-0">{mark}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14px]", muted && "text-muted-foreground")}>
          {title}
        </span>
        {context ? (
          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{context}</span>
        ) : null}
      </span>
      {action || meta ? (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {action ? (
            <span className="whitespace-nowrap text-[12px] font-medium text-primary">{action}</span>
          ) : null}
          {meta ? (
            <span className="whitespace-nowrap text-[12px] text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const className =
    "-mx-2 flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted";

  if (to) {
    return (
      <li>
        <Link to={to} {...(search ? { search } : {})} className={className}>
          {body}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={cn(className, "w-full")}>
          {body}
        </button>
      </li>
    );
  }
  return (
    <li>
      <span className={cn(className, "hover:bg-transparent")}>{body}</span>
    </li>
  );
}

/**
 * What a card says when it has nothing to show.
 *
 * One sentence saying what the state means, and an action where there is a
 * useful one. Not a decorative panel: a card that is empty because the leader
 * is up to date should say so and take up almost no room.
 */
export function CardEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-1.5">
      <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
