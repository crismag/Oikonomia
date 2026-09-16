import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { navFor } from "./nav";
import { useViewer } from "@/domain/session";
import { useLeadershipInbox } from "./escalation-provider";

export function SidebarContent({
  collapsed,
  onNavigate,
  onToggle,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inbox = useLeadershipInbox();
  const { persona } = useViewer();

  /*
   * The badge counts **things people have asked of this leader** — decisions,
   * actions, matters raised for their attention — and nothing else.
   *
   * It used to count everything routed to them, which meant a week of
   * ordinary reports arriving looked identical to a week with three problems
   * in it. A number on a sidebar should mean "this many things need you", or
   * it should not be there.
   */
  const inboxCount = inbox.mine.length;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3",
          collapsed && "justify-center px-2",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-display text-lg leading-none text-primary-foreground">
          O
        </span>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] leading-tight">Oikonomia</span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {persona.label} view
            </span>
          </span>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {navFor(persona).map((group, index, all) => (
          <div key={group.heading} className="mb-4 last:mb-0">
            {/* The Binder is the product; leadership is a separate context. */}
            {!collapsed && (index === 0 || all[index - 1]?.context !== group.context) ? (
              <p className="px-2 pb-2 pt-1 text-[11px] font-semibold tracking-wide text-foreground">
                {group.context === "binder" ? "My Binder" : "Leadership"}
              </p>
            ) : null}
            {collapsed && index > 0 && all[index - 1]?.context !== group.context ? (
              <div className="mx-auto mb-3 h-px w-6 bg-border-strong" />
            ) : null}
            {!collapsed &&
            group.heading !== (group.context === "binder" ? "My Binder" : "Leadership") ? (
              <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
                {group.heading}
              </p>
            ) : collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.to ? pathname === item.to : false;
                const count = item.to === "/inbox" ? inboxCount : 0;

                const body = (
                  <>
                    <item.icon
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-sidebar-accent-foreground" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    {!collapsed ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {count > 0 ? (
                          <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium leading-4 text-primary-foreground">
                            {count}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </>
                );

                const base = cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-muted",
                  item.planned && "cursor-default text-disabled hover:bg-transparent",
                );

                return (
                  <li key={item.label}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        /* Dropping these silently sent two destinations to the
                           same default view — the defect that made Weekly
                           Agenda render the month calendar. */
                        {...(item.search ? { search: item.search } : {})}
                        onClick={onNavigate}
                        className={base}
                        title={item.label}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span
                        className={base}
                        title={`${item.label} — not built in this foundation`}
                        aria-disabled
                      >
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" aria-hidden />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" aria-hidden />
            )}
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
