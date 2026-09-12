import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * Signing in, and out.
 *
 * ## Where the session lives
 *
 * In an `HttpOnly` cookie the server sets. Script never sees it, which is why
 * these handlers set headers rather than returning a token for the browser to
 * keep — a token in `localStorage` is a credential any script on the page can
 * read.
 *
 * ## What comes back
 *
 * As little as possible. A successful sign-in returns who you are; a failure
 * returns one sentence that is the same sentence for every kind of failure.
 * The difference between "no such account" and "wrong password" is what
 * somebody enumerating addresses is looking for.
 */

export interface SessionView {
  /** Null when nobody is signed in. */
  person: { id: string; name: string } | null;
  accountId?: string;
  email?: string;
  /** Whether a magic link would actually reach anybody in this installation. */
  emailDeliveryConfigured: boolean;
  /** Whether Google sign-in is configured here. */
  googleConfigured: boolean;
}

async function serverParts() {
  const [
    { ApiError },
    { getDatabase },
    { createAccountRepository },
    { createOrganizationRepository },
    { createAuthService },
    { getRequest, setResponseHeader },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/db/connection"),
    import("@/server/repositories/account-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/auth-service"),
    import("@tanstack/react-start/server"),
  ]);

  const { createThrottle } = await import("@/server/auth/throttle");

  const db = getDatabase();
  const accounts = createAccountRepository(db);

  return {
    ApiError,
    db,
    accounts,
    /* Every way in over HTTP is composed here, so the throttle is passed here
       — a sign-in path assembled without one is a sign-in path with no limit. */
    auth: createAuthService(accounts, createOrganizationRepository(db), createThrottle(db)),
    request: getRequest(),
    setHeader: setResponseHeader,
  };
}

async function withAuth<T>(
  work: (parts: Awaited<ReturnType<typeof serverParts>>) => Promise<T> | T,
): Promise<Result<T>> {
  try {
    const parts = await serverParts();
    try {
      return { data: await work(parts) };
    } catch (error) {
      if (error instanceof parts.ApiError) return { error: error.body() };
      throw error;
    }
  } catch (error) {
    const { ApiError } = await import("@/server/api/response");
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be done. Please try again." } };
  }
}

/** Who is signed in, if anybody. The call the shell makes before rendering. */
export const fetchSession = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withAuth(async ({ db, request }): Promise<SessionView> => {
      const [{ viewerFor }, { canDeliver }, { googleConfigured }] = await Promise.all([
        import("@/server/auth/principal"),
        import("@/server/auth/delivery"),
        import("@/server/auth/google"),
      ]);

      const viewer = viewerFor(request, db);
      const { accountFor } = await import("@/server/auth/principal");
      const account = accountFor(request, db);

      return {
        person: viewer ? { id: viewer.person.id, name: viewer.person.name } : null,
        ...(account ? { accountId: account.id } : {}),
        ...(account?.email ? { email: account.email } : {}),
        emailDeliveryConfigured: canDeliver(),
        googleConfigured: googleConfigured(),
      };
    }),
  );

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth, request, setHeader }) => {
      const { sessionCookie } = await import("@/server/auth/principal");

      const result = auth.signInWithPassword({
        email: data.email,
        password: data.password,
        ...(request.headers.get("user-agent")
          ? { userAgent: request.headers.get("user-agent")! }
          : {}),
      });

      setHeader("Set-Cookie", sessionCookie(result.token));
      return { personId: result.account.personId };
    }),
  );

/**
 * Ask for a sign-in link.
 *
 * Always reports success. Whether an account exists is not the caller's
 * business, and telling them is how a login form becomes an address checker.
 */
export const requestMagicLink = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth }) => {
      const { delivery, magicLinkMessage, canDeliver } = await import("@/server/auth/delivery");
      const { token } = auth.requestMagicLink(data.email);

      if (token) {
        const message = magicLinkMessage(token);
        await delivery().send({ to: data.email, ...message });
      }

      return { sent: true, deliverable: canDeliver() };
    }),
  );

