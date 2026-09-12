import { endOfMonth, startOfMonth } from "date-fns";

import { statusOf, type LeadershipObligation, type ObligationStep } from "@/domain/obligations";
import { canDiscover } from "@/domain/leadership-report";
import { gatheringLabel } from "@/domain/lifegroup";
import { fromISO, toISO, weekDays, weekOf } from "@/domain/schedule";
import type { CalendarRepository } from "../repositories/calendar-repository";
import type { GoalsRepository } from "../repositories/goals-repository";
import type { LeadershipReportRepository } from "../repositories/leadership-report-repository";
import type { LifegroupRepository } from "../repositories/lifegroup-repository";
import type { MeetingRepository } from "../repositories/meeting-repository";
import type { ReachOutRepository } from "../repositories/reach-out-repository";
import type { WorkRepository } from "../repositories/work-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { Viewer } from "@/domain/viewer";

/**
 * What this leader owes, projected from what the binder actually holds.
 *
 * ## It reads the real records, and that is the point
 *
 * A dashboard fed by its own fixtures is a dashboard that disagrees with the
 * modules. It would tell a leader their Reach-Out update is due on the morning
 * after they wrote it, and the first time that happens they stop believing the
 * page. Every obligation below is derived from the same rows the section itself
 * reads.
 *
 * ## It owns no records and decides no rules
 *
 * This is a read projection. It creates nothing, changes nothing, and every
 * `destination` is a route that already exists. When a section's idea of "done"
 * changes, it changes in the section and this follows.
 *
 * ## Authorization is not re-derived here
 *
 * Leadership Reports are filtered through `canDiscover`, the same gate the
 * module uses, because a confidential report about somebody must not become
 * discoverable by appearing as a row on a dashboard. Where a module has no
 * access rule, this has none either — it must not invent one, and it must not
 * lose one.
 *
 * There is no cadence engine: this answers "is this done" from the records
 * that exist rather than "was this due" from a schedule nobody has entered.
 * would add on top of this.
 */

export interface Dashboard {
  today: string;
  weekly: { period: string; obligations: LeadershipObligation[] };
  monthly: { period: string; obligations: LeadershipObligation[] };
}

const step = (id: string, title: string, done: boolean, required = true): ObligationStep => ({
  id,
  title,
  done,
  required,
});

