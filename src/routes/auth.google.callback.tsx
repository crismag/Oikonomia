import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Coming back from Google.
 *
 * Four things have to be true before anybody is signed in: Google is
 * configured, a `state` was remembered, the returned `state` matches it, and
 * the code exchanges for an identity this installation has an account for.
 *
 * Every failure lands on the sign-in page with a generic message. Saying which
 * check failed would tell somebody probing exactly which one to work on — and
 * "that Google account is not set up here" is already as specific as it is safe
 * to be.
 */
export const Route = createFileRoute("/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { exchange, googleConfigured, stateMatches },
          { STATE_COOKIE, clearStateCookie },
          { cookieValue, sessionCookie },
          { getDatabase },
          { createAccountRepository },
          { createOrganizationRepository },
          { createAuthService },
        ] = await Promise.all([
          import("@/server/auth/google"),
          import("@/server/auth/oauth-state"),
          import("@/server/auth/principal"),
          import("@/server/db/connection"),
          import("@/server/repositories/account-repository"),
          import("@/server/repositories/organization-repository"),
          import("@/server/services/auth-service"),
        ]);

        const back = (why: string) =>
          new Response(null, {
            status: 302,
            headers: {
              location: `/login?step=${why}`,
              "set-cookie": clearStateCookie(),
            },
          });

        if (!googleConfigured()) return back("sign-in");

        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state") ?? "";
        const expectedState = cookieValue(request.headers.get("cookie"), STATE_COOKIE) ?? "";

        /* Checked before the code is spent: an unmatched state means this
           callback was not started by this browser. */
        if (!code || !stateMatches(returnedState, expectedState)) return back("sign-in");

        try {
          const identity = await exchange(code);

          const db = getDatabase();
          const { createThrottle } = await import("@/server/auth/throttle");
          const auth = createAuthService(
            createAccountRepository(db),
            createOrganizationRepository(db),
            createThrottle(db),
          );

          const result = auth.signInWithGoogle({
            subject: identity.subject,
            email: identity.email,
            emailVerified: identity.emailVerified,
            ...(request.headers.get("user-agent")
              ? { userAgent: request.headers.get("user-agent")! }
              : {}),
          });

          const headers = new Headers({ location: "/" });
          headers.append("set-cookie", sessionCookie(result.token));
          headers.append("set-cookie", clearStateCookie());

          return new Response(null, { status: 302, headers });
        } catch {
          /* Includes "no account here", which is the common case and is not an
             error worth showing a stack trace for. */
          return back("no-access");
        }
      },
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/login", search: {} });
  },
});
