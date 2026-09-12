/**
 * How the claimed identity travels.
 *
 * A cookie rather than `localStorage`, for one reason: the server has to be
 * able to see who is calling. `localStorage` is invisible to a request
 * handler, so every API call would have had to carry identity separately and
 * the two would eventually disagree.
 *
 * It carries a **person id** — somebody who exists in this installation. It
 * used to carry a persona, which is to say a character from a cast that
 * shipped with the product; there is no cast any more.
 *
 * Transport only. No decision is made here: the browser writes it when
 * somebody signs in, the server reads it in `server/auth/current-user.ts`, and
 * what an unrecognised value means is decided there.
 *
 * > **Not a session.** Nothing is signed and nothing is verified.
 */

export const VIEWER_COOKIE = "oikonomia_person";

/** A year: long enough to stay signed in, short enough to expire. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** Pull one cookie's value out of a `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    /* Compare the whole name, so `not_oikonomia_person` never matches. */
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** The person id a `Cookie` header claims, if it claims one. */
export function personIdFromCookieHeader(header: string | null | undefined): string | undefined {
  const value = readCookie(header, VIEWER_COOKIE);
  return value && value.trim() ? value : undefined;
}

/**
 * The `Set-Cookie` value recording who signed in.
 *
 * Readable by script on purpose, because the browser sets it. A real session
 * cookie would be `HttpOnly; Secure` and would carry a signed token rather
 * than an id; that is deferred with the rest of authentication.
 */
export function viewerCookie(personId: string): string {
  return `${VIEWER_COOKIE}=${encodeURIComponent(personId)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}

/** The `Set-Cookie` value that signs out. */
export function clearViewerCookie(): string {
  return `${VIEWER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
