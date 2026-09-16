import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";

import { useOrganization } from "./organization-provider";
import { useViewer } from "@/domain/session";
import { GlobalSearch } from "./global-search";
import { NoticesBell } from "./notices-bell";
import { AccountMenu } from "./account-menu";
import { areaLabelFor } from "./nav";

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { campuses } = useOrganization();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { person } = useViewer();
  const campus = campuses.find((c) => c.id === person.campusId);

  const page = areaLabelFor(pathname);

  return (
    <header
      data-print="hide"
      className="sticky top-[var(--demo-bar)] z-20 border-b border-border bg-surface/95 backdrop-blur-sm"
    >
      <div className="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted lg:hidden"
          >
            <Menu className="size-4" aria-hidden />
          </button>
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground sm:flex"
          >
            <span className="truncate">{campus?.name ?? "All campuses"}</span>
            <span aria-hidden>/</span>
            <span className="truncate font-medium text-foreground">{page}</span>
          </nav>
        </div>

        <GlobalSearch />

        <div className="flex shrink-0 items-center gap-2">
          <NoticesBell />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
