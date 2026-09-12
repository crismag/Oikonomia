/**
 * The address this installation answers on.
 *
 * ## Why this is not derived from the request
 *
 * A `Host` header is something the client sends. A sign-in link built from one
 * is a link an attacker can point at their own server, so the address comes
 * from configuration and from nowhere else.
 *
 * ## Why it refuses rather than defaults
 *
 * `http://localhost:8080` is the right assumption for a developer and a silent
 * disaster in production: magic links and OAuth redirects that name a machine
 * the recipient is not sitting at. A production process that has not been told
 * its own address is misconfigured, and saying so is better than sending
 * hundreds of links nobody can follow.
 */

const DEVELOPMENT_URL = "http://localhost:8080";

/** Configured, or refused. Never a guess that reaches somebody's inbox. */
export function siteUrl(): string {
  const configured = process.env["OIKONOMIA_URL"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "OIKONOMIA_URL is not set. This installation does not know its own address, " +
        "so sign-in links and OAuth redirects cannot be built. Set it to the URL " +
        "leaders use to reach Oikonomia.",
    );
  }

  return DEVELOPMENT_URL;
}

/** Whether `siteUrl()` would answer rather than throw. */
export function siteUrlConfigured(): boolean {
  try {
    siteUrl();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this deployment is reached over HTTPS.
 *
 * Read from configuration rather than the request, for the same reason the URL
 * is: a scheme inferred from a header the client wrote is a scheme the client
 * chose. Used to decide `Secure` cookies and `Strict-Transport-Security`, both
 * of which break plain local development if set there.
 */
export function deploymentIsHttps(): boolean {
  const url = process.env["OIKONOMIA_URL"]?.trim() ?? "";
  if (url.startsWith("https://")) return true;
  if (url.startsWith("http://")) return false;
  return process.env["NODE_ENV"] === "production";
}
