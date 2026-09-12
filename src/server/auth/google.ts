import { randomBytes } from "node:crypto";

import { safeEqual } from "./secrets";
import { siteUrl, siteUrlConfigured } from "./site-url";

/**
 * Signing in with Google.
 *
 * ## What is implemented, and what is configuration
 *
 * The whole flow is here: the authorization URL with `state`, the code
 * exchange, and the checks an ID token has to pass before it is believed. What
 * is **not** here is a client id and secret, because those belong to a church's
 * own Google project and cannot live in a repository.
 *
 * So Google sign-in is **implemented and deployment-blocked**. `googleConfigured()`
 * is false until the environment provides credentials, the sign-in screen does
 * not offer a button that cannot work, and `docs/architecture/identity-and-access.md`
 * lists exactly what to set.
 *
 * ## What this deliberately does not do
 *
 * It does not decide who may do anything. A verified Google identity is an
 * identity; `auth-service` decides whether this installation has an account for
 * it, and the organisation decides everything after that.
 */

export interface GoogleIdentity {
  /** Google's stable id for this person. What an account is matched on. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function googleConfig():
  { clientId: string; clientSecret: string; redirectUri: string } | undefined {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return undefined;

  /* Deliberately allowed to throw in production: credentials are configured but
     the address is not, and a redirect URI naming localhost would fail Google's
     own registration check anyway — loudly here is better than obscurely
     there. */
  return { clientId, clientSecret, redirectUri: `${siteUrl()}/auth/google/callback` };
}

export const googleConfigured = (): boolean => siteUrlConfigured() && Boolean(googleConfig());

/**
 * Where to send somebody, and the `state` to remember.
 *
 * `state` is random per attempt and checked on the way back. Without it, a
 * third party can complete somebody else's sign-in — a callback with no state
 * check is a login CSRF.
 */
export function startUrl(): { url: string; state: string } | undefined {
  const config = googleConfig();
  if (!config) return undefined;

  const state = randomBytes(24).toString("base64url");
  const url = new URL(AUTHORIZE);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  /* Consent every time is unnecessary; a refresh token is not wanted, because
     nothing here acts on somebody's behalf. */
  url.searchParams.set("access_type", "online");

  return { url: url.toString(), state };
}

export const stateMatches = (returned: string, expected: string): boolean =>
  Boolean(returned) && Boolean(expected) && safeEqual(returned, expected);

/**
 * Exchange the code for an identity.
 *
 * Separated from `identityFrom` so the checks below can be tested without the
 * network, which is the part worth testing: the exchange is an HTTP call, and
 * the validation is where a mistake becomes a vulnerability.
 */
export async function exchange(code: string): Promise<GoogleIdentity> {
  const config = googleConfig();
  if (!config) throw new Error("Google sign-in is not configured on this installation.");

  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) throw new Error("Google would not complete the sign-in.");

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) throw new Error("Google returned no identity.");

  return identityFrom(payload.id_token, config.clientId);
}

/**
 * What an ID token has to prove before it is believed.
 *
 * Five checks, and each one matters:
 *
 * - **Issuer**, or any signer could mint identities.
 * - **Audience**, or a token issued for another application is accepted here —
 *   the classic confused-deputy in OIDC.
 * - **Expiry**, or an old token works forever.
 * - **A subject**, because that is what an account is matched on.
 * - **A verified email**, because linking to an existing account on an
 *   unverified address is how somebody claims an account by asserting its
 *   address.
 *
 * > **The signature is verified by Google, not here.** The token comes directly
 * > from Google's token endpoint over TLS in `exchange` — the code flow, not
 * > the implicit flow — so it has not passed through the browser and there is
 * > nothing in between to forge it. A token from any other source must not be
 * > passed to this function.
 */
export function identityFrom(idToken: string, audience: string): GoogleIdentity {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("That is not an identity token.");

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("That identity token could not be read.");
  }

  if (!ISSUERS.includes(String(claims["iss"]))) {
    throw new Error("That identity token was not issued by Google.");
  }

  const aud = claims["aud"];
  const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud)];
  if (!audiences.includes(audience)) {
    throw new Error("That identity token was issued for a different application.");
  }

  const exp = Number(claims["exp"] ?? 0);
  if (!exp || exp * 1000 <= Date.now()) {
    throw new Error("That identity token has expired.");
  }

  const subject = String(claims["sub"] ?? "");
  if (!subject) throw new Error("That identity token names nobody.");

  return {
    subject,
    email: String(claims["email"] ?? ""),
    emailVerified: claims["email_verified"] === true || claims["email_verified"] === "true",
    ...(claims["name"] ? { name: String(claims["name"]) } : {}),
  };
}
