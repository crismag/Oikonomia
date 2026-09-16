import { config } from "@/config";
import { text } from "@/config/messages";
import { currentRoles, personaFor } from "@/domain/roles";
import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import type { OrganizationRepository, PersonRecord } from "../repositories/organization-repository";
import type { Assignment, AssignmentScope, AssignmentStatus } from "@/domain/assignment";
import type { Campus, Ministry, ResponsibilityGroup, Venue } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";
import type { ChurchSetupProgress } from "@/domain/church-setup";

/**
 * The organisation: reading it, and who may change it.
 *
 * Reading is open. A directory of who is in the church and which ministries
 * exist is the context every other page needs in order to name anybody at all,
 * and withholding it would not protect anything — the confidential material is
 * the *content*: reports, entries, pastoral notes, each guarded where it
 * lives.
 *
 * Writing is administrative, with one deliberate exception. A venue is
 * operational: a leader arranging next Thursday's gathering at somebody's home
 * should not have to ask an administrator to name the home first.
 *
 * ## The first person
 *
 * A new installation has nobody in it, which means nobody can be an
 * administrator, which would make it impossible to add the first person. So
 * `claimFirstPerson` is open **only while the table is empty**, and the
 * account it creates is an administrator. Once one person exists the door
 * closes and never reopens.
 *
 * That is a real bootstrap, not a back door: it exists for exactly one write,
 * it is refused the moment it is not needed, and what it creates is a record
 * somebody actually entered rather than a fixture somebody shipped.
 */

const name = z.string().trim().min(1, "A name is required.").max(120);

/**
 * An access role this installation actually offers.
 *
 * A `z.enum` of the four the product ships was the last place the role list
 * was hard-coded: an administrator could define a role, the form would offer
 * it, and this would refuse the person — the exact failure the configuration
 * audit set out to find. Validated against the registry instead, and only
 * **active** roles may be assigned, so a role somebody stopped offering stays
 * readable on the people who already hold it without being given to anybody
 * new.
 */
const accessRole = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => currentRoles().some((role) => role.id === value),
    "That is not one of the access roles this church offers.",
  );

const campusInput = z.object({
  name,
  city: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
});

const personInput = z.object({
  name,
  role: z.string().trim().max(120).optional(),
  accessRole: accessRole.optional(),
  email: z.string().trim().email("That is not an email address.").max(200).optional(),
  campusId: z.string().trim().min(1).optional(),
  /* Who they report to. What "my reporting leader" resolves through. */
  reportsToId: z.string().trim().min(1).optional(),
  /** Still part of this church. Deactivating is not deleting — see below. */
  active: z.boolean().optional(),
});

