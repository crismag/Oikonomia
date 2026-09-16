import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An empty surface is an invitation, not a void. A clear Inbox is success and
 * should read that way — never fake engagement to fill the space.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      {/* Rings of the area's colour around its icon: an empty page still
          belongs somewhere. */}
      <div className="relative mx-auto grid size-20 place-items-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-area/8" />
        <span className="absolute inset-3 rounded-full bg-area/12" />
        <span className="relative grid size-11 place-items-center rounded-2xl bg-area text-on-area shadow-raised">
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-4 font-display text-[17px]">{title}</p>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
