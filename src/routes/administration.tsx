import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { Building2, CircleAlert, Lock, Settings2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader, RailBlock } from "@/components/oikonomia/page";
import { DetailLayout } from "@/components/oikonomia/page";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  administrationSectionFor,
  administrationSections,
  type AdministrationSectionId,
} from "@/domain/administration-sections";
import { useViewer } from "@/domain/session";
import { cn } from "@/lib/utils";

/* Each section is its own chunk, fetched when it is opened. Configuration and
   data care are most of this page's code and most visits are about neither. */
const AssignmentsAdmin = lazy(() =>
  import("@/components/oikonomia/assignments-admin").then((m) => ({ default: m.AssignmentsAdmin })),
);
const InvitePeople = lazy(() =>
  import("@/components/oikonomia/invite-people").then((m) => ({ default: m.InvitePeople })),
);
const OrganizationAdmin = lazy(() =>
  import("@/components/oikonomia/organization-admin").then((m) => ({
    default: m.OrganizationAdmin,
  })),
);
const WorkspaceAdmin = lazy(() =>
  import("@/components/oikonomia/workspace-admin").then((m) => ({ default: m.WorkspaceAdmin })),
);
const DataManagement = lazy(() =>
  import("@/components/oikonomia/data-management").then((m) => ({ default: m.DataManagement })),
);
const ConfigurationAdmin = lazy(() =>
  import("@/components/oikonomia/configuration-admin").then((m) => ({
    default: m.ConfigurationAdmin,
  })),
);

export const Route = createFileRoute("/administration")({
  head: () => ({
    meta: [
      { title: "Administration — Oikonomia" },
      {
        name: "description",
        content:
          "Configuration source, validation and publication — without confidential-content authority.",
      },
    ],
  }),
  component: AdministrationPage,
});

/**
 * Administration.
 *
 * The point this page still makes honestly is the second one: **administrative
 * capability is not confidential-content authority**, and it is shown rather
 * than asserted — the count of records closed to this account is computed with
 * the same rules everything else uses.
 *
 * The first point — that configuration becomes trusted only after
 * validate → version → publish — used to be drawn as a running pipeline with
 * an import time, a failure count and a version number. None of it existed.
 * A page that reports the state of a process nobody runs is worse than a page
 * that says the process is not built, so it now says that.
 */
function AdministrationPage() {
  const { campuses, ministries, people } = useOrganization();
  const { persona, person } = useViewer();
  const workList = useWorkList();

  const configWork = workList.work
    .filter((work) => work.contextLabel.toLowerCase().includes("administration"))
    .map((work) => ({ work, access: resolveAccess(persona, person, work.policy) }))
    .filter(({ access }) => access.level === "full" || access.level === "limited");

  /* The service counted these: records it declined to return to this viewer.
     Counting them in the browser would have meant holding them there first. */
  const closed = workList.withheld;

  return (
    <Page>
      <PageHeader
        title="Administration"
        description="The organisation Oikonomia holds, and what things are called across it."
      />

      <DetailLayout
        rail={
          <>
            <RailBlock label="Organisation">
              <ul className="space-y-1 text-[13px]">
                <li>{campuses.length} campuses</li>
                <li>{ministries.length} ministries</li>
                <li>{people.length} people</li>
              </ul>
            </RailBlock>

            <RailBlock label="Where structure comes from">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Somebody entered it, here. Nothing arrives with the application: a new installation
                has no campuses, no ministries and no people until an administrator adds them. There
                is no import and no publish step yet, so none is shown.
              </p>
            </RailBlock>

            <RailBlock label="What administration is not">
              <p className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {closed} {closed === 1 ? "record is" : "records are"} closed to this account.
                  Managing structure is not permission to read pastoral or leadership content.
                </span>
              </p>
            </RailBlock>
          </>
        }
      >
        {persona.capabilities.includes("administration") ? (
          <AdministrationSections />
        ) : (
          <Section title="The organisation">
            <EmptyState icon={Building2} title="Only an administrator may change this">
              Campuses, ministries and people are entered by an administrator. You can see them
              throughout the binder; changing them is not yours to do.
            </EmptyState>
          </Section>
        )}

        {persona.capabilities.includes("administration") ? null : (
          <>
            <Section title="Configuration">
              <EmptyState icon={Settings2} title="Only an administrator may change this">
                What things are called across Oikonomia is an administrator&apos;s to set.
              </EmptyState>
            </Section>
            <ImportingConfiguration />
          </>
        )}

        {configWork.length > 0 ? (
          <Section title="Needs resolving">
            <ul className="divide-y divide-border">
              {configWork.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  <Link
                    to="/work/$workId"
                    params={{ workId: work.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-status-overdue"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{work.subject}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {work.currentState}
                      </span>
                    </span>
                    <StatusBadge status={work.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </DetailLayout>
    </Page>
  );
}

function ImportingConfiguration() {
  return (
    <Section title="Importing configuration">
      <EmptyState icon={Settings2} title="Importing from a source is not implemented">
        Configuration is edited here and stored in the database. Bringing it in from a file or a
        Drive document — with validation, preview and a publish step — is the intended model and is
        not built, so this page shows no import state and no runtime version.
      </EmptyState>
    </Section>
  );
}

/**
 * One section of Administration at a time, chosen by the address's hash.
 *
 * The hash is read only after hydration: the server never sees it, and
 * rendering a section there would hand the browser a different page from the
 * one its address names. Until then — and while a section's code arrives — a
 * skeleton holds the place.
 */
function AdministrationSections() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const current = hydrated ? administrationSectionFor(hash) : null;

  return (
    <>
      <nav aria-label="Administration sections">
        <ul className="flex flex-wrap gap-1.5">
          {administrationSections.map((section) => (
            <li key={section.id}>
              <Link
                to="/administration"
                hash={section.id}
                aria-current={current === section.id ? "page" : undefined}
                className={cn(
                  "inline-flex rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground",
                  current === section.id &&
                    "border-transparent bg-area text-on-area hover:text-on-area",
                )}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {current ? (
        <Suspense key={current} fallback={<SectionSkeleton />}>
          <OpenSection id={current} />
        </Suspense>
      ) : (
        <SectionSkeleton />
      )}
    </>
  );
}

function OpenSection({ id }: { id: AdministrationSectionId }): ReactNode {
  switch (id) {
    case "assignments":
      return <AssignmentsAdmin />;
    case "invite":
      return <InvitePeople />;
    case "people":
    case "campuses":
    case "ministries":
    case "groups":
    case "venues":
      return <OrganizationAdmin part={id} />;
    case "google-workspace":
      return <WorkspaceAdmin />;
    case "data":
      return (
        <div id="data" className="scroll-mt-4">
          <DataManagement />
        </div>
      );
    case "configuration":
      return (
        <div id="configuration" className="scroll-mt-4 space-y-5">
          <ConfigurationAdmin />
          <ImportingConfiguration />
        </div>
      );
  }
}

function SectionSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading this section"
      className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