export function createDashboardService(repos: {
  calendar: CalendarRepository;
  meetings: MeetingRepository;
  lifegroup: LifegroupRepository;
  reachOut: ReachOutRepository;
  reports: LeadershipReportRepository;
  goals: GoalsRepository;
  work: WorkRepository;
  organization: OrganizationRepository;
}) {
  return {
    build(viewer: Viewer, today: string): Dashboard {
      const me = viewer.person.id;
      const week = weekDays(weekOf(today));
      const weekStart = week[0]!;
      const weekEnd = week[week.length - 1]!;

      const monthStart = toISO(startOfMonth(fromISO(today)));
      /* When this person was entered. Nothing is owed from before it. */
      const joinedAt = repos.organization.findPerson(me)?.joinedAt ?? "";
      const monthEnd = toISO(endOfMonth(fromISO(today)));

      const weekly: LeadershipObligation[] = [];
      const monthly: LeadershipObligation[] = [];

      /* ------------------------------------------------ 1. Weekly Agenda */

      /*
       * The obligation is to *plan the week*, which is what the physical page
       * is for — not to have "completed" it, which the agenda has no notion
       * of. Saying "Weekly Agenda: Done" because rows exist would be exactly
       * the "a record exists so it must be finished" mistake.
       */
      const entriesThisWeek = repos.calendar.entriesInRange(weekStart, weekEnd);
      const agendaThisWeek = repos.calendar.agendaInRange(weekStart, weekEnd);
      const agendaSteps = [
        step("scheduled", "Something scheduled this week", entriesThisWeek.length > 0),
        step("intentions", "What you mean to do written down", agendaThisWeek.length > 0),
      ];
      weekly.push({
        id: "weekly-agenda",
        module: "Weekly Agenda",
        title: "Plan the week",
        description: "What is happening this week, and what you mean to do about it.",
        cadence: "weekly",
        cycle: "This week",
        steps: agendaSteps,
        /* Planning is a Monday act; by midweek an unplanned week is the
           problem, not a deadline that passed. */
        ...(week[1] ? { dueAt: week[1] } : {}),
        destination: "/weekly-agenda",
        nextAction: "Open the week",
        status: statusOf({ steps: agendaSteps, ...(week[1] ? { dueAt: week[1] } : {}) }, today),
      });

      /* ------------------------------------------------- 2. Meeting Notes */

      /*
       * Event-based, not weekly: notes are owed for meetings that happened,
       * and a week with no meetings owes nothing. A note left in draft is the
       * obligation — writing it up is the work.
       */
      const myDrafts = repos.meetings
        .listNotes({ readableBy: me }, 200, 0)
        .filter(
          (note) => note.status === "draft" && note.date >= weekStart && note.date <= weekEnd,
        );

      if (myDrafts.length > 0) {
        const noteSteps = myDrafts.map((note) =>
          step(note.id, note.title || "Untitled note", false),
        );
        weekly.push({
          id: "meeting-notes",
          module: "Meeting Notes",
          title:
            myDrafts.length === 1
              ? "Finish this week's meeting note"
              : `Finish ${myDrafts.length} meeting notes`,
          description: myDrafts.map((n) => n.title || "Untitled note").join(" · "),
          cadence: "event",
          cycle: "This week",
          steps: noteSteps,
          destination: "/meeting-notes",
          nextAction: "Open notes",
          statusNote: "Still in draft",
          status: statusOf({ steps: noteSteps }, today),
        });
      }

      /* ----------------------------------------------------- 3. LifeGroup */

      /*
       * Per occurrence, never a standing group. The obligation belongs to the
       * gathering this leader was assigned to this week, and disappears in a
       * week they led none.
       */
      const gatherings = repos.lifegroup
        .gatheringsInRange(weekStart, weekEnd)
        .filter((g) => g.assignedLeaderIds.includes(me));

      for (const gathering of gatherings) {
        const attendance = repos.lifegroup.attendanceFor([gathering.id]);
        const report = repos.lifegroup.reports().find((r) => r.gatheringId === gathering.id);
        const exhortation = repos.lifegroup
          .exhortations()
          .find((e) => e.gatheringId === gathering.id);

        const steps = [
          step("attendance", "Record who came", attendance.length > 0),
          step("exhortation", "Record the exhortation", !!exhortation?.topic),
          step("report", "Complete the gathering report", !!report?.completedAt),
          /* Follow-ups are worth doing and must never hold the report open. */
          step("follow-up", "Add follow-up entries", false, false),
        ];
        /* Written up within two days, while the evening is still fresh. */
        const dueAt = toISO(new Date(fromISO(gathering.date).getTime() + 2 * 86_400_000));

        weekly.push({
          id: `lifegroup-${gathering.id}`,
          module: "LifeGroup",
          title: "Report the gathering you led",
          /* Named the way LifeGroup names a gathering everywhere else: the
             place and the day, resolved through the venue record because the
             snapshot on the row is only a fallback. */
          description: gatheringLabel(repos.organization.venues(), gathering),
          cadence: "weekly",
          cycle: "This week",
          steps,
          dueAt,
          destination: `/lifegroups/${gathering.id}`,
          nextAction: report?.completedAt ? "Open the gathering" : "Continue the report",
          status: statusOf({ steps, dueAt }, today),
        });
      }

      /* ------------------------------------------------------ 4. Reach-Out */

      /*
       * Ongoing work with a weekly reporting expectation — the report is the
       * record, and there is no pipeline behind it.
       */
      const reachOutThisWeek = repos.reachOut
        .list(undefined, 200, 0)
        .filter((r) => r.reportDate >= weekStart && r.reportDate <= weekEnd);
      const written = reachOutThisWeek.find((r) => r.content.trim().length > 0);
      const reachSteps = [
        step("started", "Start this week's report", reachOutThisWeek.length > 0),
        step("written", "Say what happened", !!written),
      ];
      weekly.push({
        id: "reach-out",
        module: "Reach-Out",
        title: "This week's Reach-Out report",
        description: written
          ? written.title || "Reach-out report"
          : "No report has been written this week.",
        cadence: "ongoing",
        cycle: "This week",
        steps: reachSteps,
        dueAt: weekEnd,
        destination: written ? `/reach-out/${written.id}` : "/reach-out",
        nextAction: written ? "Open the report" : "Write the report",
        status: statusOf({ steps: reachSteps, dueAt: weekEnd }, today),
      });

      /* --------------------------------------------- 5. Monthly Calendar */

      const entriesThisMonth = repos.calendar.entriesInRange(monthStart, monthEnd);
      const monthSteps = [step("planned", "The month laid out", entriesThisMonth.length > 0)];
      monthly.push({
        id: "monthly-calendar",
        module: "Monthly Calendar",
        title: "Lay out the month",
        cadence: "monthly",
        cycle: monthName(today),
        steps: monthSteps,
        destination: "/monthly-calendar",
        nextAction: "Open the month",
        status: statusOf({ steps: monthSteps }, today),
      });

      /* ---------------------------------------------------------- 6. Goals */

      const year = fromISO(today).getFullYear();
      const myGoals = repos.goals.goalsForYear(year).filter((g) => g.status === "active");
      const updates = repos.goals.updatesFor(myGoals.map((g) => g.id));
      const updatedThisMonth = new Set(
        updates.filter((u) => u.date >= monthStart && u.date <= monthEnd).map((u) => u.goalId),
      );

      if (myGoals.length > 0) {
        const goalSteps = myGoals.map((goal) =>
          step(goal.id, goal.title, updatedThisMonth.has(goal.id)),
        );
        monthly.push({
          id: "goals",
          module: "Goals",
          title: "Say where the goals stand",
          description: "An update on each active goal this month.",
          cadence: "monthly",
          cycle: monthName(today),
          steps: goalSteps,
          dueAt: monthEnd,
          destination: "/goals",
          nextAction: "Update goals",
          status: statusOf({ steps: goalSteps, dueAt: monthEnd, warnWithinDays: 5 }, today),
        });
      }

      /* --------------------------------------------- 7. Leadership Report */

      /*
       * Filtered through the module's own gate. A confidential report must not
       * become discoverable by appearing as a row here.
       */
      const mine = repos.reports
        .allUnguarded()
        .filter((report) => canDiscover(report, viewer.persona, viewer.person))
        .filter((report) => report.authorId === me);

      /*
       * Matched on the period the report is *about*, not on when it was last
       * touched. Using `updatedAt` meant that opening August's report marked
       * September's obligation complete — the dashboard telling a leader they
       * had done something they had not.
       */
      /*
       * Matched on the period the report is *about*, and on nothing else.
       *
       * Two earlier attempts got this wrong in ways that both told a leader
       * they had finished work they had not: matching on `updatedAt` meant
       * opening August's report satisfied September, and matching a bare month
       * name meant a report from September *2025* did.
       */
      /*
       * Only a *periodic* report discharges the monthly obligation. A Camp
       * Debrief filed in August is a real report and is not the leader's
       * monthly account of themselves — §28: not every report is simply a
       * ministry report, and the types are not interchangeable.
       */
      const forPeriod = (period: string) =>
        mine.find(
          (report) => report.reportingPeriod === period && PERIODIC_TYPES.has(report.reportType),
        );

      const period = monthName(today);
      const thisPeriod = forPeriod(period);
      const reportSteps = [
        step("started", "Start the report", !!thisPeriod),
        step("submitted", "Submit it", thisPeriod?.status === "published"),
      ];
      monthly.push({
        id: "leadership-report",
        module: "Leadership Reports",
        title: "This month's leadership report",
        description:
          thisPeriod?.title || "Leadership & Personal Development, or whichever type is expected.",
        cadence: "monthly",
        cycle: monthName(today),
        steps: reportSteps,
        dueAt: monthEnd,
        destination: thisPeriod ? `/leadership-reports/${thisPeriod.id}` : "/leadership-reports",
        nextAction: thisPeriod ? "Open the report" : "Start the report",
        status: statusOf({ steps: reportSteps, dueAt: monthEnd, warnWithinDays: 5 }, today),
      });

      /* --------------------------------------------- 8. returned to you */

      /*
       * Something a reviewer sent back.
       *
       * `changes-requested` is a state the review context actually models, and
       * a reviewer had to say what needed changing to reach it — so this is the
       * one place the dashboard can honestly say *blocked* rather than merely
       * late. An earlier version inferred it from a report having been
       * reopened, which is not the same thing at all: reopening is the author's
       * own act, not a rejection.
       */
      for (const record of repos.work.allUnguarded()) {
        if (record.status !== "changes-requested" || record.ownerId !== me) continue;
        const returnedSteps = [step("revise", "Make the changes asked for", false)];
        weekly.push({
          id: `returned-${record.id}`,
          module: "Reports to Review",
          title: record.subject,
          description: record.currentState,
          cadence: "event",
          cycle: "This week",
          steps: returnedSteps,
          destination: `/work/${record.id}`,
          nextAction: "Open it",
          statusNote: "Changes requested",
          blockedReason: "A reviewer asked for changes",
          status: statusOf(
            { steps: returnedSteps, blockedReason: "A reviewer asked for changes" },
            today,
          ),
        });
      }

      /*
       * A month that ended without its report does not stop being owed.
       *
       * Without this, a monthly obligation could only ever read as overdue on
       * the last day of its own month — the dashboard would quietly forget what
       * a leader missed the moment the month rolled over, while still claiming
       * to answer "what is overdue?".
       */
      const lastMonthEnd = toISO(endOfMonth(new Date(fromISO(monthStart).getTime() - 86_400_000)));
      const lastPeriod = monthName(lastMonthEnd);
      const lastReport = forPeriod(lastPeriod);

      /*
       * Nothing is owed from before somebody was here.
       *
       * A leader entered this week has not missed last month's report; saying
       * so would be the dashboard inventing a history for them, which is the
       * same failure as inventing the records themselves.
       */
      const owedForLastMonth = !joinedAt || joinedAt <= lastMonthEnd;

      if (owedForLastMonth && lastReport?.status !== "published") {
        const lastSteps = [
          step("started", "Start the report", !!lastReport),
          step("submitted", "Submit it", false),
        ];
        monthly.unshift({
          id: "leadership-report-previous",
          module: "Leadership Reports",
          title: `${lastPeriod}'s leadership report`,
          description: "The month closed without it.",
          cadence: "monthly",
          cycle: lastPeriod,
          steps: lastSteps,
          dueAt: lastMonthEnd,
          destination: lastReport ? `/leadership-reports/${lastReport.id}` : "/leadership-reports",
          nextAction: lastReport ? "Finish the report" : "Start the report",
          statusNote: "Overdue",
          status: statusOf({ steps: lastSteps, dueAt: lastMonthEnd }, today),
        });
      }

      /*
       * Nothing was due before somebody arrived.
       *
       * An obligation whose deadline predates this person's record is not one
       * they missed — it is one that belonged to whoever was doing the work
       * before them, or to nobody at all. A dashboard that greets a new leader
       * with a list of failures they could not have committed is telling them
       * something untrue on their first morning.
       */
      const afterJoining = (obligation: LeadershipObligation) =>
        !joinedAt || !obligation.dueAt || obligation.dueAt >= joinedAt;

      return {
        today,
        weekly: {
          period: weekLabel(weekStart, weekEnd),
          obligations: weekly.filter(afterJoining),
        },
        monthly: { period: monthName(today), obligations: monthly.filter(afterJoining) },
      };
    },
  };
}

/**
 * The report types that answer "where are you this month?".
 *
 * Both are in `knownReportTypes`; the rest — a camp debrief, a pastoral
 * concern, a ministry operations note — are reports a leader writes *as well*,
 * not instead.
 */
const PERIODIC_TYPES = new Set(["progress-report", "leadership-development"]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthName = (iso: string) =>
  `${MONTHS[fromISO(iso).getMonth()]} ${fromISO(iso).getFullYear()}`;

function weekLabel(from: string, to: string): string {
  const a = fromISO(from);
  const b = fromISO(to);
  const month = (d: Date) => MONTHS[d.getMonth()]!.slice(0, 3);
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()}–${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

export type DashboardService = ReturnType<typeof createDashboardService>;