export const signInWithMagicLink = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth, request, setHeader }) => {
      const { sessionCookie } = await import("@/server/auth/principal");

      const result = auth.signInWithMagicLink({
        token: data.token,
        ...(request.headers.get("user-agent")
          ? { userAgent: request.headers.get("user-agent")! }
          : {}),
      });

      setHeader("Set-Cookie", sessionCookie(result.token));
      return { personId: result.account.personId };
    }),
  );

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth }) => {
      const { delivery, baseUrl, canDeliver } = await import("@/server/auth/delivery");
      const { token } = auth.requestPasswordReset(data.email);

      if (token) {
        await delivery().send({
          to: data.email,
          subject: "Set a new Oikonomia password",
          body: [
            "Somebody asked to set a new password for this address.",
            "",
            `${baseUrl()}/login?step=reset&token=${encodeURIComponent(token)}`,
            "",
            "The link works once and expires in 15 minutes.",
            "If this was not you, nothing has changed and you can ignore this.",
          ].join("\n"),
        });
      }

      return { sent: true, deliverable: canDeliver() };
    }),
  );

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: { token: string; password: string }) => input)
  .handler(({ data }) =>
    withAuth(({ auth }) => {
      auth.resetPassword(data);
      return { reset: true };
    }),
  );

/**
 * The first person, and their way in.
 *
 * A new installation has nobody, so nobody can be an administrator, so nobody
 * could add the first person — and now, additionally, nobody could issue the
 * first credential. This does all three at once and is refused the moment
 * anybody exists.
 *
 * It is the only place an account is created with a password in one step, and
 * the only place that is safe: there is provably nobody to authorize it,
 * because there is provably nobody.
 */
export const claimFirstAccount = createServerFn({ method: "POST" })
  .validator((input: { name: string; role?: string; email: string; password: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth, accounts, db, setHeader }) => {
      const [{ createOrganizationService }, { createOrganizationRepository }, { sessionCookie }] =
        await Promise.all([
          import("@/server/services/organization-service"),
          import("@/server/repositories/organization-repository"),
          import("@/server/auth/principal"),
        ]);

      const organization = createOrganizationService(createOrganizationRepository(db));

      /* The service refuses a second use, whoever asks. That check is the
         door, and it is not repeated here. */
      const person = organization.claimFirstPerson({
        name: data.name,
        ...(data.role ? { role: data.role } : {}),
        email: data.email,
      });

      const account = accounts.create({
        personId: person.id,
        email: data.email,
        status: "invited",
      });
      /* `setPassword` makes it active. */
      auth.setPassword(account.id, data.password);

      const session = accounts.openSession({
        accountId: account.id,
        lifetimeMs: (await import("@/server/auth/principal")).SESSION_LIFETIME_MS,
      });
      setHeader("Set-Cookie", sessionCookie(session.token));

      return { personId: person.id };
    }),
  );

export const signOut = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() =>
    withAuth(async ({ auth, db, request, setHeader }) => {
      const { cookieValue, SESSION_COOKIE, clearSessionCookie, principalFor } =
        await import("@/server/auth/principal");

      const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
      const principal = principalFor(request, db);

      if (token) auth.signOut(token, principal?.accountId);

      /* Cleared whether or not there was a session: a stale cookie should not
         survive somebody pressing sign out. */
      setHeader("Set-Cookie", clearSessionCookie());
      return { signedOut: true };
    }),
  );

