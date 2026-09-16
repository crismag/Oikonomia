import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, UserX } from "lucide-react";

import { AccessNotice } from "@/components/oikonomia/access";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { ActivityTimeline } from "@/components/oikonomia/activity";
import { DetailHeader, DetailLayout, Page, RailBlock } from "@/components/oikonomia/page";
import { PersonAvatar } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { StatusBadge, kindLabel } from "@/components/oikonomia/status";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useQuery } from "@tanstack/react-query";

import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { useReports } from "@/components/oikonomia/report-provider";
import { fetchAssignments } from "@/lib/organization-api";
import { fetchReachOut, type ReportPage } from "@/lib/reach-out-api";
import { fetchNotes, type NotePage } from "@/lib/meeting-api";
import { noteTypeLabel } from "@/domain/meeting";
import { shortDayLabel } from "@/domain/schedule";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { assignmentSentence, type Assignment } from "@/domain/assignment";
import { useWorkList } from "@/components/oikonomia/work-provider";
import {
  attendanceHistory,
  dayLabel,
  gatheringHeadline,
  leadsGathering,
  venueName,
} from "@/domain/lifegroup";
import { reportStatusLabel } from "@/domain/leadership-report";
import { useViewer } from "@/domain/session";

export const Route = createFileRoute("/people/$personId")({
  loader: ({ params }) => ({ personId: params.personId }),
  head: () => ({ meta: [{ title: "Person — Oikonomia" }] }),
  component: PersonDetail,
});

/**
 * Person detail is contextual, not a database form dump.
 *
 * Everything below the identity block is a *projection* owned by another
 * module, and each projection is filtered through access policy — a directory
 * permission is not permission to see everything attached to a person.
 */
