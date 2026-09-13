import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { Campus, Ministry, Persona, ResponsibilityGroup, Venue } from "@/domain/types";

/**
 * The organisation's API, and the session's.
 *
 * They are one module because the shell asks one question — *who is this, and
 * what is there?* — and because the answer to the second is what makes the
 * first renderable: a person's name, their campus, the ministries they are on.
 *
 * Every handler here reads the database. None of it is compiled into the
 * application, which is the point: a new installation returns nobody and
 * nothing, and the interface says so.
 */

export type PersonRecord = import("@/server/repositories/organization-repository").PersonRecord;

export interface SessionSnapshot {
  /** Who is signed in, if anybody is. */
  viewer: { person: PersonRecord; persona: Persona } | null;
  /** True when nobody has been added yet and the installation needs setting up. */
  setupRequired: boolean;
  /**
   * True when **this person** has not been through setup, or went through an
   * older version of it.
   *
   * Carried on the session because the shell has to decide where to send
   * somebody before anything renders, and a second request to find that out
   * would show the wrong page first.
   */
  onboardingRequired: boolean;
  campuses: Campus[];
  people: PersonRecord[];
  ministries: Ministry[];
  venues: Venue[];
  /**
   * The bodies of responsibility the church has named, with their members.
   *
   * Travels with the session because audience decisions are made against it:
   * which groups count as "leadership" is a property of these records, not of
   * anything compiled into the product.
   */
  groups: ResponsibilityGroup[];
  /**
   * What an administrator has changed about the product's vocabulary.
   *
   * Travels with the session because every page renders labels, and one
   * request for both means the interface never draws a shipped label and then
   * corrects itself a moment later.
   */
  configuration: WireOverride[];
}

type WireOverride = import("./configuration-api").WireOverride;
type Service = import("@/server/services/organization-service").OrganizationService;
type Viewer = import("@/domain/viewer").Viewer;

/**
 * Configuration overrides, read on the server and applied there too.
 *
 * Applied before this request answers, so anything the server renders or
 * validates uses the church's own wording rather than the shipped defaults —
 * the frontend and the backend must not be able to disagree about what a
 * status is called.
 */
async function overridesForThisRequest(): Promise<WireOverride[]> {
  try {
    const [
      { getDatabase },
      { refreshConfiguration },
      { createConfigurationRepository },
      { applyOverrides },
    ] = await Promise.all([
      import("@/server/db/connection"),
      import("@/server/config/runtime"),
      import("@/server/repositories/configuration-repository"),
      import("@/config"),
    ]);

    const overrides = createConfigurationRepository(getDatabase()).all();
    applyOverrides(overrides);
    return overrides as WireOverride[];
  } catch (error) {
    /* Configuration that cannot be read must never take a page down: the
       application falls back to what shipped, which is always valid. */
    console.error(error);
    return [];
  }
}

/**
 * Whether this person still owes a pass through setup.
 *
 * Read here rather than in the onboarding service because the session is the
 * one request the shell always makes; asking twice would mean rendering the
 * wrong page and then correcting it.
 */
async function onboardingRequiredFor(personId: string): Promise<boolean> {
  try {
    const [{ getDatabase }, { createOnboardingRepository }, { setupRequired }] = await Promise.all([
      import("@/server/db/connection"),
      import("@/server/repositories/onboarding-repository"),
      import("@/domain/onboarding"),
    ]);
    return setupRequired(createOnboardingRepository(getDatabase()).find(personId));
  } catch (error) {
    /* Never let this take the shell down: not knowing means not nagging. */
    console.error(error);
    return false;
  }
}

async function serverParts() {
  const [
    { ApiError },
    { getCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createOrganizationRepository },
    { createOrganizationService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/current-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/organization-service"),
    import("@tanstack/react-start/server"),
  ]);

  const db = getDatabase();
  /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
  refreshConfiguration(db);
  const repo = createOrganizationRepository(db);
  return {
    ApiError,
    repo,
    service: createOrganizationService(repo),
    viewer: getCurrentUser(getRequest(), db),
  };
}

