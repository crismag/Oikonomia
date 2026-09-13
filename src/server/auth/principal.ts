import {
  createAccountRepository,
  SESSION_TOUCH_INTERVAL_MS,
  type Account,
} from "../repositories/account-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { deploymentIsHttps } from "./site-url";
import { viewerOf, type Viewer } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Who is making this request, decided by the server.
 *
 * ## The one rule
 *
 * **Identity comes from a session the server issued, and from nothing else.**
 *
 * Not from a body field, not from a query parameter, not from a header the
 * client chose, not from a person id in a cookie. A request carries a session
 * token; the token names a row; the row names an account; the account names a
 * person. Every link in that chain is one the server wrote.
 *
 * What this replaced: `oikonomia_person=<id>`, which the browser could set to
 * anybody's id. Every authorization rule in the product was real and enforced
 * server-side, and all of it was evaluated against that.
 *
 * ## What a principal is, and is not
 *
 * It carries who somebody is. It carries **no privileges** — no roles, no
 * memberships, no capabilities — because those are resolved from the
 * organisation's own records at the moment they are needed. A principal that
 * carried claims would be a second, staler authorization model.
 */

export const SESSION_COOKIE = "oikonomia_session";

/** How long a session lives regardless of use. */
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export interface Principal {
  accountId: string;
  personId: string;
  /** The stored id of this session — its token's hash, never the token. */
  sessionId: string;
  /** For audit and for the account screen. Never for a permission decision. */
  sessionStartedAt: string;
}

/** One cookie out of a header, without trusting its shape. */
export function cookieValue(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;

    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

/**
 * The principal for a request, or nobody.
 *
 * Four ways to be nobody, and each is checked: no token, no such session, the
 * session was revoked, the session expired. A session that has lapsed is not
 * quietly renewed — an absolute lifetime that use extends is not a lifetime.
 */
export function principalFor(request: Request, db: Db): Principal | undefined {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return undefined;

  const accounts = createAccountRepository(db);
  const session = accounts.session(token);
  if (!session) return undefined;

  if (session.revokedAt) return undefined;
  if (session.expiresAt <= new Date().toISOString()) return undefined;

  const account = accounts.find(session.accountId);
  if (!account) return undefined;

  /* Account state is checked on every request, not only at sign-in. Suspending
     somebody has to take effect now rather than whenever their session
     happens to lapse. */
  if (account.status !== "active") return undefined;

  /* Only when the stored time is more than a minute old: presence needs
     minutes, not every request, and each touch is a write. The session is
     valid either way — skipping the touch changes nothing about who is asking
     or when the session expires. */
  const touchBefore = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS).toISOString();
  if (!(Date.parse(session.lastSeenAt) >= Date.parse(touchBefore))) {
    accounts.touchSession(token, touchBefore);
  }

  return {
    accountId: account.id,
    personId: account.personId,
    sessionId: session.id,
    sessionStartedAt: session.createdAt,
  };
}

/**
 * The viewer for a request: the principal, resolved into a church-domain person
 * with the role and capabilities their record carries.
 *
 * The capabilities come from the **person's record read now**, never from the
 * session. A role changed a minute ago takes effect on the next request, and a
 * session issued before the change carries no stale privilege.
 */
export function viewerFor(request: Request, db: Db): Viewer | undefined {
  const principal = principalFor(request, db);
  if (!principal) return undefined;

  const person = createOrganizationRepository(db).findPerson(principal.personId);
  if (!person) return undefined;

  /* A person deactivated in the organisation cannot act, even holding a valid
     session. Deactivation is not a login question, but it is an acting one. */
  if (person.active === false) return undefined;

  return viewerOf(person);
}

/** The account behind a request, for the screens that manage one. */
export function accountFor(request: Request, db: Db): Account | undefined {
  const principal = principalFor(request, db);
  return principal ? createAccountRepository(db).find(principal.accountId) : undefined;
}

/* ----------------------------------------------------------------- cookie */

/**
 * The session cookie.
 *
 * `HttpOnly` so script cannot read it, `SameSite=Lax` so another site cannot
 * cause an authenticated request while ordinary navigation still works, and
 * `Secure` wherever the deployment is not plain local development.
 */
export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
    ...(isSecureDeployment() ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isSecureDeployment() ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Whether to mark cookies `Secure`.
 *
 * On anywhere that is not local development. Marking them `Secure` on plain
 * `http://localhost` would stop the browser sending them at all, which looks
 * like a broken login rather than a security setting.
 *
 * The same question decides `Strict-Transport-Security`, so both read one
 * answer rather than two copies of it.
 */
const isSecureDeployment = deploymentIsHttps;
