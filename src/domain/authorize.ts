import { canContribute as canContributeReachOut } from "./reach-out";
import { canReadEntry } from "./lifegroup";
import { canManage, canContribute as canContributeMinistry, relationshipTo } from "./ministry";
import { reportCapabilities } from "./leadership-report";
import type { Viewer } from "./viewer";
import type {
  Gathering,
  Goal,
  LeadershipReport,
  LifegroupEntry,
  MeetingNote,
  Ministry,
  ReachOutReport,
  ResponsibilityGroup,
  ScheduleEntry,
} from "./types";

/**
 * The four questions the application is allowed to ask about permission.
 *
 * Before this file, a component that wanted to know whether to render an Edit
 * button asked the domain directly — `reportCapabilities(...).edit` here,
 * `relationshipTo(...) === "lead"` there, nothing at all somewhere else. Four
 * verbs in one place means the answer for a new record type is a decision
 * someone has to make, rather than a conditional someone forgets to write.
 *
 * This file **decides nothing on its own**. Each subject delegates to the
 * domain module that already owns its rules; where a domain has no rules yet,
 * the answer is stated here explicitly and conservatively, and the gap is
 * listed in `docs/architecture/identity-and-access.md` rather than papered over.
 *
 * ## What this is not
 *
 * > **Not production-secure.** Identity is asserted, never verified — see
 * > `viewer.ts`. These functions decide what to *render* and what a *service*
 * > will do with a request it already trusts. They are not a security
 * > boundary, and no confidential record should depend on them.
 *
 * §35 of the MVP brief applies throughout: a route existing is not a reason to
 * expose a record.
 */

/** Everything the application currently knows how to authorize. */
export type Subject =
  | { kind: "leadership-report"; report: LeadershipReport }
  | { kind: "reach-out-report"; report: ReachOutReport }
  | { kind: "ministry"; ministry: Ministry }
  | { kind: "meeting-note"; note: MeetingNote }
  | { kind: "lifegroup-entry"; entry: LifegroupEntry; gathering: Gathering; isLeader: boolean }
  | { kind: "gathering"; gathering: Gathering }
  /* The ministry travels with the goal rather than being looked up: this
     module decides rules, and a module that reaches for a directory of its own
     ends up deciding them against a different one than the caller saw. */
  | {
      kind: "goal";
      goal: Goal;
      ministry?: Ministry | undefined;
      group?: ResponsibilityGroup | undefined;
    }
  | { kind: "schedule-entry"; entry: ScheduleEntry };

/** What a viewer may do with one subject. All four default to `false`. */
export interface Permissions {
  view: boolean;
  edit: boolean;
  comment: boolean;
  /** Reviewing is an assigned responsibility, never a rank. */
  review: boolean;
}

const NONE: Permissions = { view: false, edit: false, comment: false, review: false };

export function permissionsFor(viewer: Viewer, subject: Subject): Permissions {
  const me = viewer.person.id;

  switch (subject.kind) {
    /*
     * Leadership Reports own the most developed rules in the product — audience
     * policy, discussion policy, and the rule that a subject reading an
     * evaluation about themselves can never edit it. Delegate, do not restate.
     */
    case "leadership-report": {
      const caps = reportCapabilities(subject.report, viewer.persona, viewer.person);
      return {
        view: caps.view,
        edit: caps.edit,
        comment: caps.comment,
        /*
         * Reviewing is not yet a modelled relationship on a leadership report:
         * there is no assigned-reviewer field. Saying `false` is the honest
         * answer, and Slice I is where it stops being false.
         */
        review: false,
      };
    }

    /*
     * Reach-Out is shared leadership work: authorship is not exclusive
     * ownership, so any leader who can see a report may also continue it. The
     * rule lives in `reach-out.ts`, which is where real visibility will attach.
     */
    case "reach-out-report": {
      const may = canContributeReachOut(subject.report, me);
      return { view: true, edit: may, comment: may, review: false };
    }

    case "ministry": {
      const relationship = relationshipTo(subject.ministry, me);
      return {
        /* Being able to see that a ministry exists is not access to its work. */
        view: true,
        edit: canManage(relationship),
        comment: canContributeMinistry(relationship),
        review: false,
      };
    }

    /*
     * A personal note is the leader's own working record. Minutes are written
     * to be read by the meeting's participants. Neither is a shared surface
     * yet — §8 of the brief says explicitly not to implement sharing
     * permissions during this phase — so anyone but the author gets nothing.
     */
    case "meeting-note": {
      const mine = subject.note.authorId === me || subject.note.noteTakerId === me;
      const participant = subject.note.participantIds.includes(me);
      const view = mine || (subject.note.noteType === "minutes" && participant);
      return { view, edit: mine, comment: false, review: false };
    }

    case "lifegroup-entry": {
      const view = canReadEntry(subject.entry, me, {
        isLeader: subject.isLeader,
        isAssignedLeader: subject.gathering.assignedLeaderIds.includes(me),
      });
      return { view, edit: view && subject.entry.authorId === me, comment: false, review: false };
    }

    /*
     * A gathering is led for one occasion — by one leader or several, and the
     * assignment can change. Leading *this* gathering is what grants the right
     * to record its attendance and write it up; there is no standing group
     * membership to inherit the right from.
     */
    case "gathering": {
      const leads = subject.gathering.assignedLeaderIds.includes(me);
      return { view: true, edit: leads, comment: false, review: false };
    }

    /*
     * A goal is readable by anyone who can reach the page (its audience policy
     * is applied before it gets here). Who may change it follows whose it is:
     *
     * - a personal goal, only the leader it belongs to;
     * - a ministry's goal, anyone who works in that ministry;
     * - another group's goal, that group's members.
     *
     * Membership is asked of `relationshipTo`, the ministry module's own rule,
     * rather than read off `person.ministryIds`. The two disagree — a person
     * on a ministry's `teamIds` need not carry its id — and asking the wrong
     * one told leaders they could not annotate goals in a ministry the
     * Ministry page says they serve in.
     */
    case "goal": {
      const { goal } = subject;
      if (goal.scope === "personal") {
        return { view: true, edit: goal.ownerId === me, comment: false, review: false };
      }
      if (goal.scope === "other") {
        const group =
          subject.group && subject.group.id === goal.groupId ? subject.group : undefined;
        const edit = !!group && group.active && group.memberIds.includes(me);
        return { view: true, edit, comment: false, review: false };
      }
      const ministry =
        subject.ministry && subject.ministry.id === goal.ministryId ? subject.ministry : undefined;
      const edit = ministry ? canContributeMinistry(relationshipTo(ministry, me)) : false;
      return { view: true, edit, comment: false, review: false };
    }

    /*
     * The calendar is shared working information. Church-wide entries are not a
     * leader's to change; their own and their ministry's are.
     */
    case "schedule-entry": {
      const entry = subject.entry;
      const mine = entry.createdBy === me || entry.organizerId === me;
      const inMyMinistry =
        !!entry.ministryId && viewer.person.ministryIds.includes(entry.ministryId);
      /* Church-wide rhythms are not one leader's to change. */
      const churchWide = entry.source === "church";
      return {
        view: true,
        edit: !churchWide && (mine || inMyMinistry),
        comment: false,
        review: false,
      };
    }

    default:
      /* An unmodelled subject is denied, not assumed harmless. */
      return NONE;
  }
}

