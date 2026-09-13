import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * The entrance to a public demonstration.
 *
 * Three calls: what the sign-in screen offers, entering as one of the offered
 * identities, and trying Oikonomia as yourself. Each ends — if it succeeds — in
 * the ordinary session cookie, after which nothing distinguishes a
 * demonstration visitor's requests from anybody else's.
 *
 * On an ordinary installation `fetchDemoEntry` answers `{ demo: false }` and
 * the other two refuse. See `src/server/demo/demo-entry-service.ts`.
 */

export type DemoEntry = import("@/server/demo/demo-entry-service").DemoEntry;
export type DemoIdentityOption = import("@/server/demo/demo-entry-service").DemoIdentityOption;

async function serverParts() {
  const [
    { ApiError },
    { getDatabase },
    { refreshConfiguration },
    { currentInstallation },
    { createAccountRepository },
    { createOrganizationRepository },
    { createDemoIdentityRepository },
    { createAuthService },
    { createDemoEntryService },
    { SESSION_COOKIE, cookieValue, sessionCookie },
    { getRequest, setResponseHeader },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/installation/policy"),
    import("@/server/repositories/account-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/repositories/demo-identity-repository"),
    import("@/server/services/auth-service"),
    import("@/server/demo/demo-entry-service"),
    import("@/server/auth/principal"),
    import("@tanstack/react-start/server"),
  ]);

  const db = getDatabase();
  /* The role names on the sign-in screen are this installation's own. */
  refreshConfiguration(db);

  const accounts = createAccountRepository(db);
  const organization = createOrganizationRepository(db);
  const request = getRequest();
  const currentToken = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const userAgent = request.headers.get("user-agent");

  return {
    ApiError,
    service: createDemoEntryService({
      demoMode: currentInstallation().demoMode,
      identities: createDemoIdentityRepository(db),
      accounts,
      organization,
      auth: createAuthService(accounts, organization),
      transaction: (work) => db.transaction(work)(),
    }),
    context: { ...(currentToken ? { currentToken } : {}), ...(userAgent ? { userAgent } : {}) },
    signIn: (token: string) => setResponseHeader("Set-Cookie", sessionCookie(token)),
  };
}

async function withDemo<T>(
  work: (parts: Awaited<ReturnType<typeof serverParts>>) => T,
): Promise<Result<T>> {
  try {
    const parts = await serverParts();
    try {
      return { data: work(parts) };
    } catch (error) {
      if (error instanceof parts.ApiError) return { error: error.body() };
      throw error;
    }
  } catch (error) {
    console.error(error);
    return {
      error: { code: "internal", message: "The demo could not be opened. Please try again." },
    };
  }
}

/** What the demonstration's sign-in screen offers, if this is one. */
export const fetchDemoEntry = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withDemo(({ service }): DemoEntry => service.entry()));

/** Explore as one of the people the demonstration offers. */
export const enterDemoAs = createServerFn({ method: "POST" })
  .validator((input: { identityId: string }) => input)
  .handler(({ data }) =>
    withDemo(({ service, context, signIn }) => {
      const { token } = service.enter(data, context);
      signIn(token);
      return { entered: true };
    }),
  );

/** Try Oikonomia as yourself, with nothing but a name. */
export const createDemoVisitor = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => input)
  .handler(({ data }) =>
    withDemo(({ service, context, signIn }) => {
      const { token } = service.createVisitor(data, context);
      signIn(token);
      return { entered: true };
    }),
  );
