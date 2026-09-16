import { config } from "@/config";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import {
  Ban,
  BookOpen,
  ChevronLeft,
  Lock,
  MapPin,
  Pencil,
  Printer,
  RotateCcw,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { GatheringEditor } from "@/components/oikonomia/gathering-editor";
import { LifegroupEntryList, NewEntry } from "@/components/oikonomia/lifegroup-entry";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { GatheringReports } from "@/components/oikonomia/gathering-report";
import { useOverlay } from "@/components/oikonomia/overlay";
import { Page } from "@/components/oikonomia/page";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { canAmendGathering, canCancelGathering, canJoinGathering } from "@/domain/authorize";
import { Combobox } from "@/components/oikonomia/combobox";
import { useConfirm } from "@/config/messages/handlers";
import { errorMessage } from "@/lib/calendar-client";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { Section } from "@/components/oikonomia/section";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import {
  attendanceFor,
  attendanceStatusLabel,
  attendanceTally,
  attendeeLabel,
  awaitingMark,
  composeReport,
  dayLabel,
  exhortationFor,
  gatheringStatusLabel,
  isReported,
  leadsGathering,
  myAction,
  myActionLabel,
  outstanding,
  reportFor,
  venueFor,
  venueName,
} from "@/domain/lifegroup";
import { useViewer } from "@/domain/session";
import type { AttendanceStatus, Gathering, GatheringAttendance } from "@/domain/types";

export const Route = createFileRoute("/lifegroups/$gatheringId")({
  validateSearch: (search: Record<string, unknown>): { print?: true } =>
    search["print"] ? { print: true } : {},
  head: () => ({ meta: [{ title: "Gathering — Oikonomia" }] }),
  component: GatheringWorkspace,
});

/**
 * The gathering workspace.
 *
 * This is the leader's working page for one occurrence: who came, what was
 * taught, what was shared, what needs following up, and a summary. It is
 * deliberately a single scrolling sheet rather than a set of tabs — the leader
 * is filling in a binder page, not navigating an application.
 */
function GatheringWorkspace() {
  const { personById, venues } = useOrganization();
  const { gatheringId } = Route.useParams();
  const { print } = Route.useSearch();
  const viewer = useViewer();
  const { person } = viewer;
  const store = useLifegroup();
  const amending = useOverlay<true>();
  const confirm = useConfirm();
  const [failure, setFailure] = useState<unknown>(null);

  const gathering = store.gatherings.find((g) => g.id === gatheringId);

  /*
   * Absent is not the same as missing while the book is still loading. A 404
   * on the first render is a gathering that exists reported as gone.
   */
  if (!gathering && store.status === "loading") {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (!gathering && store.status === "error") {
    return (
      <Page>
        <ErrorState title="This gathering could not be loaded" onRetry={store.retry}>
          Your records are safe. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }
  if (!gathering) throw notFound();

  const isAssignedLeader = leadsGathering(gathering, person.id);
  /* Every leader reads ordinary LifeGroup material; this page is leadership-facing. */
  const context = { isLeader: true, isAssignedLeader };
  const cancelled = gathering.status === "cancelled";
  /* A cancelled gathering did not happen: nothing is recorded on it until it
     is restored, which is also what the server holds to. */
  const canEdit = isAssignedLeader && !cancelled;
  const mayCancel = canCancelGathering(viewer, gathering);
  const joinAction = myAction(gathering, person.id, canJoinGathering(viewer, gathering));

  const attempt = (work: () => Promise<void>) => {
    setFailure(null);
    void work().catch(setFailure);
  };

  const cancel = async () => {
    if (!(await confirm("lifegroup.cancel.confirm", { day: dayLabel(gathering.date) }))) return;
    attempt(() => store.cancelGathering(gathering.id));
  };

  if (print) return <PrintSheet gathering={gathering} context={context} viewerId={person.id} />;

  const venue = venueFor(venues, gathering);
  const missing = outstanding(gathering, store.attendance, store.exhortations);
  const done = isReported(gathering, store.reports);

  return (
    <Page>
      <Link
        to="/lifegroups"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        LifeGroup
      </Link>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">
            {dayLabel(gathering.date)}
            {gathering.startTime ? ` · ${gathering.startTime}` : ""}
            {gathering.endTime ? `–${gathering.endTime}` : ""}
          </p>
          <h1 className="mt-0.5 flex items-center gap-2 font-display text-[26px] leading-tight">
            <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            {venueName(venues, gathering)}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {gathering.assignedLeaderIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1.5">
                  <PersonAvatar personId={id} size="sm" />
                  <PersonName personId={id} />
                </span>
              ))}
            </span>
            {venue?.hostId ? (
              <span>
                Hosted by <PersonName personId={venue.hostId} />
              </span>
            ) : null}
            <span className={cn(cancelled && "font-medium text-foreground")}>
              {gatheringStatusLabel[gathering.status]}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/*
           * Amending is when, where and who — a different right from recording
           * what happened, which stays with the leader who was there. Campus
           * oversight may move a gathering without being able to mark its
           * attendance.
           */}
          {/* Taking the gathering on from its own page, not only from the roster. */}
          {joinAction === "claim" || joinAction === "join" ? (
            <Button
              type="button"
              variant="primary"
              disabled={store.saving}
              onClick={() => attempt(() => store.joinGathering(gathering.id, joinAction))}
            >
              <UserPlus className="size-3.5" aria-hidden />
              {myActionLabel[joinAction]}
            </Button>
          ) : null}
          {canAmendGathering(viewer, gathering) && !cancelled ? (
            <Button type="button" variant="secondary" onClick={() => amending.open(true)}>
              <Pencil className="size-3.5" aria-hidden />
              Edit details
            </Button>
          ) : null}
          {mayCancel && cancelled ? (
            <Button
              type="button"
              variant="secondary"
              disabled={store.saving}
              onClick={() => attempt(() => store.restoreGathering(gathering.id))}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Restore gathering
            </Button>
          ) : null}
          {mayCancel && !cancelled ? (
            <Button
              type="button"
              variant="ghost"
              disabled={store.saving}
              onClick={() => void cancel()}
            >
              <Ban className="size-3.5" aria-hidden />
              Cancel gathering
            </Button>
          ) : null}
          <Link
            to="/lifegroups/$gatheringId"
            params={{ gatheringId: gathering.id }}
            search={{ print: true as const }}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Printer className="size-3.5" aria-hidden />
            Printable view
          </Link>
        </div>
      </header>

      {failure ? (
        <p role="alert" className="mb-3 text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      {cancelled ? (
        <p className="mb-4 rounded-md border border-border bg-surface-muted px-4 py-3 text-[13px] text-muted-foreground">
          This gathering was cancelled. It stays on the schedule as a record and asks nobody for a
          report.
          {mayCancel ? " Restore it if it is going ahead after all." : ""}
        </p>
      ) : null}

      <div className="space-y-4">
        <AttendanceEditor gathering={gathering} canEdit={canEdit} />
        <ExhortationEditor gathering={gathering} canEdit={canEdit} />

        <Section title="Sharing and notes">
          <LifegroupEntryList gatheringId={gathering.id} viewerId={person.id} context={context} />
          {canEdit ? <NewEntry gatheringId={gathering.id} authorId={person.id} /> : null}
        </Section>

        <SummaryAndComplete gathering={gathering} canEdit={canEdit} missing={missing} done={done} />

        {/*
         * What belongs outside the gathering's shared notes: a concern, a
         * follow-up, something one or two people should read. It is written as
         * a report, kept with the leader's other reports, and this gathering
         * is only where it came from.
         */}
        <GatheringReports gatheringId={gathering.id} gatheringLabel={dayLabel(gathering.date)} />

        {/*
         * Completing a gathering does not send it anywhere to be reviewed. If
         * the evening produced something leadership has to know, decide or do,
         * the leader says so here — and only that reaches an inbox.
         */}
        <EscalationControl
          sourceType="gathering"
          sourceId={gathering.id}
          contextLabel={`LifeGroup · ${dayLabel(gathering.date)}`}
        />
      </div>

      <Sheet open={amending.isOpen} onOpenChange={amending.onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-[20px]">Edit gathering details</SheetTitle>
            <SheetDescription className="sr-only">
              When, where, and who is leading it
            </SheetDescription>
          </SheetHeader>
          {amending.isOpen ? (
            <GatheringEditor
              gathering={gathering}
              viewer={viewer}
              onDone={amending.close}
              onCancel={amending.close}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

/* ------------------------------------------------------------- attendance */

const statuses = config.options("lifegroup.attendance").map((s) => s.id) as AttendanceStatus[];

/**
 * Who was actually here.
 *
 * Signups sit above as a working list to tick through; the marks below are the
 * record. The two are never merged, because ten people choosing a slot and
 * seven turning up are both true and the leader needs to see both.
 */
function AttendanceEditor({ gathering, canEdit }: { gathering: Gathering; canEdit: boolean }) {
  const { personById, activePeople } = useOrganization();
  const nameOf = (id: string) => personById(id).name;
  const store = useLifegroup();
  const [failure, setFailure] = useState<unknown>(null);
  /* Remounts the picker after each addition so it starts empty again. */
  const [pickerKey, setPickerKey] = useState(0);
  const [visitor, setVisitor] = useState<string | null>(null);

  const marked = attendanceFor(store.attendance, gathering.id);
  const pending = awaitingMark(gathering, store.attendance);
  const tally = attendanceTally(gathering, store.attendance);

  const present = marked.filter((r) => r.status === "present");
  const rest = marked.filter((r) => r.status !== "present");

  /* The signup list already tells the leader what to do; an empty state on top
     of it would be a second, emptier instruction. */
  const showPending = pending.length > 0 && canEdit;

  const markedIds = new Set(marked.map((r) => r.personId).filter((id): id is string => !!id));

  /*
   * Somebody in People is marked by id, so the mark follows them onto their
   * person page and into attendance history. A name that matches nobody is
   * still enough — a visitor is recorded without inventing a person record.
   */
  const mark = (who: { personId: string } | { name: string }) => {
    setFailure(null);
    setVisitor(null);
    void store.setAttendance(gathering.id, who, "present").catch(setFailure);
    setPickerKey((key) => key + 1);
  };

  /*
   * A name matching nobody is offered as a visitor rather than marked on the
   * spot: leaving a half-typed field must not put "Jo" in the register.
   */
  const choose = (text: string, personId?: string) => {
    if (personId) return mark({ personId });
    setVisitor(text.trim() || null);
  };

  return (
    <Section
      title="Attendance"
      meta={
        tally.expected > 0
          ? `${tally.expectedPresent} of ${tally.expected} signed up${
              tally.walkIn > 0 ? ` · ${tally.walkIn} more came` : ""
            }`
          : `${tally.present} present`
      }
    >
      {showPending ? (
        <div className="border-b border-border bg-surface-muted px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              {pending.length} {pending.length === 1 ? "person" : "people"} signed up and not yet
              marked
            </p>
            <button
              type="button"
              onClick={() => store.markExpectedPresent(gathering.id, pending)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] transition-colors hover:bg-muted"
            >
              All came
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pending.map((personId) => (
              <li key={personId}>
                <button
                  type="button"
                  onClick={() =>
                    store.setAttendance(gathering.id, { personId }, "present", { expected: true })
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[13px] transition-colors hover:bg-muted"
                >
                  <PersonAvatar personId={personId} size="sm" />
                  {nameOf(personId)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {marked.length > 0 ? (
        <ul className="divide-y divide-border">
          {[...present, ...rest].map((record) => (
            <AttendanceRow
              key={record.id}
              record={record}
              gatheringId={gathering.id}
              canEdit={canEdit}
            />
          ))}
        </ul>
      ) : showPending ? null : (
        <EmptyState icon={Users} title="Nobody marked yet">
          {canEdit
            ? "Add the people who came from People below. A visitor who is not in People can be marked by name."
            : "Attendance is marked by a leader assigned to this gathering."}
        </EmptyState>
      )}

      {canEdit ? (
        <div className="border-t border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <UserPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Combobox
              key={pickerKey}
              label="Add someone who came"
              value=""
              placeholder="Add someone from People, or type a visitor's name"
              width="w-full"
              className="min-w-0 flex-1"
              suggestions={activePeople
                .filter((p) => !markedIds.has(p.id))
                .map((p) => ({ id: p.id, label: p.name, ...(p.role ? { hint: p.role } : {}) }))}
              onChange={choose}
            />
          </div>
          {visitor ? (
            <button
              type="button"
              /* Keeps the field from blurring and offering the same name again. */
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => mark({ name: visitor })}
              className="mt-1.5 ml-6 inline-flex items-center gap-1 text-[12px] text-primary underline-offset-2 hover:underline"
            >
              <UserPlus className="size-3" aria-hidden />
              Mark “{visitor}” present by name — not in People
            </button>
          ) : null}
          {failure ? (
            <p role="alert" className="mt-1.5 pl-6 text-[12px] text-status-overdue">
              {errorMessage(failure)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function AttendanceRow({
  record,
  gatheringId,
  canEdit,
}: {
  record: GatheringAttendance;
  gatheringId: string;
  canEdit: boolean;
}) {
  const { personById } = useOrganization();
  const nameOf = (id: string) => personById(id).name;
  const store = useLifegroup();
  const label = attendeeLabel(record, nameOf);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      {record.personId ? (
        <PersonAvatar personId={record.personId} size="sm" />
      ) : (
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-[10px] text-muted-foreground">
          {label.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[14px]">
        {label}
        {record.firstTime ? (
          <span className="ml-2 text-[11px] text-status-attention">First time</span>
        ) : null}
      </span>

      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() =>
                store.setAttendance(
                  gatheringId,
                  record.personId ? { personId: record.personId } : { name: record.name ?? "" },
                  status,
                )
              }
              aria-pressed={record.status === status}
              className={cn(
                "rounded-md px-2 py-1 text-[12px] transition-colors",
                record.status === status
                  ? "bg-area-soft font-medium text-area-ink"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {attendanceStatusLabel[status]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void store.removeAttendance(record.id)}
            aria-label={`Remove ${label} from attendance`}
            title="Remove this mark"
            className="ml-1 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {attendanceStatusLabel[record.status]}
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------ exhortation */

/**
 * What was taught.
 *
 * A topic on its own is a complete answer. Scripture and notes are offered,
 * never demanded — a leader must be able to finish a report without them.
 */
function ExhortationEditor({ gathering, canEdit }: { gathering: Gathering; canEdit: boolean }) {
  const store = useLifegroup();
  const exhortation = exhortationFor(store.exhortations, gathering.id);

  if (!canEdit) {
    return (
      <Section title="Exhortation">
        {exhortation?.topic ? (
          <div className="px-4 py-3">
            <p className="text-[15px]">{exhortation.topic}</p>
            {exhortation.scripture ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{exhortation.scripture}</p>
            ) : null}
            {exhortation.notes ? (
              <p className="mt-2 text-[14px] leading-relaxed">{exhortation.notes}</p>
            ) : null}
          </div>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">Nothing recorded.</p>
        )}
      </Section>
    );
  }

  return (
    <Section title="Exhortation">
      <div className="space-y-2 px-4 py-3">
        <input
          value={exhortation?.topic ?? ""}
          onChange={(e) => store.setExhortation(gathering.id, { topic: e.target.value })}
          placeholder="Topic"
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <input
          value={exhortation?.scripture ?? ""}
          onChange={(e) =>
            store.setExhortation(gathering.id, { scripture: e.target.value || undefined })
          }
          placeholder="Scripture or reference — optional"
          className="w-full bg-transparent text-[13px] text-muted-foreground outline-none placeholder:text-muted-foreground"
        />
        <textarea
          value={exhortation?.notes ?? ""}
          onChange={(e) =>
            store.setExhortation(gathering.id, { notes: e.target.value || undefined })
          }
          rows={3}
          placeholder="Short notes — optional"
          className="w-full resize-y rounded-md border border-border bg-surface-muted px-2.5 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- report */

/**
 * Finishing the report.
 *
 * Attendance is the only thing named as missing. Everything else is optional,
 * and completing is never blocked — a leader who taught without notes still
 * has a complete report.
 */
function SummaryAndComplete({
  gathering,
  canEdit,
  missing,
  done,
}: {
  gathering: Gathering;
  canEdit: boolean;
  missing: string[];
  done: boolean;
}) {
  const { personById } = useOrganization();
  const nameOf = (id: string) => personById(id).name;
  const { person } = useViewer();
  const store = useLifegroup();
  const report = reportFor(store.reports, gathering.id);

  return (
    <Section
      title="Leader's summary"
      meta={done && report?.completedAt ? "Report complete" : undefined}
    >
      {canEdit ? (
        <textarea
          value={report?.summary ?? ""}
          onChange={(e) => store.setSummary(gathering.id, e.target.value)}
          rows={3}
          placeholder="Anything you want to add. Optional — the records above already speak."
          className="w-full resize-y border-0 bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <p className="px-4 py-3 text-[14px] leading-relaxed">
          {report?.summary || <span className="text-muted-foreground">Nothing added.</span>}
        </p>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <p className="text-[12px] text-muted-foreground">
            {missing.includes("Attendance")
              ? "Attendance has not been marked yet."
              : done
                ? `Completed by ${report?.completedById ? nameOf(report.completedById) : "you"}.`
                : "Ready whenever you are."}
          </p>
          {done ? (
            <Button
              type="button"
              onClick={() => store.reopenGathering(gathering.id)}
              variant="secondary"
            >
              Reopen
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => store.completeGathering(gathering.id, person.id)}
              variant="primary"
            >
              Complete gathering
            </Button>
          )}
        </div>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ print */

/**
 * The binder page.
 *
 * Composed from the same records the leader entered, and filtered for whoever
 * is holding the paper: content they may not read is not printed, and its
 * absence is stated as a count rather than left to look like nothing happened.
 */
function PrintSheet({
  gathering,
  context,
  viewerId,
}: {
  gathering: Gathering;
  context: { isLeader: boolean; isAssignedLeader: boolean };
  viewerId: string;
}) {
  const { personById, venues } = useOrganization();
  const nameOf = (id: string) => personById(id).name;
  const store = useLifegroup();
  const sheet = composeReport(
    gathering,
    venues,
    store.attendance,
    store.entries,
    store.exhortations,
    store.reports,
    viewerId,
    context,
  );

  return (
    <Page>
      <div data-print="hide" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/lifegroups/$gatheringId"
          params={{ gatheringId: gathering.id }}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Back to the gathering
        </Link>
        <Button type="button" onClick={() => window.print()} variant="primary">
          <Printer className="size-3.5" aria-hidden />
          Print
        </Button>
      </div>

      <article
        data-print="sheet"
        className="mx-auto max-w-[820px] rounded-2xl border border-border bg-surface shadow-card px-6 py-6"
      >
        <header data-print="section" className="border-b border-border pb-3">
          <h1 className="font-display text-[22px] leading-tight">{sheet.venue}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {dayLabel(gathering.date)}
            {gathering.startTime ? ` · ${gathering.startTime}` : ""}
          </p>
          <p className="mt-1 text-[13px]">
            Led by{" "}
            {gathering.assignedLeaderIds.map((id, i) => (
              <span key={id}>
                {i > 0 ? " & " : ""}
                {nameOf(id)}
              </span>
            ))}
          </p>
        </header>

        <section data-print="section" className="mt-5">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
            Attendance
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {sheet.tally.present} present
            {sheet.tally.expected > 0
              ? ` · ${sheet.tally.expectedPresent} of ${sheet.tally.expected} signed up`
              : ""}
            {sheet.tally.absent > 0 ? ` · ${sheet.tally.absent} absent` : ""}
            {sheet.tally.excused > 0 ? ` · ${sheet.tally.excused} excused` : ""}
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-[14px] sm:grid-cols-2">
            {sheet.attendance.map((record) => (
              <li key={record.id} className="flex items-baseline justify-between gap-3">
                <span>{attendeeLabel(record, nameOf)}</span>
                <span className="text-[12px] text-muted-foreground">
                  {attendanceStatusLabel[record.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {sheet.exhortation?.topic ? (
          <section data-print="section" className="mt-5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              <BookOpen className="size-3.5" aria-hidden />
              Exhortation
            </h2>
            <p className="mt-1 text-[15px]">{sheet.exhortation.topic}</p>
            {sheet.exhortation.scripture ? (
              <p className="text-[13px] text-muted-foreground">{sheet.exhortation.scripture}</p>
            ) : null}
            {sheet.exhortation.notes ? (
              <p className="mt-1.5 text-[14px] leading-relaxed">{sheet.exhortation.notes}</p>
            ) : null}
          </section>
        ) : null}

        {sheet.entries.length > 0 ? (
          <section data-print="section" className="mt-5">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Sharing and notes
            </h2>
            <ul className="mt-1.5 space-y-1.5 text-[14px] leading-relaxed">
              {sheet.entries.map((entry) => (
                <li key={entry.id} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{entry.body}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {sheet.withheld > 0 ? (
          <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            {sheet.withheld} {sheet.withheld === 1 ? "entry is" : "entries are"} held to a smaller
            audience and not shown here.
          </p>
        ) : null}

        {sheet.report?.summary ? (
          <section data-print="section" className="mt-5 border-t border-border pt-3">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Leader's summary
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed">{sheet.report.summary}</p>
          </section>
        ) : null}
      </article>
    </Page>
  );
}
