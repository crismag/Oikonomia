import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, CircleAlert, Lock, Settings2 } from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader, RailBlock } from "@/components/oikonomia/page";
import { DetailLayout } from "@/components/oikonomia/page";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { AssignmentsAdmin } from "@/components/oikonomia/assignments-admin";
import { InvitePeople } from "@/components/oikonomia/invite-people";
import { DataManagement } from "@/components/oikonomia/data-management";
import { OrganizationAdmin } from "@/components/oikonomia/organization-admin";
import { WorkspaceAdmin } from "@/components/oikonomia/workspace-admin";
import { ConfigurationAdmin } from "@/components/oikonomia/configuration-admin";
import { useViewer } from "@/domain/session";

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
          <>
            <AssignmentsAdmin />
            <InvitePeople />
            <OrganizationAdmin />
            <WorkspaceAdmin />
            <DataManagement />
          </>
        ) : (
          <Section title="The organisation">
            <EmptyState icon={Building2} title="Only an administrator may change this">
              Campuses, ministries and people are entered by an administrator. You can see them
              throughout the binder; changing them is not yours to do.
            </EmptyState>
          </Section>
        )}

        {persona.capabilities.includes("administration") ? (
          <ConfigurationAdmin />
        ) : (
          <Section title="Configuration">
            <EmptyState icon={Settings2} title="Only an administrator may change this">
              What things are called across Oikonomia is an administrator&apos;s to set.
            </EmptyState>
          </Section>
        )}

        <Section title="Importing configuration">
          <EmptyState icon={Settings2} title="Importing from a source is not implemented">
            Configuration is edited here and stored in the database. Bringing it in from a file or a
            Drive document — with validation, preview and a publish step — is the intended model and
            is not built, so this page shows no import state and no runtime version.
          </EmptyState>
        </Section>

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