const ministryInput = z.object({
  name,
  purpose: z.string().trim().max(500).optional(),
  campusId: z.string().trim().min(1).optional(),
  leadId: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

const venueInput = z.object({
  name,
  type: z.enum(["residence", "church", "park", "public-place", "other"]).optional(),
  hostId: z.string().trim().min(1).optional(),
  campusId: z.string().trim().min(1).optional(),
  area: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
});

const groupInput = z.object({
  name,
  description: z.string().trim().max(500).optional(),
  campusId: z.string().trim().min(1).optional(),
  /**
   * Whether a report addressed to "leadership" reaches this group.
   *
   * This is the only place the leadership audience is decided. It used to be
   * two constants compiled into the product, which meant a church could not
   * say who its leadership was — it could only accept ours.
   */
  leadershipAudience: z.boolean().optional(),
  active: z.boolean().optional(),
  /**
   * What kind of body this is. Vocabulary the church configures, and
   * deliberately without consequence: what a group *does* comes from its
   * leadership-audience flag and its campus, so a church may name its kinds
   * however it likes without changing who reaches what.
   */
  groupType: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => config.options("organization.groupTypes").some((option) => option.id === value),
      "That is not one of the kinds of group this church uses.",
    )
    .optional(),
  /** Structure, not policy: nothing is inherited through a parent. */
  parentGroupId: z.string().trim().min(1).optional(),
});

export interface Organization {
  campuses: Campus[];
  people: PersonRecord[];
  ministries: Ministry[];
  venues: Venue[];
  groups: ResponsibilityGroup[];
}

export function createOrganizationService(repo: OrganizationRepository) {
  /**
   * Somebody has to be left who can administer Oikonomia.
   *
   * Deactivating the last person who holds a role with the `administration`
   * capability would leave an installation nobody can administer, and the only
   * screen that could undo it is the one that just closed. Refused before the
   * write, so the failure is a message rather than a recovery.
   *
   * The mirror of the guard in `configuration-service.ts`: that one stops the
   * capability being taken off the last role, this one stops the last person
   * holding it from being switched off.
   */
  const guardAdministrationSurvives = (leaving: string): void => {
    const remaining = repo
      .people()
      .filter((person) => person.id !== leaving && person.active !== false)
      .filter((person) =>
        personaFor(person.accessRole, person.id).capabilities.includes("administration"),
      );

    if (remaining.length === 0) {
      throw ApiError.conflict(
        "Somebody has to be able to administer Oikonomia. Give another person an administering role first.",
      );
    }
  };

  /** The ministry or group exists, and is one somebody may still be put in. */
  const requireTarget = (scope: AssignmentScope, targetId: string): void => {
    if (scope === "ministry") {
      const ministry = repo.findMinistry(targetId);
      if (!ministry) throw ApiError.notFound("That ministry");
      if (ministry.active === false) {
        throw ApiError.conflict("That ministry is no longer running.");
      }
      return;
    }
    const group = repo.findGroup(targetId);
    if (!group) throw ApiError.notFound("That group");
    if (!group.active) throw ApiError.conflict("That group is no longer active.");
  };

  const requireAdmin = (viewer: Viewer): void => {
    if (!viewer.persona.capabilities.includes("administration")) {
      throw ApiError.forbidden(text("refusal.organization.admin"));
    }
  };

  /*
   * Nobody confirms their own place.
   *
   * Being an administrator is the power to decide where *other* people serve.
   * Turned on oneself it would let one account join any ministry, lead it, or
   * sit in the leadership audience of every report — access nobody else agreed
   * to. So a write that would widen what the administrator themselves can
   * reach is refused; one that leaves it as it is, or narrows it, is not.
   */
  const refuseSelfGrant = (viewer: Viewer, personId: string | undefined, widens: boolean) => {
    if (widens && personId === viewer.person.id) {
      throw ApiError.forbidden(text("refusal.organization.self"));
    }
  };

  const everything = (): Organization => ({
    campuses: repo.campuses(),
    people: repo.people(),
    ministries: repo.ministries(),
    venues: repo.venues(),
    groups: repo.groups(),
  });

  return {
    /**
     * What the session call may show this browser.
     *
     * Everything, to somebody signed in. Nothing, to nobody: the call is made
     * before sign-in so the shell can find out whether anybody is signed in,
     * and answering it with the directory handed every visitor the church's
     * names, email addresses and access roles. The sign-in and setup screens
     * need none of it.
     */
    visibleTo(viewer: Viewer | undefined): Organization {
      if (!viewer) return { campuses: [], people: [], ministries: [], venues: [], groups: [] };
      return everything();
    },

    /** Everything the rest of the product needs to name people and places. */
    all: everything,

    /**
     * Create the first person, and only the first.
     *
     * Refused as soon as anybody exists — including by the person who ran it a
     * moment ago, who must now sign in as themselves.
     */
    claimFirstPerson(input: unknown): PersonRecord {
      if (!repo.isEmpty()) {
        throw ApiError.forbidden("Oikonomia has already been set up. Sign in instead.");
      }
      const parsed = parse(personInput, input);
      return repo.insertPerson({
        name: parsed.name,
        accessRole: "admin",
        ...(parsed.role ? { role: parsed.role } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
      });
    },

    /**
     * Rename a campus, or stop offering it.
     *
     * There was no way to change a campus at all. An inactive one is not
     * offered for anything new and stays readable everywhere it is named.
     */
    updateCampus(viewer: Viewer, id: string, input: unknown): Campus {
      requireAdmin(viewer);
      const parsed = parse(campusInput.partial(), input);
      const saved = repo.updateCampus(id, parsed);
      if (!saved) throw ApiError.notFound("That campus");
      return saved;
    },

    addCampus(viewer: Viewer, input: unknown): Campus {
      requireAdmin(viewer);
      const parsed = parse(campusInput, input);
      return repo.insertCampus({
        name: parsed.name,
        ...(parsed.city ? { city: parsed.city } : {}),
      });
    },

    addPerson(viewer: Viewer, input: unknown): PersonRecord {
      requireAdmin(viewer);
      const parsed = parse(personInput, input);
      if (parsed.email && repo.findPersonByEmail(parsed.email)) {
        /* Two people, one address, is a merge nobody asked for. Refuse it and
           let a person decide which account this is. */
        throw ApiError.conflict("Somebody is already using that email address.");
      }
      return repo.insertPerson({
        name: parsed.name,
        ...(parsed.role ? { role: parsed.role } : {}),
        ...(parsed.accessRole ? { accessRole: parsed.accessRole } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.campusId ? { campusId: parsed.campusId } : {}),
        ...(parsed.reportsToId ? { reportsToId: parsed.reportsToId } : {}),
      });
    },

    updatePerson(viewer: Viewer, id: string, input: unknown): PersonRecord {
      requireAdmin(viewer);
      const parsed = parse(personInput.partial(), input);

      /*
       * Nobody reports to themselves.
       *
       * The reporting line is what "my reporting leader" resolves through, so
       * a self-reference would address somebody's own request back to them —
       * an ask that can never be answered by anyone else and never escalates.
       * Refused here because this is where it can happen: adding a person
       * cannot name an id that does not exist yet.
       */
      if (parsed.reportsToId === id) {
        throw ApiError.validation({
          reportsToId: "Somebody cannot report to themselves. Leave it unset if there is nobody.",
        });
      }

      /* Same rule as adding: two people, one address, is a merge nobody
         asked for. */
      if (parsed.email) {
        const holder = repo.findPersonByEmail(parsed.email);
        if (holder && holder.id !== id) {
          throw ApiError.conflict("Somebody is already using that email address.");
        }
      }

      if (parsed.active === false) guardAdministrationSurvives(id);

      const saved = repo.updatePerson(id, parsed);
      if (!saved) throw ApiError.notFound("That person");
      return saved;
    },

    addMinistry(viewer: Viewer, input: unknown): Ministry {
      requireAdmin(viewer);
      const parsed = parse(ministryInput, input);
      refuseSelfGrant(viewer, parsed.leadId, true);
      return repo.insertMinistry({
        name: parsed.name,
        ...(parsed.purpose ? { purpose: parsed.purpose } : {}),
        ...(parsed.campusId ? { campusId: parsed.campusId } : {}),
        ...(parsed.leadId ? { leadId: parsed.leadId } : {}),
      });
    },

    updateMinistry(viewer: Viewer, id: string, input: unknown): Ministry {
      requireAdmin(viewer);
      const parsed = parse(ministryInput.partial(), input);
      refuseSelfGrant(viewer, parsed.leadId, repo.findMinistry(id)?.leadId !== parsed.leadId);
      const saved = repo.updateMinistry(id, parsed);
      if (!saved) throw ApiError.notFound("That ministry");
      return saved;
    },

    setMembership(
      viewer: Viewer,
      input: { ministryId: string; personId: string; member: boolean; shared?: boolean },
    ): Ministry {
      requireAdmin(viewer);
      if (!repo.findMinistry(input.ministryId)) throw ApiError.notFound("That ministry");
      if (!repo.findPerson(input.personId)) throw ApiError.notFound("That person");
      const ministry = repo.findMinistry(input.ministryId)!;
      const already = input.shared
        ? (ministry.sharedWithIds ?? []).includes(input.personId)
        : ministry.teamIds.includes(input.personId) || ministry.leadId === input.personId;
      refuseSelfGrant(viewer, input.personId, input.member && !already);

      if (input.member) repo.addMember(input.ministryId, input.personId, input.shared ?? false);
      else repo.removeMember(input.ministryId, input.personId);

      return repo.findMinistry(input.ministryId)!;
    },

    /* -------------------------------------------- responsibility groups */

    /**
     * Name a body of responsibility — an eldership, a campus leadership team,
     * a safeguarding panel.
     *
     * Administrative because a group is an **audience**: marking one as the
     * leadership audience decides who a confidential report reaches. That is
     * an authorization decision, so it is refused to everybody else.
     */
    addGroup(viewer: Viewer, input: unknown): ResponsibilityGroup {
      requireAdmin(viewer);
      const parsed = parse(groupInput, input);
      if (parsed.parentGroupId && !repo.findGroup(parsed.parentGroupId)) {
        throw ApiError.notFound("That parent group");
      }

      return repo.insertGroup({
        name: parsed.name,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.campusId ? { campusId: parsed.campusId } : {}),
        leadershipAudience: parsed.leadershipAudience ?? false,
        ...(parsed.groupType ? { groupType: parsed.groupType } : {}),
        ...(parsed.parentGroupId ? { parentGroupId: parsed.parentGroupId } : {}),
      });
    },

    updateGroup(viewer: Viewer, id: string, input: unknown): ResponsibilityGroup {
      requireAdmin(viewer);
      const parsed = parse(groupInput.partial(), input);

      /* A group cannot be its own parent, and a parent must exist. Neither
         grants anything — nesting is structure — but a cycle would make the
         structure view unrenderable. */
      if (parsed.parentGroupId === id) {
        throw ApiError.validation({ parentGroupId: "A group cannot sit under itself." });
      }
      if (parsed.parentGroupId && !repo.findGroup(parsed.parentGroupId)) {
        throw ApiError.notFound("That parent group");
      }
      const saved = repo.updateGroup(id, parsed);
      if (!saved) throw ApiError.notFound("That group");
      return saved;
    },

    setGroupMembership(
      viewer: Viewer,
      input: { groupId: string; personId: string; member: boolean },
    ): ResponsibilityGroup {
      requireAdmin(viewer);
      if (!repo.findGroup(input.groupId)) throw ApiError.notFound("That group");
      if (!repo.findPerson(input.personId)) throw ApiError.notFound("That person");
      refuseSelfGrant(
        viewer,
        input.personId,
        input.member && !repo.findGroup(input.groupId)!.memberIds.includes(input.personId),
      );
      repo.setGroupMembership(input.groupId, input.personId, input.member);
      return repo.findGroup(input.groupId)!;
    },

    /* -------------------------------------------------------- assignments */

    /**
     * Everywhere one person serves, whatever state each assignment is in.
     *
     * Open to any signed-in viewer, like the rest of the directory: where
     * somebody serves is organisational context, and the confidential material
     * is the content of what they write, guarded where it lives.
     */
    assignmentsFor(_viewer: Viewer, personId: string): Assignment[] {
      return repo.assignmentsFor(personId);
    },

    /**
     * Say where somebody serves, authoritatively.
     *
     * Administrative, because a confirmed assignment is what other modules read
     * as membership — and membership opens a ministry's information.
     */
    setAssignment(
      viewer: Viewer,
      input: {
        scope: AssignmentScope;
        targetId: string;
        personId: string;
        function?: string;
        status?: AssignmentStatus;
        shared?: boolean;
      },
    ): Assignment[] {
      requireAdmin(viewer);
      requireTarget(input.scope, input.targetId);
      if (!repo.findPerson(input.personId)) throw ApiError.notFound("That person");

      const status = input.status ?? "confirmed";
      const existing = repo.findAssignment(input.scope, input.targetId, input.personId);
      refuseSelfGrant(
        viewer,
        input.personId,
        status === "confirmed" &&
          !(existing?.status === "confirmed" && existing.function === (input.function ?? "")),
      );

      repo.setAssignment({
        scope: input.scope,
        targetId: input.targetId,
        personId: input.personId,
        function: input.function ?? "",
        status,
        shared: input.shared ?? false,
      });
      return repo.assignmentsFor(input.personId);
    },

    /**
     * Say where **you** serve.
     *
     * What somebody says about themselves is a claim, and this is the whole
     * reason assignments carry a status: a claim is written as `pending` and
     * waits for somebody who may decide. Onboarding calls this, which is why
     * onboarding cannot be used to join a ministry.
     *
     * Refused for anybody else's record — claiming on somebody else's behalf
     * is not a claim, it is an assignment.
     */
    claimAssignment(
      viewer: Viewer,
      input: { scope: AssignmentScope; targetId: string; function?: string },
    ): Assignment[] {
      requireTarget(input.scope, input.targetId);

      const existing = repo.findAssignment(input.scope, input.targetId, viewer.person.id);
      /* Already confirmed: claiming it again changes nothing rather than
         downgrading a decision somebody already made. */
      if (existing && existing.status === "confirmed") return repo.assignmentsFor(viewer.person.id);

      repo.setAssignment({
        scope: input.scope,
        targetId: input.targetId,
        personId: viewer.person.id,
        function: input.function ?? existing?.function ?? "",
        status: "pending",
      });
      return repo.assignmentsFor(viewer.person.id);
    },

    /**
     * Say that a record about you is wrong.
     *
     * Marks the assignment for an administrator to look at. It stays
     * **confirmed-in-effect only if it already was** — a correction request
     * never widens anything and never silently removes somebody from a group
     * either; it asks a person to decide.
     */
    requestCorrection(
      viewer: Viewer,
      input: { scope: AssignmentScope; targetId: string },
    ): Assignment[] {
      const existing = repo.findAssignment(input.scope, input.targetId, viewer.person.id);
      if (!existing) throw ApiError.notFound("That assignment");

      repo.setAssignment({
        scope: input.scope,
        targetId: input.targetId,
        personId: viewer.person.id,
        function: existing.function,
        status: "correction-requested",
        ...(existing.shared !== undefined ? { shared: existing.shared } : {}),
      });
      return repo.assignmentsFor(viewer.person.id);
    },

    /** Everything waiting on somebody who may decide. */
    /** How far the church's setup has got. Administrative: it counts accounts. */
    setupProgress(viewer: Viewer): ChurchSetupProgress {
      requireAdmin(viewer);
      return {
        campuses: repo.campuses().filter((campus) => campus.active !== false).length,
        ministries: repo.ministries().filter((ministry) => ministry.active !== false).length,
        people: repo.people().filter((person) => person.active !== false).length,
        ...repo.setupCounts(viewer.person.id),
      };
    },

    assignmentsAwaitingDecision(viewer: Viewer) {
      requireAdmin(viewer);
      return repo.assignmentsAwaitingDecision();
    },

    /** Operational, not administrative — see the note at the top. */
    addVenue(_viewer: Viewer, input: unknown): Venue {
      const parsed = parse(venueInput, input);
      return repo.insertVenue({
        name: parsed.name,
        ...(parsed.type ? { type: parsed.type } : {}),
        ...(parsed.hostId ? { hostId: parsed.hostId } : {}),
        ...(parsed.campusId ? { campusId: parsed.campusId } : {}),
        ...(parsed.area ? { area: parsed.area } : {}),
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      });
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
