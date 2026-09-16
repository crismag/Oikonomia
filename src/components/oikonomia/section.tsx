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
        "scroll-mt-4 overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="truncate text-[15px] text-foreground">{title}</h2>
          {meta ? <span className="shrink-0 text-[12px] text-muted-foreground">{meta}</span> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
