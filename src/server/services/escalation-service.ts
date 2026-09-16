import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  addressedTo,
  allowedTransitions,
  canWithdraw,
  isPartyTo,
  escalationOrder,
  initialStatus,
  isSettled,
  recipientRoles,
  type Escalation,
  type EscalationStatus,
  type EscalationType,
  type RecipientRole,
} from "@/domain/escalation";
import type {
  EscalationActivity,
  EscalationRepository,
} from "../repositories/escalation-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import { categoryLabelOf, triggersAttention } from "@/domain/categories";
import { isCurrent, reportContextLabel } from "@/domain/leadership-report";
import type { LeadershipReport } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

const contextLabel = (report: LeadershipReport) => reportContextLabel(report);

/**
 * Asking something of leadership.
 *
 * Two rules carry this module.
 *
 * **An ask must say what it asks.** A flag with no words makes the recipient
 * go and find out what was meant, which is worse than not flagging it. The
 * request text is required, at the boundary, for all three kinds.
 *
 * **An ask is addressed to a position.** "My reporting leader" resolves
 * through the organisation at the moment it is read, so a church that
 * reorganises does not find last year's leader still receiving this year's
 * requests. A specific person may be named where somebody means one person.
 *
 * ## What this service refuses to do
 *
 * It does not create work from information. Nothing here reads a report and
 * decides somebody must process it; every row exists because a person said
 * "I need something" or because a leader who received information said "this
 * needs doing". There is no code path from *submitted* to *obligation*.
 */

const recipientRole = z.enum([
  "reporting-leader",
  "ministry-head",
  "campus-leadership",
  "church-leadership",
]);

const raise = z.object({
  type: z.enum(["attention", "action", "approval"]),
  sourceType: z.enum([
    "leadership-report",
    "reach-out-report",
    "meeting-note",
    "lifegroup-entry",
    "gathering",
    "goal",
    "ministry",
    "work",
  ]),
  sourceId: z.string().trim().min(1),
  entryId: z.string().trim().min(1).optional(),
  contextLabel: z.string().trim().max(200).optional(),
  request: z
    .string()
    .trim()
    .min(1, "Say what you need from leadership.")
    .max(1000, "Keep the request short enough to act on."),
  requestedFromRole: recipientRole.optional(),
  requestedFromPersonId: z.string().trim().min(1).optional(),
  neededBy: z.string().trim().max(40).optional(),
});

const reply = z.object({
  id: z.string().min(1),
  note: z
    .string()
    .trim()
    .min(1, "Say what you want to tell them.")
    .max(1000, "Keep the answer short enough to act on."),
});

const move = z.object({
  id: z.string().min(1),
  status: z.enum([
    "raised",
    "noted",
    "requested",
    "assigned",
    "in-progress",
    "completed",
    "unable",
    "not-required",
    "approved",
    "declined",
    "more-information",
  ]),
  note: z.string().trim().max(1000).optional(),
  assigneeId: z.string().trim().min(1).optional(),
});

export interface EscalationView extends Escalation {
  activity: EscalationActivity[];
  /** True when this viewer is the one being asked. */
  mine: boolean;
  /** True when this viewer made the ask. */
  askedByMe: boolean;
  settled: boolean;
}

/**
 * A record that asks for attention because of **what kind of thing it is**.
 *
 * A projection, never a copy: it points at the report, and it exists only
 * while the report's category says so. Resolving the situation means changing
 * the record — the report itself stays in the binder either way, because it is
 * organisational history and nothing here owns it.
 */
export interface FlaggedRecord {
  id: string;
  kind: "report";
  title: string;
  category: string;
  categoryLabel: string;
  authorId: string;
  contextType?: string;
  contextId?: string;
  contextLabel: string;
  at: string;
  /** Where to open the canonical record. */
  path: string;
}

export interface LeadershipInbox {
  attention: EscalationView[];
  actions: EscalationView[];
  approvals: EscalationView[];
  /**
   * Records whose category asks for attention, that this viewer may read.
   *
   * Kept apart from `attention` because they are different things: those were
   * *asked* of this leader by name, these are flagged by their own nature.
   * Both belong in front of a leader; neither is a copy of a record.
   */
  flagged: FlaggedRecord[];
  /** Everything addressed to this viewer, in one ordered list. */
  mine: EscalationView[];
  /** Asks this viewer made, so they can see what they are waiting on. */
  raisedByMe: EscalationView[];
  /**
   * Asks this viewer made that were answered in the last fortnight.
   *
   * Settling an ask takes it out of "waiting on", which used to take the
   * answer with it: a decline's reason, or why something could not be done,
   * was recorded and never shown to the person it was for.
   */
  answeredForMe: EscalationView[];
}

