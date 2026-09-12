import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";

import { AccessNotice } from "@/components/oikonomia/access";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge } from "@/components/oikonomia/status";
import { FilterChip } from "@/components/oikonomia/list-toolbar";
import { isOpenWork } from "@/domain/work";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useViewer } from "@/domain/session";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { useWorkList } from "@/components/oikonomia/work-provider";
import { dayLabel } from "@/domain/lifegroup";
import { occurrencesOn, formatTime, shortDayLabel, toISO } from "@/domain/schedule";
import { addDays } from "date-fns";

export const Route = createFileRoute("/campuses")({
  head: () => ({
    meta: [
      { title: "Campuses — Oikonomia" },
      {
        name: "description",
        content:
          "Campus context: leadership, ministries, current exceptions and upcoming activity.",
      },
    ],
  }),
  component: CampusesPage,
});

/**
 * Campus oversight without becoming a BI dashboard.
 *
 * CAMPUSES.md is explicit that this page prioritises operational exceptions and
 * current work over comparison charts, and that campus membership never opens
 * content governed by its own audience.
 */
function CampusesPage() {
  const { campuses, ministries, people, venues } = useOrganization();
  const { persona, person } = useViewer();
  const lifegroup = useLifegroup();
  const workList = useWorkList();
  const [campusId, setCampusId] = useState<string>(campuses[0]?.id ?? "");
  /* Upcoming reads the one Schedule rather than a second calendar. */
  const { entries } = useSchedule();

  const campus = campuses.find((c) => c.id === campusId);
  if (!campus) {
    /* An installation with no campuses is not a broken page. Somebody has to
       add the first one, and until they do there is no campus to be at. */
    return (
      <Page>
        <PageHeader
          title="Campuses"
          description="Organisational context for a campus. Switching campus changes scope, never confidentiality."
        />
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={Building2} title="No campuses yet">
            An administrator adds campuses in Administration. Ministries and people are filed under
            one, so this page has something to show once the first exists.
          </EmptyState>
        </div>
      </Page>
    );
  }

  const upcoming = Array.from({ length: 10 }, (_, i) => toISO(addDays(new Date(), i)))
    .flatMap((iso) => occurrencesOn(entries, iso))
    .slice(0, 4);

  const campusMinistries = ministries.filter((m) => m.campusId === campus.id);
  const leaders = people.filter(
    (p) => p.campusId === campus.id && p.role.toLowerCase().includes("lead"),
  );

  const scoped = workList.work
    .filter((work) => work.campusId === campus.id)
    .map((work) => ({ work, access: resolveAccess(persona, person, work.policy) }));
  const readable = scoped.filter(
    ({ access }) => access.level === "full" || access.level === "limited",
  );
  const withheld = scoped.length - readable.length;

  /* What is still going on, asked of the stage's behaviour rather than of a
     list of its names. */
  const exceptions = readable.filter(({ work }) => isOpenWork(work.status));

  /* Real marks, made at real gatherings. A campus with none shows none rather
     than a plausible number. */
  const recent = lifegroup.gatherings
    .filter((gathering) => gathering.campusId === campus.id)
    .map((gathering) => ({
      gathering,
      present: lifegroup.attendance.filter(
        (mark) => mark.gatheringId === gathering.id && mark.status === "present",
      ).length,
      marked: lifegroup.attendance.filter((mark) => mark.gatheringId === gathering.id).length,
    }))
    .filter((occasion) => occasion.marked > 0)
    .sort((a, b) => b.gathering.date.localeCompare(a.gathering.date))
    .slice(0, 3);

  return (
    <Page>
      <PageHeader
        title="Campuses"
        description="Organisational context for a campus. Switching campus changes scope, never confidentiality."
      >
        <div className="mt-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-1.5">
            {campuses.map((option) => (
              <FilterChip
                key={option.id}
                active={option.id === campusId}
                onClick={() => setCampusId(option.id)}
              >
                {option.name}
              </FilterChip>
            ))}
          </div>
        </div>
      </PageHeader>

      {withheld > 0 ? (
        <div className="mb-4">
          <AccessNotice
            decision={{
              level: "limited",
              rationale: `${withheld} campus ${withheld === 1 ? "record is" : "records are"} governed by their own audience and not listed`,
              restrictedSections: [],
            }}
          />
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title="Needs attention"
          meta={exceptions.length > 0 ? `${exceptions.length}` : undefined}
          className="lg:col-span-2"
        >
          {exceptions.length > 0 ? (
            <ul className="divide-y divide-border">
              {exceptions.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  <Link
                    to="/work/$workId"
                    params={{ workId: work.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{work.subject}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {work.contextLabel}
                      </span>
                    </span>
                    <StatusBadge status={work.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing open at {campus.name} that you can see.
            </p>
          )}
        </Section>

        <Section title="Ministries" meta={`${campusMinistries.length}`}>
          <ul className="divide-y divide-border">
            {campusMinistries.map((ministry) => (
              <li key={ministry.id} className="row-quiet">
                <Link
                  to="/ministries/$ministryId"
                  params={{ ministryId: ministry.id }}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <PersonAvatar personId={ministry.leadId} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{ministry.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      <PersonName personId={ministry.leadId} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Leadership">
          <ul className="divide-y divide-border">
            {leaders.map((leader) => (
              <li key={leader.id} className="row-quiet">
                <Link
                  to="/people/$personId"
                  params={{ personId: leader.id }}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <PersonAvatar personId={leader.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{leader.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {leader.role}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Upcoming">
          <ul className="divide-y divide-border">
            {upcoming.map((occurrence) => (
              <li key={occurrence.key} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="w-24 shrink-0 truncate text-[12px] text-muted-foreground">
                  {shortDayLabel(occurrence.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {occurrence.entry.title}
                  <span className="text-muted-foreground">
                    {formatTime(occurrence.entry.startTime)
                      ? ` · ${formatTime(occurrence.entry.startTime)}`
                      : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recent attendance">
          {recent.length > 0 ? (
            <ul className="divide-y divide-border">
              {recent.map(({ gathering, present, marked }) => (
                <li
                  key={gathering.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">
                      {gathering.venueName ??
                        venues.find((v) => v.id === gathering.venueId)?.name ??
                        "LifeGroup gathering"}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {dayLabel(gathering.date)} · {marked} marked
                    </span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium tabular-nums">{present}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Nothing has been marked at this campus yet.
            </p>
          )}
        </Section>
      </div>
    </Page>
  );
}
