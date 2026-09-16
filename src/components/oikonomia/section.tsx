import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  meta,
  action,
  className,
  children,
}: {
  /** An anchor, so another page can link to this section. */
  id?: string | undefined;
  title: string;
  meta?: string | undefined;
  action?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      className={cn(
        "scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2 shrink-0 rounded-full bg-area" aria-hidden />
          <h2 className="truncate text-[16px] text-foreground">{title}</h2>
          {meta ? (
            <span className="shrink-0 rounded-full bg-area-soft px-2 text-[11px] font-semibold leading-5 tabular-nums text-area-ink">
              {meta}
            </span>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
