import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronsUpDown, ChevronUp, Info, UserPlus } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/oikonomia/auth-provider";
import { DemoInformation } from "@/components/oikonomia/demo-information";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { countdown } from "@/domain/refresh-schedule";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { enterDemoAs, fetchDemoEntry } from "@/lib/demo-api";
import { notify } from "@/config";

/**
 * The one thing that tells somebody this is a demonstration.
 *
 * A thin bar above everything — sign-in, setup, every page — rather than a
 * banner that shouts. It says whose eyes they are looking through, lets them
 * change that, and says when the demonstration returns to its original data.
 * Everything else about the application is left exactly as it is.
 *
 * Drawn only when the server says this installation is a demonstration.
 *
 * ## Why the height is a variable
 *
 * The sidebar and the top bar are sticky at the top of the viewport. With a
 * bar above them they must stick below it instead, so the bar's height is
 * published as `--demo-bar` on the document and they read it. On an ordinary
 * installation nothing sets it, and it is 0.
 */

const BAR_HEIGHT = "2.25rem";
const COLLAPSED_KEY = "oikonomia.demo-bar.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* A browser that will not remember simply shows the bar open next time. */
  }
}

export function DemoHeader() {
  const { installation } = useAuth();
  if (!installation.demo) return null;
  return <DemoBar />;
}

function DemoBar() {
  const organization = useOrganization();
  const viewer = organization.viewer;
  const [collapsed, setCollapsed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const entry = useQuery({
    queryKey: ["demo-entry"],
    queryFn: async () => unwrap(await withTimeout(fetchDemoEntry({ data: undefined }))),
    staleTime: 30_000,
  });

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--demo-bar", BAR_HEIGHT);
    return () => {
      document.documentElement.style.removeProperty("--demo-bar");
    };
  }, []);

  useEffect(() => setCollapsed(readCollapsed()), []);

  /* A countdown in minutes needs no finer tick than this. */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = entry.data?.refresh ?? null;
  const refreshAt = refresh ? new Date(refresh.at).getTime() : null;

  /* Once the refresh time has passed, ask again for the next one. */
  const { refetch } = entry;
  useEffect(() => {
    if (refreshAt !== null && now >= refreshAt) void refetch();
  }, [now, refreshAt, refetch]);

  const remaining = refreshAt === null ? null : countdown(refreshAt - now);
  const identities = entry.data?.identities ?? [];

  const toggle = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  const switchTo = async (identityId: string) => {
    setSwitching(true);
    try {
      unwrap(await withTimeout(enterDemoAs({ data: { identityId } })));
      window.location.assign("/");
    } catch (error) {
      setSwitching(false);
      notify.error("common.save.error", undefined, errorMessage(error));
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label="Demonstration"
        data-print="hide"
        style={{ height: BAR_HEIGHT }}
        className="sticky top-0 z-40 flex w-full items-center gap-2 border-b border-status-waiting/30 bg-status-waiting-soft px-3 text-[12px] text-foreground sm:gap-3 sm:px-4"
      >
        <span className="rounded-sm bg-status-waiting px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white">
          DEMO
        </span>

        {collapsed ? null : viewer ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={switching}
              className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-status-waiting/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate font-medium">{viewer.person.name}</span>
              <span className="hidden truncate text-muted-foreground sm:inline">
                — {viewer.persona.label}
              </span>
              <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Explore as somebody else</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
                Explore as
              </DropdownMenuLabel>
              {identities.map((identity) => (
                <DropdownMenuItem
                  key={identity.id}
                  disabled={identity.current || switching}
                  onSelect={() => void switchTo(identity.id)}
                  className="py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{identity.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[identity.title, identity.role].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {identity.current ? <Check className="size-3.5" aria-label="Current" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.location.assign("/login")} className="py-2">
                <UserPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-[13px]">Try it as yourself…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="hidden text-muted-foreground sm:inline">
            A shared, interactive demonstration
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {remaining ? (
            <span title={refresh ? refreshedAt(refresh.at, refresh.timeZone) : undefined}>
              <span className="hidden sm:inline">Refreshes in </span>
              <span className="font-medium tabular-nums">{remaining}</span>
            </span>
          ) : null}

          {collapsed ? null : (
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-status-waiting/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">About this demo</span>
              <span className="sr-only sm:hidden">About this demo</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            className="rounded p-0.5 hover:bg-status-waiting/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {collapsed ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronUp className="size-3.5" aria-hidden />
            )}
            <span className="sr-only">{collapsed ? "Show demo details" : "Hide demo details"}</span>
          </button>
        </span>
      </div>

      <DemoInformation
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        viewer={viewer ? { name: viewer.person.name, role: viewer.persona.label } : null}
        refresh={refresh}
        remaining={remaining}
        visitorsWelcome={entry.data?.visitorsWelcome ?? false}
      />
    </>
  );
}

/** "Refreshes at 12:00 PM EDT", on the church's own clock. */
function refreshedAt(at: string, timeZone: string): string {
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(at));
  return `Refreshes at ${time}`;
}
