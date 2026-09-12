import { ApiError } from "../api/response";
import {
  ONBOARDING_VERSION,
  onboardingSteps,
  setupRequired,
  stepsFor,
  tourFor,
  type OnboardingState,
  type OnboardingStep,
  type TourStop,
} from "@/domain/onboarding";
import { isServing, type Assignment } from "@/domain/assignment";
import type { OnboardingRepository } from "../repositories/onboarding-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { Campus, Ministry, ResponsibilityGroup } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Setting a leader up, and showing them round.
 *
 * ## What this service is allowed to change
 *
 * Its own progress row. Nothing else.
 *
 * Every organisational fact these screens show is read from the organisation's
 * records, and every change a person makes goes back through
 * `organization-service`, which writes what somebody says about themselves as a
 * **claim awaiting confirmation**. There is no path from this flow to
 * membership, a function, a role, a capability or a reporting line — which is
 * why onboarding cannot be used to join anything, and why an administrator's
 * decisions cannot be overwritten by a person replaying their own setup.
 *
 * ## Replay is not a reset
 *
 * `start` on somebody who has already finished reopens the flow at the
 * beginning **without** clearing what they confirmed, and `assignmentsFor`
 * returns the organisation as it now stands. Confirming the same ministry a
 * second time is a no-op rather than a second claim.
 */

export interface OnboardingContext {
  state: OnboardingState;
  /** Which steps this person sees, with the empty ones removed. */
  steps: OnboardingStep[];
  /** True when they still owe a pass — never started, or an older version. */
  required: boolean;
  person: { id: string; name: string; role: string; campusId: string };
  roleLabel: string;
  campus?: Campus;
  /** Everywhere they serve, in whatever state. */
  assignments: Assignment[];
  /** What is on offer to say you are part of. */
  ministries: Ministry[];
  groups: ResponsibilityGroup[];
  /** Who the church says they report to, if anybody. */
  reportsTo?: { id: string; name: string };
  /** Who reports to them. Derived, never stored twice. */
  oversees: { id: string; name: string }[];
  tour: TourStop[];
}

export function createOnboardingService(
  repo: OnboardingRepository,
  organization: OrganizationRepository,
) {
  /** Everything the flow needs, read fresh every time it is asked. */
  function context(viewer: Viewer): OnboardingContext {
    const me = viewer.person.id;
    const state = repo.find(me);
    const assignments = organization.assignmentsFor(me);

    const ministries = organization.ministries().filter((m) => m.active !== false);
    const groups = organization.groups().filter((g) => g.active);

    const people = organization.people();
    const reportsToId = organization.findPerson(me)?.reportsToId;
    const reportsTo = reportsToId ? people.find((p) => p.id === reportsToId) : undefined;
    const oversees = people
      .filter((person) => person.reportsToId === me && person.active !== false)
      .map((person) => ({ id: person.id, name: person.name }));

    const campus = organization.campuses().find((c) => c.id === viewer.person.campusId);

    const steps = stepsFor({
      hasMinistries: ministries.length > 0,
      hasGroups: groups.length > 0,
      /* Nothing to confirm is not a screen. */
      hasReportingContext: Boolean(reportsTo) || oversees.length > 0,
    });

    return {
      state,
      steps,
      required: setupRequired(state),
      person: {
        id: viewer.person.id,
        name: viewer.person.name,
        role: viewer.person.role,
        campusId: viewer.person.campusId,
      },
      roleLabel: viewer.persona.label,
      ...(campus ? { campus } : {}),
      assignments,
      ministries,
      groups,
      ...(reportsTo ? { reportsTo: { id: reportsTo.id, name: reportsTo.name } } : {}),
      oversees,
      tour: tourFor(viewer.persona),
    };
  }

  return {
    context,

    /**
     * Begin, or begin again.
     *
     * Idempotent: starting a run somebody is already in the middle of returns
     * them to where they were rather than to the first screen. Starting one
     * they have finished reopens it and clears nothing — replay is not a reset.
     */
    start(viewer: Viewer): OnboardingContext {
      const existing = repo.find(viewer.person.id);
      if (existing.status === "in-progress") return context(viewer);

      repo.save(viewer.person.id, {
        status: "in-progress",
        step: "welcome",
        version: existing.version,
      });
      return context(viewer);
    },

    /** Record where they have got to, so closing the browser loses nothing. */
    moveTo(viewer: Viewer, step: string): OnboardingContext {
      if (!(onboardingSteps as readonly string[]).includes(step)) {
        throw ApiError.validation({ step: "That is not one of the steps." });
      }

      const existing = repo.find(viewer.person.id);
      repo.save(viewer.person.id, {
        status: "in-progress",
        step: step as OnboardingStep,
        version: existing.version,
      });
      return context(viewer);
    },

    /**
     * Finish.
     *
     * Records the version completed, which is what makes "one new thing to
     * confirm" expressible later without dragging somebody through the whole
     * flow again.
     */
    complete(viewer: Viewer): OnboardingContext {
      repo.save(viewer.person.id, {
        status: "complete",
        step: "summary",
        version: ONBOARDING_VERSION,
      });
      return context(viewer);
    },

    /**
     * What to tell somebody at the end.
     *
     * Counts only what is **confirmed**, and says separately how many things
     * are waiting on somebody else. Promising a workspace built from claims
     * nobody has agreed to would be promising visibility authorization does not
     * grant.
     */
    summary(viewer: Viewer): {
      serving: number;
      awaiting: number;
      reportsTo?: string;
      oversees: number;
    } {
      const ctx = context(viewer);
      return {
        serving: ctx.assignments.filter((a) => isServing(a.status)).length,
        awaiting: ctx.assignments.filter(
          (a) => a.status === "pending" || a.status === "correction-requested",
        ).length,
        ...(ctx.reportsTo ? { reportsTo: ctx.reportsTo.name } : {}),
        oversees: ctx.oversees.length,
      };
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