/** Change your own password. Signs every other session out. */
export const changePassword = createServerFn({ method: "POST" })
  .validator((input: { current: string; next: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth, accounts, db, request, setHeader }) => {
      const { principalFor, sessionCookie } = await import("@/server/auth/principal");
      const { ApiError } = await import("@/server/api/response");

      const principal = principalFor(request, db);
      if (!principal) throw ApiError.unauthenticated("Sign in first.");

      const account = accounts.find(principal.accountId)!;

      /* Proving the current password is what stops somebody who found an
         unattended browser from taking the account. */
      auth.signInWithPassword({ email: account.email ?? "", password: data.current });
      auth.setPassword(principal.accountId, data.next);

      /* Changing it revoked every session including this one, so a new one is
         issued — otherwise changing your password signs you out. */
      const fresh = accounts.openSession({
        accountId: principal.accountId,
        lifetimeMs: (await import("@/server/auth/principal")).SESSION_LIFETIME_MS,
      });
      setHeader("Set-Cookie", sessionCookie(fresh.token));

      return { changed: true };
    }),
  );

/* ------------------------------------------------- the account's own page */

export interface AccountMethodView {
  method: "password" | "google";
  /** When the credential was established. Absent when there is none. */
  since?: string;
  detail?: string;
}

export interface AccountSessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent?: string;
  /** The session making this request. It is not offered for revocation. */
  current: boolean;
}

export interface AccountOverview {
  email?: string;
  methods: AccountMethodView[];
  sessions: AccountSessionView[];
  emailDeliveryConfigured: boolean;
  googleConfigured: boolean;
}

/**
 * What the account page shows.
 *
 * Read from `account_credential` and `auth_session` rather than assumed. The
 * page used to state that a password was "Not set" and that other devices
 * would appear "once sessions are real" — to somebody who had just signed in
 * with a password, on a real session.
 */
export const fetchAccountOverview = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withAuth(async ({ db, accounts, ApiError }): Promise<AccountOverview> => {
      const { principalFor } = await import("@/server/auth/principal");
      const { canDeliver } = await import("@/server/auth/delivery");
      const { googleConfigured } = await import("@/server/auth/google");
      const { getRequest } = await import("@tanstack/react-start/server");

      const principal = principalFor(getRequest(), db);
      if (!principal) throw new ApiError("unauthenticated", "You are not signed in.");

      const account = accounts.find(principal.accountId);
      const password = accounts.credential(principal.accountId, "password");
      const google = accounts.credential(principal.accountId, "google");

      const now = new Date().toISOString();
      const sessions = accounts
        .sessionsFor(principal.accountId)
        .filter((s) => !s.revokedAt && s.expiresAt > now)
        .map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          ...(s.userAgent ? { userAgent: s.userAgent } : {}),
          current: s.id === principal.sessionId,
        }));

      return {
        ...(account?.email ? { email: account.email } : {}),
        methods: [
          { method: "password" as const, ...(password ? { since: password.updatedAt } : {}) },
          {
            method: "google" as const,
            ...(google ? { since: google.createdAt } : {}),
          },
        ],
        sessions,
        emailDeliveryConfigured: canDeliver(),
        googleConfigured: googleConfigured(),
      };
    }),
  );

/**
 * End one device.
 *
 * The account page could end every other session and not a single named one,
 * so somebody who recognised one unfamiliar device had to sign out everywhere
 * to be rid of it.
 *
 * The current session is refused rather than ended: pressing "this device"
 * would sign somebody out of the page they are using, which reads as a bug
 * whatever the intent. Signing out is the control for that, and it is in the
 * account menu.
 */
export const signOutSession = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ db, accounts, ApiError }) => {
      const { principalFor } = await import("@/server/auth/principal");
      const { getRequest } = await import("@tanstack/react-start/server");

      const principal = principalFor(getRequest(), db);
      if (!principal) throw new ApiError("unauthenticated", "You are not signed in.");
      if (data.sessionId === principal.sessionId) {
        throw new ApiError("validation", "Use Sign out to end the session you are using.");
      }

      const ended = accounts.revokeSessionById(principal.accountId, data.sessionId);
      if (!ended) throw new ApiError("not-found", "That session has already ended.");

      accounts.record({
        accountId: principal.accountId,
        action: "auth.session.revoked",
        result: "ok",
      });
      return { ended: true };
    }),
  );

