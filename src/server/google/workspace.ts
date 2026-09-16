import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import { ApiError } from "../api/response";
import { currentInstallation } from "../installation/policy";

/**
 * Google Workspace, reached through one service account with domain-wide
 * delegation.
 *
 * ## The model
 *
 * A church on Google Workspace creates a service account in its own Google
 * Cloud project and, in the Workspace admin console, authorises it for a fixed
 * list of scopes (`WORKSPACE_SCOPES`). Oikonomia then acts **as a person in that
 * domain** — never as itself — by naming them as the token's subject:
 *
 * - as **the church's application mailbox** (`OIKONOMIA_GOOGLE_APP_USER`) for
 *   what belongs to the church: system email, the church Drive folder, the
 *   church calendar;
 * - as **the signed-in leader** for what is theirs: their Drive, their calendar.
 *   Acting as the leader is the point — Google's own sharing and permissions
 *   then decide what they may open, and Oikonomia grants nothing Google would
 *   not.
 *
 * Nobody connects an account and no token is stored: each access token is
 * minted on demand from the key and cached in memory until shortly before it
 * expires.
 *
 * ## What it refuses
 *
 * - **Addresses outside the domain.** Delegation could in principle name any
 *   user in the Workspace; a subject that is not `@<domain>` is refused before
 *   Google is asked, so a person record with a personal Gmail address can never
 *   become an impersonation.
 * - **Demo Mode.** A public demonstration never reaches Google, whatever is in
 *   its environment — the same rule as mail and Google sign-in.
 *
 * ## Configuration (see docs/architecture/google-workspace.md)
 *
 * - `OIKONOMIA_GOOGLE_SA_KEY_FILE` — path to the service account's JSON key
 *   (or `OIKONOMIA_GOOGLE_SA_KEY` with the JSON itself);
 * - `OIKONOMIA_GOOGLE_DOMAIN` — the Workspace domain, e.g. `stjohns.org`;
 * - `OIKONOMIA_GOOGLE_APP_USER` — the church mailbox to act as;
 * - `OIKONOMIA_GOOGLE_DRIVE_ROOT` — optional: the church folder (or shared
 *   drive) that ministry folders are created in;
 * - `OIKONOMIA_GOOGLE_CALENDAR_ID` — optional: the calendar church events are
 *   published to.
 */

export const WORKSPACE_SCOPES = {
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  drive: "https://www.googleapis.com/auth/drive",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
} as const;

export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[keyof typeof WORKSPACE_SCOPES];

export interface WorkspaceConfig {
  clientEmail: string;
  privateKey: string;
  domain: string;
  appUser: string;
  driveRoot?: string;
  calendarId?: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The configuration, or undefined when Workspace is not set up (or this is a demo). */
export function workspaceConfig(env: NodeJS.ProcessEnv = process.env): WorkspaceConfig | undefined {
  if (currentInstallation().demoMode) return undefined;

  const domain = env["OIKONOMIA_GOOGLE_DOMAIN"]?.trim().toLowerCase();
  const appUser = env["OIKONOMIA_GOOGLE_APP_USER"]?.trim().toLowerCase();
  const rawKey = readKey(env);
  if (!domain || !appUser || !rawKey) return undefined;

  let key: { client_email?: string; private_key?: string };
  try {
    key = JSON.parse(rawKey) as typeof key;
  } catch {
    throw new WorkspaceConfigurationError("The Google service account key is not valid JSON.");
  }
  if (!key.client_email || !key.private_key) {
    throw new WorkspaceConfigurationError(
      "The Google service account key has no client_email or private_key.",
    );
  }
  if (!appUser.endsWith(`@${domain}`)) {
    throw new WorkspaceConfigurationError(
      `OIKONOMIA_GOOGLE_APP_USER must be an address in ${domain}.`,
    );
  }

  return {
    clientEmail: key.client_email,
    privateKey: key.private_key,
    domain,
    appUser,
    ...(env["OIKONOMIA_GOOGLE_DRIVE_ROOT"]?.trim()
      ? { driveRoot: env["OIKONOMIA_GOOGLE_DRIVE_ROOT"].trim() }
      : {}),
    ...(env["OIKONOMIA_GOOGLE_CALENDAR_ID"]?.trim()
      ? { calendarId: env["OIKONOMIA_GOOGLE_CALENDAR_ID"].trim() }
      : {}),
  };
}

export class WorkspaceConfigurationError extends Error {}

function readKey(env: NodeJS.ProcessEnv): string | undefined {
  const inline = env["OIKONOMIA_GOOGLE_SA_KEY"]?.trim();
  if (inline) return inline;
  const file = env["OIKONOMIA_GOOGLE_SA_KEY_FILE"]?.trim();
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new WorkspaceConfigurationError(`The Google service account key file cannot be read.`);
  }
}

