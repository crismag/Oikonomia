import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * Onboarding's API.
 *
 * Four calls, all of which read the organisation fresh. None of them writes an
 * organisational fact: confirming where you serve goes through
 * `claimAssignment` in `organization-api`, which records a claim rather than a
 * membership. That separation is the whole security property of this flow, and
 * it lives in the service rather than here.
 */

export type OnboardingContext = import("@/server/services/onboarding-service").OnboardingContext;

async function serverParts() {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createOnboardingRepository },
    { createOrganizationRepository },
    { createOnboardingService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/onboarding-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/onboarding-service"),
    import("@tanstack/react-start/server"),
  ]);

  const db = getDatabase();
  /* An administrator's configuration is effective on the next request, not the
     next deployment. */
  refreshConfiguration(db);

  return {
    ApiError,
    service: createOnboardingService(
      createOnboardingRepository(db),
      createOrganizationRepository(db),
    ),
    viewer: requireCurrentUser(getRequest(), db),
  };
}

async function withOnboarding<T>(
  work: (
    service: import("@/server/services/onboarding-service").OnboardingService,
    viewer: import("@/domain/viewer").Viewer,
  ) => T,
): Promise<Result<T>> {
  try {
    const { ApiError, service, viewer } = await serverParts();
    try {
      return { data: work(service, viewer) };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      throw error;
    }
  } catch (error) {
    const { ApiError } = await import("@/server/api/response");
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "Setup could not be reached." } };
  }
}

export const fetchOnboarding = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withOnboarding((service, viewer) => service.context(viewer)));

export const startOnboarding = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() => withOnboarding((service, viewer) => service.start(viewer)));

export const moveOnboarding = createServerFn({ method: "POST" })
  .validator((input: { step: string }) => input)
  .handler(({ data }) => withOnboarding((service, viewer) => service.moveTo(viewer, data.step)));

/** Say what you are called — only while an invitation left your address as your name. */
export const giveOwnName = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => input)
  .handler(({ data }) => withOnboarding((service, viewer) => service.giveOwnName(viewer, data)));

export const completeOnboarding = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() => withOnboarding((service, viewer) => service.complete(viewer)));
