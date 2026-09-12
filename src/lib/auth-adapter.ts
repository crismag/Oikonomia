import {
  landingFor,
  signInFailure,
  type AuthMethod,
  type AuthSession,
  type LinkProblem,
} from "@/domain/auth";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import {
  fetchSession,
  requestMagicLink as requestMagicLinkFn,
  requestPasswordReset as requestPasswordResetFn,
  resetPassword as resetPasswordFn,
  signInWithMagicLink as signInWithMagicLinkFn,
  signInWithPassword as signInWithPasswordFn,
  signOut as signOutFn,
} from "@/lib/auth-api";

/**
 * The seam a real authentication backend plugs into.
 *
 * Every screen talks to this and nothing else, so replacing the mock below with
 * `/auth/*` calls is one file's work and no authentication screen has to be
 * rewritten. The contracts those endpoints must honour are written down in
 * `docs/architecture/identity-and-access.md`.
 */
export interface AuthAdapter {
  /** The current session, as the server understands it. */
  session(): Promise<AuthSession>;
  signInWithPassword(identity: string, password: string): Promise<AuthSession>;
  signInWithGoogle(): Promise<AuthSession>;
  /** Always resolves. Whether an account exists is not the caller's business. */
  requestMagicLink(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Verifies a link. `LinkProblem` says why one failed, never the token. */
  verifyMagicLink(token: string): Promise<AuthSession | LinkProblem>;
  /** Set a password using a reset or invitation link. */
  resetPassword(token: string, password: string): Promise<true | LinkProblem>;
  signOut(): Promise<void>;
}

export class AuthError extends Error {
  constructor(readonly kind: "credentials" | "network" | "rate-limited") {
    super(signInFailure(kind));
    this.name = "AuthError";
  }
}

/* ------------------------------------------------------------------ real */

/**
 * The real one.
 *
 * Every method here is a server call. Nothing is decided in the browser: the
 * server verifies the credential, issues the session, and sets an `HttpOnly`
 * cookie this code cannot read. That last part is the point — a token this
 * file could read is a token any script on the page could steal.
 *
 * ## What replaced what
 *
 * A mock that verified nothing, plus a list of everybody in the church where
 * clicking a name signed you in as them. Every authorization rule in the
 * product was real and enforced server-side, and all of it was evaluated
 * against whichever person id a browser claimed.
 */
export function createServerAuth(): AuthAdapter {
  return {
    async session(): Promise<AuthSession> {
      try {
        const view = unwrap(await withTimeout(fetchSession({ data: undefined })));
        /* Carried on both branches: the sign-in screen is rendered when there
           is no session, and it is the screen that most needs to know. */
        const methods = {
          google: view.googleConfigured,
          emailDelivery: view.emailDeliveryConfigured,
        };
        return view.person
          ? {
              status: "authenticated",
              methods,
              user: {
                id: view.accountId ?? "",
                displayName: view.person.name,
                email: view.email ?? "",
              },
            }
          : { status: "unauthenticated", methods };
      } catch {
        /* Not knowing is not the same as being signed out, but it is the safe
           answer: the application shows the way in rather than a workspace. */
        return { status: "unauthenticated" };
      }
    },

    async signInWithPassword(identity: string, password: string): Promise<AuthSession> {
      try {
        unwrap(await withTimeout(signInWithPasswordFn({ data: { email: identity, password } })));
      } catch (error) {
        throw asAuthError(error);
      }
      return this.session();
    },

    signInWithGoogle(): Promise<AuthSession> {
      /*
       * A full-page redirect rather than a fetch: OAuth happens at Google, and
       * the callback arrives back at the server, which sets the session cookie
       * before the application loads again.
       */
      if (typeof window !== "undefined") window.location.assign("/auth/google/start");
      return Promise.resolve({ status: "loading" });
    },

    async requestMagicLink(email: string): Promise<void> {
      /* Always resolves. Whether an account exists is not the caller's
         business — see the note on the interface. */
      try {
        unwrap(await withTimeout(requestMagicLinkFn({ data: { email } })));
      } catch {
        /* Deliberately swallowed: a failure here would tell the caller
           something about the address. */
      }
    },

    async requestPasswordReset(email: string): Promise<void> {
      try {
        unwrap(await withTimeout(requestPasswordResetFn({ data: { email } })));
      } catch {
        /* As above. */
      }
    },

    async verifyMagicLink(token: string): Promise<AuthSession | LinkProblem> {
      try {
        unwrap(await withTimeout(signInWithMagicLinkFn({ data: { token } })));
        return this.session();
      } catch {
        /*
         * One answer for every way a link can be unusable. The server does not
         * say whether it was expired, spent or never issued, because the
         * difference is only useful to somebody testing links.
         */
        return "invalid";
      }
    },

    /**
     * Set a password from a link.
     *
     * The screen that collects the new password used to navigate straight to
     * "password saved" without calling anything — a control that reported
     * success and changed nothing. This is what it calls.
     */
    async resetPassword(token: string, password: string): Promise<true | LinkProblem> {
      try {
        unwrap(await withTimeout(resetPasswordFn({ data: { token, password } })));
        return true;
      } catch {
        /* Same single answer as a magic link: expired, spent and never issued
           are only worth telling apart to somebody testing links. */
        return "invalid";
      }
    },

    async signOut(): Promise<void> {
      await withTimeout(signOutFn({ data: undefined }));
    },
  };
}

/** A server refusal, as the error the screens already know how to show. */
function asAuthError(error: unknown): AuthError {
  const message = error instanceof Error ? error.message : "";
  if (/rate|too many/i.test(message)) return new AuthError("rate-limited");
  if (/reach|network|timed out/i.test(message)) return new AuthError("network");
  return new AuthError("credentials");
}

export { landingFor };
export type { AuthMethod };