async function withOrganization<T>(
  work: (service: Service, viewer: Viewer) => T,
): Promise<Result<T>> {
  const { ApiError, service, viewer } = await serverParts();
  try {
    if (!viewer) {
      throw ApiError.unauthenticated("Nobody is signed in on this browser.");
    }
    return { data: work(service, viewer) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved. Please try again." } };
  }
}

/**
 * Who is signed in, and what exists.
 *
 * Deliberately **not** refused when nobody is signed in: this is the call the
 * shell makes in order to find that out, and it has to succeed in order to
 * render the sign-in screen.
 */
export const fetchSession = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<Result<SessionSnapshot>> => {
    const { ApiError, repo, service, viewer } = await serverParts();
    try {
      const organization = service.visibleTo(viewer);
      return {
        data: {
          viewer: viewer
            ? { person: viewer.person as PersonRecord, persona: viewer.persona }
            : null,
          setupRequired: repo.isEmpty(),
          onboardingRequired: viewer ? await onboardingRequiredFor(viewer.person.id) : false,
          configuration: await overridesForThisRequest(),
          ...organization,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      console.error(error);
      return { error: { code: "internal", message: "Oikonomia could not be reached." } };
    }
  });

/** The first person on a new installation. Refused once anybody exists. */
export const claimFirstPerson = createServerFn({ method: "POST" })
  .validator((input: { name: string; role?: string; email?: string }) => input)
  .handler(async ({ data }): Promise<Result<PersonRecord>> => {
    const { ApiError, service } = await serverParts();
    try {
      return { data: service.claimFirstPerson(data) };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      console.error(error);
      return { error: { code: "internal", message: "That could not be saved. Please try again." } };
    }
  });

export const addCampus = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withOrganization((service, viewer) => service.addCampus(viewer, data)));

export const addPerson = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withOrganization((service, viewer) => service.addPerson(viewer, data)));

export const updatePerson = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.updatePerson(viewer, data.id, data.patch)),
  );

export const addMinistry = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withOrganization((service, viewer) => service.addMinistry(viewer, data)));

export const updateMinistry = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.updateMinistry(viewer, data.id, data.patch)),
  );

export const setMembership = createServerFn({ method: "POST" })
  .validator(
    (input: { ministryId: string; personId: string; member: boolean; shared?: boolean }) => input,
  )
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.setMembership(viewer, data)),
  );

export const addVenue = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withOrganization((service, viewer) => service.addVenue(viewer, data)));

export const addGroup = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withOrganization((service, viewer) => service.addGroup(viewer, data)));

export const updateGroup = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.updateGroup(viewer, data.id, data.patch)),
  );

export const setGroupMembership = createServerFn({ method: "POST" })
  .validator((input: { groupId: string; personId: string; member: boolean }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.setGroupMembership(viewer, data)),
  );

/* ------------------------------------------------------------ assignments */

export const fetchAssignments = createServerFn({ method: "GET" })
  .validator((input: { personId: string }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.assignmentsFor(viewer, data.personId)),
  );

/** Authoritative. Administrative. */
export const setAssignment = createServerFn({ method: "POST" })
  .validator(
    (input: {
      scope: "ministry" | "group";
      targetId: string;
      personId: string;
      function?: string;
      status?: "confirmed" | "pending" | "correction-requested" | "ended";
      shared?: boolean;
    }) => input,
  )
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.setAssignment(viewer, data)),
  );

/**
 * What somebody says about their own service.
 *
 * Written as a claim awaiting confirmation, never as membership. This is the
 * call onboarding makes, which is why onboarding cannot be used to join
 * anything.
 */
export const claimAssignment = createServerFn({ method: "POST" })
  .validator((input: { scope: "ministry" | "group"; targetId: string; function?: string }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.claimAssignment(viewer, data)),
  );

export const requestAssignmentCorrection = createServerFn({ method: "POST" })
  .validator((input: { scope: "ministry" | "group"; targetId: string }) => input)
  .handler(({ data }) =>
    withOrganization((service, viewer) => service.requestCorrection(viewer, data)),
  );

export const fetchAssignmentsAwaitingDecision = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withOrganization((service, viewer) => service.assignmentsAwaitingDecision(viewer)),
  );
