import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { pageSummary, pageTokens, type PageWindow } from "@/domain/pagination";

/**
 * Paging control.
 *
 * A leader reading a long list needs two different things depending on the
 * device in their hand. At a desk they want to jump — "the September reports
 * are around page 5" — so the numbers are shown. On a phone the same row of
 * numbers becomes a line of 24px targets nobody can hit, so it collapses to
 * Previous / Page 2 of 8 / Next, which is the only thing a thumb can use.
 *
 * The control renders nothing when the list already fits, because a disabled
 * pager tells the reader there is more to see when there is not.
 */
export function Pagination<T>({
  window: page,
  onPage,
  noun,
  plural,
  className,
}: {
  window: PageWindow<T>;
  onPage: (page: number) => void;
  /** What is being counted, so the summary reads as a sentence. */
  noun: string;
  plural?: string;
  className?: string;
}) {
  const summary = pageSummary(page, noun, plural);

  if (page.singlePage) {
    return page.total === 0 ? null : (
      <p className={cn("mt-3 text-[12px] text-muted-foreground", className)}>{summary}</p>
    );
  }

  const tokens = pageTokens(page.page, page.pageCount);
  const atStart = page.page === 1;
  const atEnd = page.page === page.pageCount;

  return (
    <nav
      aria-label={`${noun} pages`}
      className={cn(
        "mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3",
        className,
      )}
    >
      <p aria-live="polite" className="text-[12px] text-muted-foreground">
        {summary}
      </p>

      <div className="flex items-center gap-1">
        <Step
          direction="previous"
          disabled={atStart}
          onClick={() => onPage(page.page - 1)}
          label="Previous"
        />

        {/* Numbers are a pointer affordance; a thumb gets the counter below. */}
        <ul className="hidden items-center gap-0.5 sm:flex">
          {tokens.map((token, i) =>
            token === "gap" ? (
              <li
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-[13px] leading-none text-disabled"
              >
                …
              </li>
            ) : (
              <li key={token}>
                <button
                  type="button"
                  onClick={() => onPage(token)}
                  aria-label={`Page ${token}`}
                  aria-current={token === page.page ? "page" : undefined}
                  className={cn(
                    "min-w-8 rounded-md px-2 py-1.5 text-[13px] tabular-nums transition-colors",
                    token === page.page
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {token}
                </button>
              </li>
            ),
          )}
        </ul>

        <span className="px-1 text-[13px] tabular-nums text-muted-foreground sm:hidden">
          Page {page.page} of {page.pageCount}
        </span>

        <Step
          direction="next"
          disabled={atEnd}
          onClick={() => onPage(page.page + 1)}
          label="Next"
        />
      </div>
    </nav>
  );
}

/**
 * Previous / Next.
 *
 * The word is carried to the phone and the icon to the desk, so the control is
 * never two icons a thumb has to guess between.
 */
function Step({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[13px] transition-colors",
        disabled
          ? "cursor-not-allowed border-transparent text-disabled"
          : "hover:bg-muted hover:text-foreground",
        direction === "next" && "flex-row-reverse",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