/** How long an answered ask stays in front of the person who made it. */
const ANSWERED_FOR_DAYS = 14;

export function createEscalationService(
  repo: EscalationRepository,
  organization: OrganizationRepository,
  /**
   * Reports, for the categories that ask to be looked at.
   *
   * Optional because the inbox is meaningful without them; when present, the
   * **already-discoverable** list must be passed in. Attention never widens
   * access: a confidential concern surfaces only to the people who could have
   * read it anyway, and to everyone else it does not exist.
   */
  reports?: { discoverable: (viewer: Viewer) => LeadershipReport[] },
) {
  /**
   * Which positions this person holds.
   *
   * The answer decides which requests reach them. It is computed from the
   * organisation rather than stored on the request, which is the whole reason
   * a request is addressed to a position in the first place.
   */
  /** The groups the church has named as leadership bodies, and still uses. */
  const leadershipBodies = () =>
    organization.groups().filter((group) => group.active && group.leadershipAudience);

  const membersOf = (groups: { memberIds: string[] }[]) => [
    ...new Set(groups.flatMap((group) => group.memberIds)),
  ];

  function rolesHeldBy(viewer: Viewer): RecipientRole[] {
    const held: RecipientRole[] = [];
    const me = viewer.person.id;

    /* Somebody reports to me: I am a reporting leader. */
    if (organization.people().some((person) => person.reportsToId === me)) {
      held.push("reporting-leader");
    }
    if (organization.ministries().some((ministry) => ministry.leadId === me)) {
      held.push("ministry-head");
    }
    /*
     * Leadership is a **membership**, not a rank.
     *
     * These two used to be read off the viewer's capabilities, which meant
     * anybody the product called a bishop was the church's leadership whether
     * or not the church had said so. They now resolve through the groups the
     * church named, and a group with no campus on it answers for the whole of
     * it.
     */
    for (const group of leadershipBodies()) {
      if (!group.memberIds.includes(me)) continue;
      held.push(group.campusId ? "campus-leadership" : "church-leadership");
    }
    return [...new Set(held)];
  }

  /**
   * Who a semantic recipient resolves to *right now*.
   *
   * Returns nobody rather than guessing when the structure does not say. A
   * request addressed to a position nobody holds is still a real request — it
   * waits, and the church's answer is to say who holds that position.
   */
  function resolveRecipients(role: RecipientRole, requester: string): string[] {
    const people = organization.people();
    const me = people.find((person) => person.id === requester);

    if (role === "reporting-leader") {
      return me?.reportsToId ? [me.reportsToId] : [];
    }
    if (role === "ministry-head") {
      const leads = organization
        .ministries()
        .filter((ministry) => (me?.ministryIds ?? []).includes(ministry.id))
        .map((ministry) => ministry.leadId)
        .filter(Boolean);
      return [...new Set(leads)];
    }
    if (role === "campus-leadership") {
      return membersOf(
        leadershipBodies().filter((group) => group.campusId && group.campusId === me?.campusId),
      );
    }
    return membersOf(leadershipBodies().filter((group) => !group.campusId));
  }

  /*
   * A record's page lists every ask made from it, to anyone who may open the
   * record. What was *said* on an ask — a question, why it was declined, why
   * it could not be done — is between the people party to it, so everyone
   * else receives the ask without its notes.
   */
  const view = (viewer: Viewer, escalation: Escalation, held: RecipientRole[]): EscalationView => {
    const party = isPartyTo(escalation, viewer.person, held);
    const { decisionNote, ...rest } = escalation;
    return {
      ...rest,
      ...(party && decisionNote ? { decisionNote } : {}),
      activity: party ? repo.activityFor(escalation.id) : [],
      mine: addressedTo(escalation, viewer.person, held),
      askedByMe: escalation.requestedById === viewer.person.id,
      settled: isSettled(escalation.type, escalation.status),
    };
  };

  /**
   * One ask, for someone party to it. Anyone else is told it does not exist,
   * the same answer as for an ask that really does not.
   */
  function partyOnly(viewer: Viewer, id: string): { current: Escalation; held: RecipientRole[] } {
    const current = repo.find(id);
    const held = rolesHeldBy(viewer);
    if (!current || !isPartyTo(current, viewer.person, held)) {
      throw ApiError.notFound("That request");
    }
    return { current, held };
  }

  return {
    /** Which positions this viewer holds. Surfaced so the interface can say. */
    roles: rolesHeldBy,

    /**
     * The leadership inbox.
     *
     * Only what is **addressed to** this viewer, plus what they asked for
     * themselves. Being able to read a report has never put it here, which is
     * the difference between this and the review queue it replaced.
     */
    inbox(viewer: Viewer): LeadershipInbox {
      const held = rolesHeldBy(viewer);
      const all = repo.all().map((escalation) => view(viewer, escalation, held));

      const mine = all.filter((item) => item.mine && !item.settled).sort(escalationOrder);
      const answeredSince = new Date(
        Date.now() - ANSWERED_FOR_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      /*
       * Flagged records, over reports this viewer may already discover.
       *
       * The gate comes first and the projection second, which is the only
       * order that is safe: filtering a list of everything by "can they see
       * it?" afterwards is how a count, a title or a person's name leaks.
       */
      const flagged = (reports?.discoverable(viewer) ?? [])
        .filter((report) => triggersAttention(report.category))
        .filter((report) => isCurrent(report.status))
        .map((report): FlaggedRecord => ({
          id: report.id,
          kind: "report",
          title: report.title || "Untitled report",
          category: report.category ?? "general",
          categoryLabel: categoryLabelOf(report.category ?? "general"),
          authorId: report.authorId,
          ...(report.contextType ? { contextType: report.contextType } : {}),
          ...(report.contextId ? { contextId: report.contextId } : {}),
          contextLabel: contextLabel(report),
          at: report.updatedAt,
          path: `/leadership-reports/${report.id}`,
        }))
        .sort((a, b) => b.at.localeCompare(a.at));

      return {
        attention: mine.filter((item) => item.type === "attention"),
        actions: mine.filter((item) => item.type === "action"),
        approvals: mine.filter((item) => item.type === "approval"),
        flagged,
        mine,
        raisedByMe: all
          .filter((item) => item.requestedById === viewer.person.id && !item.settled)
          .sort(escalationOrder),
        answeredForMe: all
          .filter(
            (item) =>
              item.requestedById === viewer.person.id &&
              item.settled &&
              item.updatedAt >= answeredSince,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    },

    /** Everything asked from one record, for the record's own page. */
    forSource(viewer: Viewer, sourceType: Escalation["sourceType"], sourceId: string) {
      const held = rolesHeldBy(viewer);
      /* Only asks this viewer is party to. The list is keyed by a record id
         the caller supplies, and this service cannot tell whether they may
         see that record — so an ask on a record hidden from them must not
         be how its existence, or what was asked about it, leaks. */
      return repo
        .forSource(sourceType, sourceId)
        .filter((escalation) => isPartyTo(escalation, viewer.person, held))
        .map((escalation) => view(viewer, escalation, held));
    },

    get(viewer: Viewer, id: string): EscalationView {
      const { current, held } = partyOnly(viewer, id);
      return view(viewer, current, held);
    },

    /**
     * Ask for something.
     *
     * Anyone may ask. What they may not do is decide their own approval or
     * quietly address a request to nobody: a request with no recipient at all
     * is refused, because it would sit in a place nobody looks.
     */
    raise(viewer: Viewer, input: unknown): Escalation {
      const parsed = parse(raise, input);

      if (!parsed.requestedFromRole && !parsed.requestedFromPersonId) {
        throw ApiError.validation({
          requestedFrom: "Say who this is for, or it reaches nobody.",
        });
      }
      if (parsed.requestedFromPersonId && !organization.findPerson(parsed.requestedFromPersonId)) {
        throw ApiError.notFound("That person");
      }

      const type = parsed.type as EscalationType;
      const escalation = repo.insert({
        type,
        status: initialStatus[type],
        sourceType: parsed.sourceType,
        sourceId: parsed.sourceId,
        request: parsed.request,
        requestedById: viewer.person.id,
        ...(parsed.entryId ? { entryId: parsed.entryId } : {}),
        ...(parsed.contextLabel ? { contextLabel: parsed.contextLabel } : {}),
        ...(parsed.requestedFromRole ? { requestedFromRole: parsed.requestedFromRole } : {}),
        ...(parsed.requestedFromPersonId
          ? { requestedFromPersonId: parsed.requestedFromPersonId }
          : {}),
        ...(parsed.neededBy ? { neededBy: parsed.neededBy } : {}),
      });

      repo.addActivity(escalation.id, {
        actorId: viewer.person.id,
        summary:
          type === "attention"
            ? "asked leadership to take notice"
            : type === "action"
              ? "requested an action"
              : "requested approval",
        note: parsed.request,
      });

      return escalation;
    },

    /**
     * Move one along.
     *
     * Who may: the person it is addressed to, whoever it is assigned to, and
     * the person who asked — who may withdraw their own request by marking it
     * not required, and nothing else.
     */
    move(viewer: Viewer, input: unknown): Escalation {
      const parsed = parse(move, input);
      const current = repo.find(parsed.id);
      if (!current) throw ApiError.notFound("That request");

      const held = rolesHeldBy(viewer);
      const recipient = addressedTo(current, viewer.person, held);
      const requester = current.requestedById === viewer.person.id;
      const next = parsed.status as EscalationStatus;

      if (!recipient && !(requester && next === "not-required")) {
        throw ApiError.forbidden("This request is for the leader it was sent to.");
      }

      if (!allowedTransitions[current.status]?.includes(next)) {
        throw ApiError.conflict("This request cannot move there from where it stands.");
      }

      /* A decision is a decision: approving and declining record who did it. */
      const decides = next === "approved" || next === "declined";
      if (decides && current.type !== "approval") {
        throw ApiError.conflict("Only an approval request is approved or declined.");
      }
      if (next === "declined" && !parsed.note) {
        throw ApiError.validation({ note: "Say why, so the request can be reworked." });
      }

      const saved = repo.setStatus(parsed.id, next, {
        ...(next === "assigned" || next === "in-progress"
          ? { assigneeId: parsed.assigneeId ?? viewer.person.id }
          : {}),
        ...(decides ? { decidedById: viewer.person.id } : {}),
        ...(parsed.note ? { decisionNote: parsed.note } : {}),
      });
      if (!saved) throw ApiError.notFound("That request");

      repo.addActivity(parsed.id, {
        actorId: viewer.person.id,
        summary: summaryFor(next),
        ...(parsed.note ? { note: parsed.note } : {}),
      });

      return saved;
    },

    /**
     * Withdraw one.
     *
     * The person who asked may take it back while nobody has acted. Once a
     * decision is recorded it stays: deleting the record of an approval is
     * deleting the fact that it happened.
     */
    withdraw(viewer: Viewer, id: string): void {
      const { current } = partyOnly(viewer, id);
      if (current.requestedById !== viewer.person.id) {
        throw ApiError.forbidden("Only whoever asked may withdraw a request.");
      }
      if (current.decidedById) {
        throw ApiError.conflict("This has been decided. The decision stays on the record.");
      }
      /* A finished ask is the record of what was done about it. */
      if (!canWithdraw(current)) {
        throw ApiError.conflict("This has already been answered, so it stays on the record.");
      }
      repo.remove(id);
    },

    /**
     * Answer a question about one's own ask.
     *
     * When the recipient asks for more information, the ask waits on the
     * person who made it. Their answer is recorded as a note and puts the ask
     * back in front of the recipient as requested — the same request, never a
     * new one. Only the requester answers, and only while a question is open;
     * the recipient's own responses are unchanged.
     */
    reply(viewer: Viewer, input: unknown): Escalation {
      const parsed = parse(reply, input);
      const { current } = partyOnly(viewer, parsed.id);
      if (current.requestedById !== viewer.person.id) {
        throw ApiError.forbidden("Only whoever asked answers a question about it.");
      }
      if (current.status !== "more-information") {
        throw ApiError.conflict("Nobody has asked a question about this.");
      }

      const saved = repo.setStatus(parsed.id, "requested");
      if (!saved) throw ApiError.notFound("That request");

      repo.addActivity(parsed.id, {
        actorId: viewer.person.id,
        summary: "answered the question",
        note: parsed.note,
      });
      return saved;
    },

    /** Who a semantic recipient is at this moment. For the interface to say. */
    recipientsOf(role: RecipientRole, requesterId: string): string[] {
      if (!recipientRoles.includes(role)) return [];
      return resolveRecipients(role, requesterId);
    },
  };
}

function summaryFor(status: EscalationStatus): string {
  switch (status) {
    case "noted":
      return "noted this";
    case "raised":
      return "put this back";
    case "assigned":
      return "took this on";
    case "in-progress":
      return "started on this";
    case "completed":
      return "completed this";
    case "unable":
      return "could not complete this";
    case "not-required":
      return "marked this as not required";
    case "approved":
      return "approved this";
    case "declined":
      return "declined this";
    case "more-information":
      return "asked for more information";
    default:
      return "updated this";
  }
}

export type EscalationService = ReturnType<typeof createEscalationService>;
