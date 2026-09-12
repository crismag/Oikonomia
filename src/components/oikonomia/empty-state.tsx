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
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-surface-muted">
        <Icon className="size-[18px] text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-4 text-[15px] font-medium">{title}</p>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
