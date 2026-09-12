/**
 * Remembering an OAuth attempt between the redirect out and the one back.
 *
 * The `state` is generated when somebody is sent to Google and checked when
 * they return. Without that check, anybody can send a victim a crafted callback
 * URL and complete a sign-in as themselves in the victim's browser — login
 * CSRF, and the reason `state` exists at all.
 *
 * It lives in a short-lived `HttpOnly` cookie rather than in the database: it is
 * one browser's business for the ninety seconds an OAuth round trip takes, and
 * a table would need cleaning up forever.
 */

export const STATE_COOKIE = "oikonomia_oauth_state";

/** Long enough for a slow sign-in, short enough not to linger. */
const LIFETIME_SECONDS = 10 * 60;

const secure = (): boolean => {
  const url = process.env["OIKONOMIA_URL"] ?? "";
  if (url.startsWith("https://")) return true;
  if (url.startsWith("http://")) return false;
  return process.env["NODE_ENV"] === "production";
};

export function stateCookie(state: string): string {
  return [
    `${STATE_COOKIE}=${encodeURIComponent(state)}`,
    "Path=/",
    "HttpOnly",
    /* `Lax` would drop the cookie on the cross-site POST some providers use;
       the callback here is a GET navigation, where `Lax` is sent. */
    "SameSite=Lax",
    `Max-Age=${LIFETIME_SECONDS}`,
    ...(secure() ? ["Secure"] : []),
  ].join("; ");
}

/** Spend it. A state that is not cleared can be replayed. */
export function clearStateCookie(): string {
  return [
    `${STATE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(secure() ? ["Secure"] : []),
  ].join("; ");
}
