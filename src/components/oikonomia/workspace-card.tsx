import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AreaId } from "@/domain/appearance";

import { cn } from "@/lib/utils";

/**
 * The card every Home widget is built from.
 *
 * It exists because of a finding from the frontend review: consistency here
 * held because the screens were written together, not because anything enforced
 * it. A shared card makes the header, the count, the footer link and the
 * spacing the same by construction rather than by care.
 *
 * Colour marks where a card looks into — its icon, count and link take the
 * area's colour — while the card itself stays a neutral surface, so the status
 * marks inside still carry the meaning. §7 — large card backgrounds stay neutral.
 */
export function WorkspaceCard({
  title,
  count,
  action,
  area,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  /** A number worth knowing at a glance. Omitted rather than shown as zero. */
  count?: number;
  /** Where the authoritative version of this lives. */
  action?: { label: string; to: string; search?: Record<string, unknown> };
  /** The area of work this window looks into; it gives the card its colour. */
  area?: AreaId;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      {...(area ? { "data-area": area } : {})}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 className="flex min-w-0 items-center gap-2.5 text-[16px]">
          {Icon ? (
            <span
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-area text-on-area"
              aria-hidden
            >
              <Icon className="size-[15px]" />
            </span>
          ) : null}
          <span className="truncate">{title}</span>
          {count !== undefined && count > 0 ? (
            <span className="shrink-0 rounded-full bg-area-soft px-2 font-sans text-[11px] font-semibold leading-5 tabular-nums text-area-ink">
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
            className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold text-area-ink transition-colors hover:bg-area-soft"
          >
            {action.label}
          </Link>
        ) : null}
      </header>

      <div className="min-w-0 flex-1 px-3 pb-3">{children}</div>
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
      {/* Every row leads with a mark, so a list scans as a list: the status
          where there is one, otherwise a ring in the card's colour. */}
      <span className="mt-[3px] grid size-4 shrink-0 place-items-center">
        {mark ?? <span className="size-3 rounded-full border-2 border-area/60" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn("block truncate text-[14px] font-medium", muted && "text-muted-foreground")}
        >
          {title}
        </span>
        {context ? (
          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{context}</span>
        ) : null}
      </span>
      {action || meta ? (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {action ? (
            <span className="whitespace-nowrap rounded-full bg-area-soft px-2 text-[11.5px] font-semibold leading-5 text-area-ink">
              {action}
            </span>
          ) : null}
          {meta ? (
            <span className="whitespace-nowrap text-[12px] text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const className =
    "flex items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-area-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <div className="px-2 py-1.5">
      <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
