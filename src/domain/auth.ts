import type { InstallationView } from "./installation";

/**
 * Identity, kept apart from access.
 *
 * > **Authentication** asks who you are.
 * > **Authorization** asks what you may do.
 *
 * Everything in this file is the first question. The second is
 * `domain/authorize.ts`, `domain/access.ts` and the services, and the two must
 * not be allowed to merge: signing in successfully has never meant being
 * allowed to see anything in particular, and in a product holding pastoral
 * notes and leadership evaluations that distinction is the whole game.
 *
 * ## What is real here and what is not
 *
 * The **rules** below are real and tested — which destinations are safe to
 * return to, what each account state permits, what a message may say. The
 * **identity** behind them is not: see `lib/auth-adapter.ts`, which is a mock
 * and says so. No security property of this application currently rests on it.
 */

/**
 * Where a session can be.
 *
 * Authenticated and allowed in are deliberately different states. A person can
 * prove who they are and still have no business in this workspace — Oikonomia
 * is a private church application, not an open sign-up — so
 * `authenticated_no_access` is a first-class answer rather than an error.
 */
export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "authenticated"
  | "authenticated_no_access"
  | "suspended"
  | "error";

/** How somebody proved who they are. */
export type AuthMethod = "google" | "password" | "magic-link";

export const authMethodLabel: Record<AuthMethod, string> = {
  google: "Google",
  password: "Password",
  "magic-link": "Email sign-in link",
};

/** Where a membership is in its life. */
export type MembershipStatus = "invited" | "active" | "suspended" | "archived";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string;
  /** The church-domain person this identity is linked to, when it is. */
  personId?: string;
}

export interface Membership {
  organizationName: string;
  campusName?: string;
  roleLabel: string;
  status: MembershipStatus;
}

/**
 * What this installation can actually do.
 *
 * Not a preference and not a permission: a statement of what is configured.
 * The sign-in screen used to offer Google whether or not credentials existed,
 * and to answer a magic-link request with "Check your email" whether or not
 * any mail provider could send one. Both are controls that look operational
 * and are not, which is worse than an absent feature — somebody waits for a
 * message that was never going to arrive.
 */
export interface AuthMethods {
  /** Google sign-in has credentials and an address to return to. */
  google: boolean;
  /** A message sent from here reaches somebody who is not the server log. */
  emailDelivery: boolean;
}

export const noMethods: AuthMethods = { google: false, emailDelivery: false };

export interface AuthSession {
  status: AuthStatus;
  user?: AuthenticatedUser;
  membership?: Membership;
  /** Only for `error`. Never the underlying failure — see `signInFailure`. */
  message?: string;
  /** What this installation supports. Absent while the session is unknown. */
  methods?: AuthMethods;
  /** What this installation's own policy switches off. Absent while unknown. */
  installation?: InstallationView;
}

/* ------------------------------------------------------------ what to say */

/**
 * What a failed sign-in is allowed to say.
 *
 * Never which half was wrong, and never whether the account exists. "No such
 * user" and "wrong password" are the same sentence, because the difference
 * between them is exactly what somebody enumerating accounts is looking for.
 *
 * A network failure is worth distinguishing, because that one is not the
 * leader's fault and retrying is the right response.
 */
export function signInFailure(kind: "credentials" | "network" | "rate-limited"): string {
  if (kind === "network") {
    return "We could not reach Oikonomia. Check your connection and try again.";
  }
  if (kind === "rate-limited") {
    return "Too many attempts. Wait a few minutes before trying again.";
  }
  return "We could not sign you in. Check your details and try again.";
}

/**
 * What a sign-in link request is allowed to say.
 *
 * The same sentence whether or not an account exists — which is why it is
 * phrased as a condition. "We have sent you a link" confirms the address is
 * registered; "no account found" confirms it is not.
 */
export const magicLinkSent = (email: string) =>
  `If an Oikonomia account exists for ${email}, we've sent a secure sign-in link.`;

export const passwordResetSent = (email: string) =>
  `If an Oikonomia account exists for ${email}, we've sent a link to reset the password.`;

/** Why a sign-in link did not work. Never the token, never the detail. */
export type LinkProblem = "expired" | "used" | "invalid";

export const linkProblemMessage: Record<LinkProblem, { title: string; body: string }> = {
  expired: {
    title: "This sign-in link has expired",
    body: "For your security, sign-in links are only good for a short time.",
  },
  used: {
    title: "This sign-in link can no longer be used",
    body: "Each link works once. Request another and we will email it to you.",
  },
  invalid: {
    title: "We could not verify this sign-in link",
    body: "It may have been copied incompletely. Requesting a new one is the quickest fix.",
  },
};

/* ------------------------------------------------------ where to return to */

/**
 * Whether it is safe to send somebody here after signing in.
 *
 * An open redirect is a real vulnerability and an easy one to ship: a login
 * page that honours `?next=` without checking it will happily bounce a leader
 * to somebody else's site, with Oikonomia's own sign-in page as the thing that
 * lent it credibility.
 *
 * So only **this application's own paths** are allowed, and the check is a
 * small set of refusals rather than a clever parse:
 *
 * - must begin with a single slash
 * - must not begin with a double slash or slash-backslash, which browsers read
 *   as another host
 * - must contain no backslash, no scheme and no control characters
 * - must not be the sign-in page itself, or signing in would loop
 */
/**
 * Anything a URL has no business carrying.
 *
 * Excluded deliberately: a newline in a redirect target is how header-injection
 * and log-forging attempts arrive.
 */
// eslint-disable-next-line no-control-regex -- these characters are the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeReturnTo(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;

  const value = raw.trim();
  if (!value.startsWith("/")) return undefined;
  /* `//evil.example` and `/\evil.example` are both protocol-relative. */
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value.includes("\\")) return undefined;
  if (CONTROL_CHARACTERS.test(value)) return undefined;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  if (value.startsWith("/login")) return undefined;

  return value;
}

/** Where a signed-in leader lands when they asked for nothing in particular. */
export const DEFAULT_LANDING = "/";

/**
 * Where to send somebody once they are in.
 *
 * Their original destination when it is safe, and the leader's own home
 * otherwise. Deliberately **not** chosen from a role string: a person may hold
 * several roles, and a landing page picked from the first one found is a guess.
 */
export function landingFor(returnTo: string | undefined | null): string {
  return safeReturnTo(returnTo) ?? DEFAULT_LANDING;
}

/* ------------------------------------------------------ what a state permits */

/** Whether this session may use the workspace at all. */
export const mayEnter = (session: AuthSession): boolean =>
  session.status === "authenticated" && session.membership?.status === "active";

/**
 * What an account state means to the person in it.
 *
 * Neutral on purpose. Why an account was suspended is between an administrator
 * and the person, and a sign-in screen is not where that conversation happens.
 */
export const statusExplanation: Record<
  Exclude<AuthStatus, "loading" | "authenticated" | "error">,
  { title: string; body: string }
> = {
  unauthenticated: {
    title: "Please sign in",
    body: "Sign in to continue to Oikonomia.",
  },
  authenticated_no_access: {
    title: "Access required",
    body: "We know who you are, but you do not currently have access to this Oikonomia workspace. Your church administrator can invite you.",
  },
  suspended: {
    title: "This account is not active",
    body: "Your access to this workspace is paused. Your church administrator can tell you more.",
  },
};