function PersonDetail() {
  const { campuses, ministries, people, personById, venues } = useOrganization();
  const { personId } = Route.useLoaderData();
  const { persona, person: viewer } = useViewer();
  const lifegroupStore = useLifegroup();
  const workList = useWorkList();
  const reports = useReports();
  const { reachOut, meetingNotes } = useWrittenBy(personId);

  /* Whether this person exists is the directory's answer, and the directory is
     loaded rather than compiled in — so it is checked here rather than in a
     loader that runs before anything has been fetched. */
  const person = people.find((p) => p.id === personId);
  if (!person) {
    return (
      <Page>
        <EmptyState icon={UserX} title="No such person">
          Nobody with that id is in the directory. They may have been removed.
        </EmptyState>
      </Page>
    );
  }

  const campus = campuses.find((c) => c.id === person.campusId);
  /* Derived rather than stored: who reports to somebody is the other side of
     the line they each carry, and storing it twice is how the two disagree. */
  const oversees = people.filter((other) => other.reportsToId === person.id);
  const memberships = person.ministryIds
    .map((id) => ministries.find((m) => m.id === id))
    .filter((m) => m !== undefined);

  /* Work this viewer may already read — the service filtered it. What is
     added here is only "does it involve this person". */
  const related = workList.work
    .map((work) => ({ work, access: resolveAccess(persona, viewer, work.policy) }))
    .filter(
      ({ work }) =>
        work.ownerId === person.id ||
        work.assigneeIds.includes(person.id) ||
        work.reviewerIds.includes(person.id) ||
        work.participantIds.includes(person.id),
    );

  const readable = related.filter(
    ({ access }) => access.level === "full" || access.level === "limited",
  );
  const withheldCount = related.length - readable.length;

  /* Where this person has actually been. LifeGroup owns these records; People
     never keeps its own copy, and a history is never a group assignment. */
  const attended = attendanceHistory(
    lifegroupStore.gatherings,
    lifegroupStore.attendance,
    person.id,
  )
    .filter(({ record }) => record.status === "present")
    .slice(0, 6);

  /*
   * Only what this viewer may already discover. A person page is not a back
   * door into reports whose audience does not include the reader — `visible`
   * is the service's list, and we only ask "did they write it?".
   */
  const theirReports = reports.visible
    .filter((report) => report.authorId === person.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  const theyLead = [...lifegroupStore.gatherings]
    .filter((gathering) => leadsGathering(gathering, person.id) && gathering.status !== "cancelled")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  return (
    <Page>
      <Link
        to="/people"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        People
      </Link>

      <DetailHeader
        title={person.name}
        meta={
          <>
            <span className="inline-flex items-center gap-2">
              <PersonAvatar personId={person.id} size="sm" />
              {person.role}
            </span>
            {campus ? <span>{campus.name}</span> : null}
          </>
        }
      />

      <DetailLayout
        rail={
          <>
            <RailBlock label="Ministries">
              {memberships.length > 0 ? (
                <ul className="space-y-1.5 text-[13px]">
                  {memberships.map((ministry) => (
                    <li key={ministry.id}>
                      <Link
                        to="/ministries/$ministryId"
                        params={{ ministryId: ministry.id }}
                        className="transition-colors hover:text-primary"
                      >
                        {ministry.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">No ministry membership.</p>
              )}
            </RailBlock>

            <Responsibilities personId={person.id} />

            <RailBlock label="Reporting">
              <p className="text-[13px]">
                {person.reportsToId ? (
                  <>
                    Reports to{" "}
                    <Link
                      to="/people/$personId"
                      params={{ personId: person.reportsToId }}
                      className="transition-colors hover:text-primary"
                    >
                      {personById(person.reportsToId).name}
                    </Link>
                  </>
                ) : (
                  <span className="text-muted-foreground">No reporting leader recorded.</span>
                )}
              </p>
              {oversees.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {oversees.map((other) => (
                    <li key={other.id}>
                      <Link
                        to="/people/$personId"
                        params={{ personId: other.id }}
                        className="transition-colors hover:text-primary"
                      >
                        {other.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </RailBlock>

            <RailBlock label="Campus">
              <p className="text-[13px]">{campus?.name ?? "Unassigned"}</p>
            </RailBlock>
          </>
        }
      >
        {withheldCount > 0 ? (
          <AccessNotice
            decision={{
              level: "limited",
              rationale: `${withheldCount} related ${withheldCount === 1 ? "record is" : "records are"} closed to you and not listed`,
              restrictedSections: [],
            }}
          />
        ) : null}

        <Section title="Work and reports" meta={`${readable.length}`}>
          {readable.length > 0 ? (
            <ul className="divide-y divide-border">
              {readable.map(({ work }) => (
                <li key={work.id} className="row-quiet">
                  <Link
                    to="/work/$workId"
                    params={{ workId: work.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{work.subject}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {kindLabel[work.kind]} · {work.contextLabel}
                      </span>
                    </span>
                    <StatusBadge status={work.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              No work you can see involves this person.
            </p>
          )}
        </Section>

        {theirReports.length > 0 ? (
          <Section title="Leadership reports" meta={`${theirReports.length}`}>
            <ul className="divide-y divide-border">
              {theirReports.map((report) => (
                <li key={report.id} className="row-quiet">
                  <Link
                    to="/leadership-reports/$reportId"
                    params={{ reportId: report.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">
                        {report.title || "Untitled report"}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {report.reportingPeriod ?? "No period set"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {reportStatusLabel[report.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {reachOut.length > 0 ? (
          <Section title="Reach-Out" meta={`${reachOut.length}`}>
            <ul className="divide-y divide-border">
              {reachOut.map((report) => (
                <li key={report.id} className="row-quiet">
                  <Link
                    to="/reach-out/$reportId"
                    params={{ reportId: report.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">
                        {report.title || "Untitled report"}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {report.authorId === person.id ? "Wrote it" : "Worked on it"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {shortDayLabel(report.reportDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {meetingNotes.length > 0 ? (
          <Section title="Meeting notes" meta={`${meetingNotes.length}`}>
            <ul className="divide-y divide-border">
              {meetingNotes.map((note) => (
                <li key={note.id} className="row-quiet">
                  <Link
                    to="/meeting-notes"
                    search={{ note: note.id }}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">
                        {note.title || "Untitled note"}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {noteTypeLabel[note.noteType]}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {shortDayLabel(note.date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {theyLead.length > 0 ? (
          <Section title="Gatherings they lead" meta={`${theyLead.length}`}>
            <ul className="divide-y divide-border">
              {theyLead.map((gathering) => (
                <li key={gathering.id} className="px-4 py-2.5">
                  <Link
                    to="/lifegroups/$gatheringId"
                    params={{ gatheringId: gathering.id }}
                    className="text-[14px] transition-colors hover:text-primary"
                  >
                    {gatheringHeadline(venues, gathering)}
                  </Link>
                  <p className="text-[12px] text-muted-foreground">{dayLabel(gathering.date)}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {attended.length > 0 ? (
          <Section title="Gatherings attended">
            <ul className="divide-y divide-border">
              {attended.map(({ gathering }) => (
                <li key={gathering.id} className="px-4 py-2.5">
                  <Link
                    to="/lifegroups/$gatheringId"
                    params={{ gatheringId: gathering.id }}
                    className="text-[14px] transition-colors hover:text-primary"
                  >
                    {venueName(venues, gathering)}
                  </Link>
                  <p className="text-[12px] text-muted-foreground">{dayLabel(gathering.date)}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Activity">
          <div className="px-4 py-3.5">
            <ActivityTimeline
              entries={readable
                .flatMap(({ work }) => work.activity.filter((a) => a.actorId === person.id))
                .slice(0, 6)}
            />
            {readable.every(({ work }) => work.activity.every((a) => a.actorId !== person.id)) ? (
              <p className="text-[13px] text-muted-foreground">
                No activity you are authorised to see.
              </p>
            ) : null}
          </div>
        </Section>
      </DetailLayout>
    </Page>
  );
}

/** Enough to recognise the pattern of someone's work; the module lists the rest. */
const WRITTEN_BY_LIMIT = 6;

/**
 * Reach-Out and meeting notes this person wrote or worked on.
 *
 * Asked of the server by person rather than filtered from the modules' own
 * lists: those are one page, shaped by whatever the leader last searched, so
 * filtering them here would quietly miss older work. The server applies the
 * same rules as the modules' lists — meeting notes only as far as this viewer
 * may read them, so another leader's personal notes never appear and are not
 * counted. Newest first, and the keys sit under each module's own so a save
 * there refreshes this page too.
 */
function useWrittenBy(personId: string) {
  const reachOutQuery = { personId, page: 1, pageSize: WRITTEN_BY_LIMIT };
  const reachOut = useQuery<ReportPage>({
    queryKey: ["reach-out", reachOutQuery],
    queryFn: async () => unwrap(await withTimeout(fetchReachOut({ data: reachOutQuery }))),
    retry: 1,
    networkMode: "always",
  });

  const notesQuery = { personId, page: 1, pageSize: WRITTEN_BY_LIMIT };
  const meetingNotes = useQuery<NotePage>({
    queryKey: ["meeting-notes", notesQuery],
    queryFn: async () => unwrap(await withTimeout(fetchNotes({ data: notesQuery }))),
    retry: 1,
    networkMode: "always",
  });

  return {
    reachOut: reachOut.data?.reports ?? [],
    meetingNotes: meetingNotes.data?.notes ?? [],
  };
}

/**
 * Where this person serves, and on whose authority.
 *
 * Shows **everything** — confirmed, claimed, corrections asked for, and what
 * has ended — because the interesting question about an assignment is often
 * its state rather than its existence. A claim nobody has confirmed reads as a
 * claim; an assignment that is over reads as history rather than disappearing.
 *
 * Read-only here. Confirming is an access decision and lives in Administration.
 */
function Responsibilities({ personId }: { personId: string }) {
  const organization = useOrganization();

  const query = useQuery<Assignment[]>({
    queryKey: ["assignments", personId],
    queryFn: async () => unwrap(await withTimeout(fetchAssignments({ data: { personId } }))),
    retry: 1,
    networkMode: "always",
  });

  const assignments = query.data ?? [];
  if (assignments.length === 0) return null;

  const nameOf = (assignment: Assignment) =>
    assignment.scope === "ministry"
      ? (organization.ministryById(assignment.targetId)?.name ?? "A ministry")
      : (organization.groupById(assignment.targetId)?.name ?? "A group");

  return (
    <RailBlock label="Responsibilities">
      <ul className="space-y-1.5 text-[13px]">
        {assignments.map((assignment) => (
          <li key={`${assignment.scope}-${assignment.targetId}`}>
            {assignmentSentence(assignment, nameOf(assignment))}
          </li>
        ))}
      </ul>
    </RailBlock>
  );
}