/* ------------------------------------------------- scheduling a gathering */

/**
 * Creating a record has no record to ask about, so it gets its own question.
 *
 * Two rights, deliberately separate, because they answer to different people:
 *
 * - **Scheduling** — putting a gathering on the calendar. Any leader may do
 *   this for a gathering they will lead. LifeGroup work is not handed down.
 * - **Assigning someone else** — naming a different leader. That is oversight,
 *   and belongs to whoever carries campus responsibility.
 *
 * Neither is `canEdit` on a gathering, which is a third thing again: recording
 * what happened — attendance, exhortation, summary — and stays with the leader
 * who was actually there. A campus overseer may move a gathering; they may not
 * mark its attendance, because they were not at it.
 */
export function canScheduleGathering(_viewer: Viewer): boolean {
  return true;
}

/**
 * Put **somebody else's** name against a gathering, or take it off.
 *
 * Campus oversight. Deciding who leads is a different act from volunteering,
 * and it is the one that needs the responsibility behind it.
 */
export function canAssignGatheringLeaders(viewer: Viewer): boolean {
  return viewer.persona.capabilities.includes("campus-oversight");
}

/**
 * Put **your own** name against a gathering, or take it off again.
 *
 * Any leader, and deliberately not the same right as assigning others. The
 * schedule is a shared roster: leaders see the week, claim what they can lead
 * and join what needs help, and needing an administrator for that is what makes
 * a roster stop being maintained.
 *
 * Once a gathering has happened there is nothing left to volunteer for, and
 * adding yourself to a completed record would be rewriting who led it.
 */
export function canJoinGathering(_viewer: Viewer, gathering: Gathering): boolean {
  return gathering.status !== "completed" && gathering.status !== "cancelled";
}

/**
 * Change when, where, or what this row says.
 *
 * An assigned leader, or campus oversight. **Assignment grants responsibility,
 * not ownership** — the row stays part of the shared schedule, which is why a
 * leader who steps away leaves it maintainable by whoever picks it up rather
 * than taking it with them.
 */
export function canAmendGathering(viewer: Viewer, gathering: Gathering): boolean {
  if (gathering.assignedLeaderIds.includes(viewer.person.id)) return true;
  if (canAssignGatheringLeaders(viewer)) return true;

  /*
   * Before anyone has claimed it, the row belongs to the shared schedule.
   *
   * This is the stage the roster is actually prepared in — several leaders
   * filling in the week together, usually while the poll goes round — and
   * requiring somebody to claim a gathering before they may write down where it
   * meets would put a form back in front of the work.
   *
   * Once it has been claimed or written up, it is the assigned leaders' and
   * campus oversight's.
   */
  const unclaimed = gathering.assignedLeaderIds.length === 0;
  const stillOpen = gathering.status !== "completed" && gathering.status !== "cancelled";
  return unclaimed && stillOpen && canScheduleGathering(viewer);
}

/* -------------------------------------------------------------- shorthands */

export const canView = (viewer: Viewer, subject: Subject) => permissionsFor(viewer, subject).view;
export const canEdit = (viewer: Viewer, subject: Subject) => permissionsFor(viewer, subject).edit;
export const canComment = (viewer: Viewer, subject: Subject) =>
  permissionsFor(viewer, subject).comment;
export const canReview = (viewer: Viewer, subject: Subject) =>
  permissionsFor(viewer, subject).review;
