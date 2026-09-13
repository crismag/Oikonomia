import { useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarContent } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { ErrorState, ListSkeleton } from "./async-state";
import { ScheduleProvider } from "./schedule-provider";
import { GoalsProvider } from "./goals-provider";
import { FormsProvider } from "./forms-provider";
import { LifegroupProvider } from "./lifegroup-provider";
import { MeetingProvider } from "./meeting-provider";
import { ReachOutProvider } from "./reach-out-provider";
import { ReportProvider } from "./report-provider";
import { useOrganization } from "./organization-provider";
import { ViewerContext } from "@/domain/session";
import { cn } from "@/lib/utils";

/**
 * Routes that are the way *in* to the application rather than part of it.
 *
 * They draw their own frame: a sign-in page inside the application chrome would
 * be showing somebody a sidebar full of destinations they cannot yet reach.
 */
const OUTSIDE_THE_APPLICATION = ["/login", "/setup"];

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const organization = useOrganization();

  if (OUTSIDE_THE_APPLICATION.some((route) => pathname.startsWith(route))) {
    return (
      <div className="min-h-[calc(100vh-var(--demo-bar))] w-full bg-background">{children}</div>
    );
  }

  /*
   * Nothing inside the application renders without a viewer.
   *
   * Every page names people, scopes lists and resolves access against "who is
   * this?", so drawing the shell before that is known would mean drawing it
   * for nobody. Two different nobodies exist and they are not the same
   * problem: an installation nobody has set up needs a first person, and a
   * browser nobody has signed in on needs a sign-in.
   */
  if (organization.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (organization.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorState title="Oikonomia could not be reached" onRetry={organization.retry}>
          Nothing is lost. This is a problem reaching the server.
        </ErrorState>
      </div>
    );
  }

  if (organization.setupRequired) {
    return <Redirect to="/setup" />;
  }

  /*
   * Nobody signed in goes to the way in.
   *
   * This used to sign the browser in as the first person in the directory — a
   * development convenience from when there was no authentication backend to
   * bypass. There is one now, so the convenience became a hole: it granted an
   * identity to anybody who loaded the page.
   *
   * **This redirect is not the security boundary.** Every server function
   * resolves the principal itself and refuses independently; removing this
   * would make the application unusable, not insecure.
   */
  if (!organization.viewer) {
    return <Redirect to="/login" />;
  }

  /*
   * First arrival goes to setup — once, and from Home only.
   *
   * From Home only, because a redirect on every route is how an onboarding
   * flow becomes a trap: `/welcome` is itself inside this shell, and somebody
   * who chooses "Save and exit" has to land somewhere that lets them stay.
   * They are asked again next time they open Home, which is the right amount
   * of insistence for something they may legitimately defer.
   */
  if (organization.onboardingRequired && pathname === "/") {
    return <Redirect to="/welcome" />;
  }

  const viewer = organization.viewer;

  return (
    <ViewerContext.Provider value={viewer}>
      <ModuleProviders>
        <div className="flex min-h-[calc(100vh-var(--demo-bar))] w-full bg-background">
          {/* Desktop / tablet rail — collapses to icons, never disappears */}
          <aside
            data-print="hide"
            className={cn(
              "sticky top-[var(--demo-bar)] hidden h-[calc(100vh-var(--demo-bar))] shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:block",
              collapsed ? "w-14" : "w-60",
            )}
          >
            <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          </aside>

          {/* Mobile drawer */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar onOpenNav={() => setMobileOpen(true)} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </ModuleProviders>
    </ViewerContext.Provider>
  );
}

/**
 * Take the first person in the directory, so a page can be opened directly.
 *
 * Signing in is a cookie write plus a refetch, so this is exactly what
 * clicking that person on `/login` would have done — done for you. It renders
 * a skeleton for the moment it takes, and nothing at all if the directory
 * somehow came back empty (the setup gate above would have caught that).
 */
/**
 * Leave for somewhere else, without rendering anything on the way.
 *
 * A full navigation rather than a client-side one: signing in changes who
 * every query in the application is for, and starting again is both simpler
 * and more honest than refreshing them one by one.
 */
/**
 * The modules, mounted only once there is somebody to mount them for.
 *
 * Each of these loads records **as the signed-in person** — what they may
 * read, what is theirs, what is routed to them. Mounting them above the gate
 * meant asking those questions with no answer to "who?", which is how a
 * sign-in screen ends up issuing a dozen requests for a viewer that does not
 * exist.
 */
function ModuleProviders({ children }: { children: ReactNode }) {
  return (
    <ScheduleProvider>
      <GoalsProvider>
        <FormsProvider>
          <LifegroupProvider>
            <MeetingProvider>
              <ReachOutProvider>
                <ReportProvider>{children}</ReportProvider>
              </ReachOutProvider>
            </MeetingProvider>
          </LifegroupProvider>
        </FormsProvider>
      </GoalsProvider>
    </ScheduleProvider>
  );
}

function Redirect({ to }: { to: string }) {
  if (typeof window !== "undefined" && window.location.pathname !== to) {
    window.location.replace(to);
  }
  return null;
}