/** Whether Workspace is usable here. Never throws: a misconfiguration reads as "not set up". */
export function workspaceConfigured(): boolean {
  try {
    return Boolean(workspaceConfig());
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ transport */

export type GoogleFetch = (url: string, init: RequestInit) => Promise<Response>;

let transport: GoogleFetch = (url, init) => fetch(url, init);

/** For tests: replace how Google is reached. */
export function useGoogleTransport(next: GoogleFetch): void {
  transport = next;
  tokens.clear();
}

/* ---------------------------------------------------------------- tokens */

const base64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** An RS256-signed JWT, as Google's token endpoint expects for a service account. */
export function signServiceAssertion(
  config: Pick<WorkspaceConfig, "clientEmail" | "privateKey">,
  subject: string,
  scopes: readonly string[],
  now = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      sub: subject,
      scope: [...scopes].sort().join(" "),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(config.privateKey))}`;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/**
 * Whether an address is one Oikonomia may act as.
 *
 * Only a person in the church's own domain. Checked before every token, so no
 * caller can forget it.
 */
export function mayActAs(config: WorkspaceConfig, email: string | undefined): email is string {
  return !!email && email.trim().toLowerCase().endsWith(`@${config.domain}`);
}

/** An access token for acting as `subject` with `scopes`. Cached until a minute before expiry. */
export async function accessToken(
  config: WorkspaceConfig,
  subject: string,
  scopes: readonly WorkspaceScope[],
): Promise<string> {
  const who = subject.trim().toLowerCase();
  if (!mayActAs(config, who)) {
    throw ApiError.forbidden(
      "That address is not a Google Workspace account in this church's domain.",
    );
  }

  const key = `${who} ${[...scopes].sort().join(" ")}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const response = await transport(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signServiceAssertion(config, who, scopes),
    }).toString(),
  });

  if (!response.ok) {
    /* Google's reason is for the operator, not the leader: log it, say what to check. */
    const detail = await response.text().catch(() => "");
    console.error(`[google] token for ${who} refused: ${response.status} ${detail.slice(0, 300)}`);
    throw new ApiError(
      "internal",
      "Google Workspace refused access. An administrator should check the service account's domain-wide delegation and scopes.",
    );
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  tokens.set(key, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

/* -------------------------------------------------------------- requests */

export interface GoogleRequest {
  /** Who to act as: the church mailbox, or the signed-in leader. */
  subject: string;
  scopes: readonly WorkspaceScope[];
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  /** JSON body, or a prepared body with its own content type. */
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

/**
 * Call a Google API as someone in the domain.
 *
 * Returns parsed JSON (or undefined for an empty reply). Google's failures
 * become calm ApiErrors; the raw reason goes to the server log only.
 */
export async function googleRequest<T = unknown>(
  config: WorkspaceConfig,
  request: GoogleRequest,
): Promise<T> {
  const token = await accessToken(config, request.subject, request.scopes);
  const response = await transport(request.url, {
    method: request.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(request.json !== undefined ? { "content-type": "application/json" } : {}),
      ...request.headers,
    },
    ...(request.json !== undefined
      ? { body: JSON.stringify(request.json) }
      : request.body !== undefined
        ? { body: request.body }
        : {}),
  });

  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      `[google] ${request.method ?? "GET"} ${request.url.split("?")[0]} as ${request.subject}: ${response.status} ${detail.slice(0, 300)}`,
    );
    /* 410: an event already deleted — gone, as far as a caller is concerned. */
    if (response.status === 404 || response.status === 410)
      throw ApiError.notFound("That item in Google");
    if (response.status === 403 || response.status === 401) {
      throw ApiError.forbidden("Google did not allow that for this account.");
    }
    throw new ApiError("internal", "Google could not be reached just now. Try again.");
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ---------------------------------------------------------------- status */

export interface WorkspaceStatus {
  configured: boolean;
  /** A configuration problem an administrator can fix, in words. */
  problem?: string;
  domain?: string;
  appUser?: string;
  mail: boolean;
  drive: boolean;
  calendarPublish: boolean;
  calendarOverlay: boolean;
}

/** What is set up, for the administrator's screen. Names no secret. */
export function workspaceStatus(): WorkspaceStatus {
  const none = { mail: false, drive: false, calendarPublish: false, calendarOverlay: false };
  if (currentInstallation().demoMode) return { configured: false, ...none };
  try {
    const config = workspaceConfig();
    if (!config) return { configured: false, ...none };
    return {
      configured: true,
      domain: config.domain,
      appUser: config.appUser,
      mail: true,
      drive: true,
      calendarPublish: Boolean(config.calendarId),
      calendarOverlay: true,
    };
  } catch (error) {
    return {
      configured: false,
      problem: error instanceof WorkspaceConfigurationError ? error.message : "Not readable.",
      ...none,
    };
  }
}

/**
 * Ask Google, for each scope, whether the church mailbox may be acted as.
 *
 * The honest check: a token either comes back or it does not. Nothing is sent,
 * read or changed.
 */
export async function checkWorkspace(): Promise<{ scope: string; ok: boolean }[]> {
  const config = workspaceConfig();
  if (!config) throw ApiError.notFound("A Google Workspace configuration");
  const results: { scope: string; ok: boolean }[] = [];
  for (const [name, scope] of Object.entries(WORKSPACE_SCOPES)) {
    try {
      await accessToken(config, config.appUser, [scope]);
      results.push({ scope: name, ok: true });
    } catch {
      results.push({ scope: name, ok: false });
    }
  }
  return results;
}