/**
 * End every session but this one.
 *
 * The repository could already do it — `revokeAllSessions` is what a password
 * change calls. What did not exist was a way for a leader to ask, so the
 * account page carried a permanently disabled button instead.
 */
export const signOutOtherSessions = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() =>
    withAuth(async ({ db, accounts, ApiError }) => {
      const { principalFor } = await import("@/server/auth/principal");
      const { getRequest } = await import("@tanstack/react-start/server");

      const principal = principalFor(getRequest(), db);
      if (!principal) throw new ApiError("unauthenticated", "You are not signed in.");

      const ended = accounts.revokeSessionsExcept(principal.accountId, principal.sessionId);
      accounts.record({
        accountId: principal.accountId,
        action: "auth.session.revoked_all",
        result: "ok",
        metadata: { kept: principal.sessionId, ended },
      });
      return { ended };
    }),
  );

/* --------------------------------------------------- giving somebody access */

/**
 * Invite a person to sign in.
 *
 * ## The gap this closes
 *
 * Until this existed, **only the first person could ever sign in.** `/setup`
 * created one account; adding anybody else to the directory created a person
 * and no account, and `auth:set-password` refuses an address no account has.
 * A church could enter its whole leadership team and none of them could get
 * in. `inviteAccount` was written for this and nothing called it.
 *
 * ## What an invitation is, and is not
 *
 * It creates an account and a way to set a password. It grants **nothing
 * else** — no ministry, no group, no capability. Those stay with the confirmed
 * assignments the organisation owns, exactly as signing in does.
 *
 * ## When there is no mail
 *
 * The account is still created, and the caller is told the message could not
 * be sent so an administrator can set the password with the operations tool.
 * The link is not returned to the browser: a set-a-password token displayed on
 * an administrator's screen is a credential in a place credentials do not
 * belong, and the out-of-band path already exists.
 */
export const inviteToOikonomia = createServerFn({ method: "POST" })
  .validator((input: { personId: string }) => input)
  .handler(({ data }) =>
    withAuth(async ({ auth, accounts, db, request, ApiError }) => {
      const [{ viewerFor }, { delivery, canDeliver, baseUrl }, { LINK_LIFETIME_MS }] =
        await Promise.all([
          import("@/server/auth/principal"),
          import("@/server/auth/delivery"),
          import("@/server/services/auth-service"),
        ]);

      const viewer = viewerFor(request, db);
      if (!viewer) throw new ApiError("unauthenticated", "You are not signed in.");
      if (!viewer.persona.capabilities.includes("administration")) {
        throw new ApiError("forbidden", "Inviting somebody is an administrator's to do.");
      }

      const { createOrganizationRepository } =
        await import("@/server/repositories/organization-repository");
      const person = createOrganizationRepository(db).findPerson(data.personId);
      if (!person) throw new ApiError("not-found", "There is no such person.");
      if (!person.email) {
        throw new ApiError(
          "validation",
          "Add an email address to their record first — it is where the invitation goes.",
        );
      }

      const account = auth.inviteAccount(person.id, person.email);

      /* A password-reset token: setting a first password and replacing a
         forgotten one are the same act, and a second token purpose that
         behaved identically would be a second thing to get wrong. */
      const token = accounts.issueToken({
        accountId: account.id,
        purpose: "password-reset",
        lifetimeMs: LINK_LIFETIME_MS,
      });

      if (!canDeliver()) {
        return { email: person.email, delivered: false };
      }

      await delivery().send({
        to: person.email,
        subject: "You have been given access to Oikonomia",
        body: [
          `${viewer.person.name} has given you access to Oikonomia.`,
          "",
          "Set a password to sign in:",
          `${baseUrl()}/login?reset=${encodeURIComponent(token)}`,
          "",
          "The link works once and expires in 15 minutes. If it has expired, ask",
          "for a new one from the sign-in screen.",
        ].join("\n"),
      });

      return { email: person.email, delivered: true };
    }),
  );
