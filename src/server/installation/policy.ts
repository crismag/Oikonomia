import type { InstallationRestriction, InstallationView } from "@/domain/installation";
import type { ApiErrorBody } from "@/lib/api-envelope";
import { text } from "@/config/messages";

import { liveDatabasePath } from "../db/database-paths";
import { SERVER_FUNCTIONS, type DenialReason } from "./operations";

/**
 * What this installation allows at all.
 *
 * ## An installation policy, not a variant of the application
 *
 * A public demonstration runs the same build as a church's own installation.
 * What differs is a decision made by whoever deployed it, in the environment:
 * `OIKONOMIA_DEMO_MODE=true`. Nothing a visitor, a cookie, a URL, the database
 * or an administrator does can turn it on or off, because none of them can
 * change the process environment.
 *
 * ## Where it sits
 *
 *   request → authentication → **installation policy** → authorization → service
 *
 * It only ever removes operations. It never grants one, it never asks who is
 * signed in, and services know nothing about it: `requireAdmin` and every
 * ownership check still decide who may do what among the operations that
 * remain.
 *
 * Enforced centrally, from `src/start.ts`: server functions through global
 * function middleware, route handlers through request middleware.
 */

export class InstallationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallationConfigurationError";
  }
}

export interface Installation {
  demoMode: boolean;
  /**
   * Addresses allowed to sign in with Google on a public demonstration.
   *
   * Empty on an ordinary installation, where Google sign-in is decided by
   * whether it is configured at all, not by a list. Only ever read in Demo
   * Mode — see `demoGoogleTesters`.
   */
  googleTesters?: readonly string[];
}

/**
 * Strictly: unset, `true` or `false`.
 *
 * `1`, `yes`, `TRUE` and ` true` are refused rather than read generously. An
 * installation that is a public demonstration by mistake — or a demonstration
 * that silently is not one — is worse than a server that will not start.
 */
export function parseDemoMode(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new InstallationConfigurationError(
    `OIKONOMIA_DEMO_MODE must be "true" or "false" (or unset); got ${JSON.stringify(raw)}.`,
  );
}

/**
 * Who may sign in with Google on a public demonstration.
 *
 * A demonstration refuses authentication it does not control: nobody arrives
 * at it with an account, and an open Google button would let anybody with a
 * Google account try the door. `OIKONOMIA_DEMO_GOOGLE_TESTERS` names the
 * addresses — the operator's own, to try the journey on the deployed site —
 * and nothing else is let through.
 *
 * Unset (the ordinary case) is an empty list, and an empty list keeps Google
 * sign-in off in Demo Mode entirely, credentials or not. It is not a way to
 * grant anything: a named address still needs an account here, exactly as on
 * a church's own installation.
 */
export function demoGoogleTesters(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  return (env["OIKONOMIA_DEMO_GOOGLE_TESTERS"] ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
}

/** Read from the environment on every call: a process that changes it is believed. */
export function currentInstallation(): Installation {
  return {
    demoMode: parseDemoMode(process.env["OIKONOMIA_DEMO_MODE"]),
    googleTesters: demoGoogleTesters(),
  };
}

/** Strictly: unset, `true` or `false` — the same reading `OIKONOMIA_DEMO_MODE` gets. */
export function parseRequireDemoMode(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new InstallationConfigurationError(
    `OIKONOMIA_REQUIRE_DEMO_MODE must be "true" or "false" (or unset); got ${JSON.stringify(raw)}.`,
  );
}

/**
 * A deployment pinned to run only as a public demonstration.
 *
 * `OIKONOMIA_DEMO_MODE` is a switch — meant to be turned on for a
 * demonstration and left off for a church's own installation, but nothing
 * stops it being unset by an omission: a template missing a line, a `.env`
 * copied from the wrong deployment, a hosting panel's override cleared during
 * a redeploy. For most deployments that failure mode is tolerable — it falls
 * back to an ordinary installation, which is what most deployments are meant
 * to be. **A deployment that must never be an ordinary installation** needs
 * the opposite failure mode.
 *
 * `OIKONOMIA_REQUIRE_DEMO_MODE=true` is that pin: set once, in the private
 * environment file only an operator can write — never derived from a
 * request, a `Host` header, or the database, none of which this function
 * reads — it requires `OIKONOMIA_DEMO_MODE=true` and a dedicated, distinct
 * `OIKONOMIA_DEMO_DB` and `OIKONOMIA_DEMO_BASELINE`. Anything short of that
 * throws, and `src/server.ts` calls this at the same gate that already
 * refuses to serve an installation whose policy cannot be read — before
 * `/healthz`, before every other response. There is no fallback to
 * `OIKONOMIA_DB`: a deployment pinned this way that is missing any of them
 * serves nothing rather than quietly becoming an ordinary installation.
 */
export function assertDeploymentProfile(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!parseRequireDemoMode(env["OIKONOMIA_REQUIRE_DEMO_MODE"])) return;

  if (!parseDemoMode(env["OIKONOMIA_DEMO_MODE"])) {
    throw new InstallationConfigurationError(
      "OIKONOMIA_REQUIRE_DEMO_MODE=true requires OIKONOMIA_DEMO_MODE=true. This deployment is " +
        "pinned to run only as a public demonstration, never as an ordinary installation.",
    );
  }
  if (!env["OIKONOMIA_DEMO_BASELINE"]?.trim()) {
    throw new InstallationConfigurationError(
      "OIKONOMIA_REQUIRE_DEMO_MODE=true requires OIKONOMIA_DEMO_BASELINE to be set.",
    );
  }
  try {
    /* Resolves OIKONOMIA_DEMO_DB and throws if it is unset, or not distinct
       from OIKONOMIA_DB or the baseline — the same rule the database itself
       is opened under, checked here before anything is opened. */
    liveDatabasePath(true, env);
  } catch (error) {
    throw new InstallationConfigurationError(
      `OIKONOMIA_REQUIRE_DEMO_MODE=true: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type Decision =
  { allowed: true } | { allowed: false; because: DenialReason | "unclassified" };

const ALLOW: Decision = { allowed: true };

/**
 * `src/lib/auth-api.ts`, however the build reported the path.
 *
 * The production compiler reports it relative to the project; a development
 * server may not. Anything unrecognisable simply fails to match, and an
 * unmatched POST is refused — so normalising can only avoid a false refusal,
 * never grant an operation.
 */
function operationKey(meta: { filename: string; name: string }): string {
  const path = meta.filename.replaceAll("\\", "/");
  const start = path.startsWith("src/") ? 0 : path.lastIndexOf("/src/") + 1;
  return `${path.slice(start)}#${meta.name}`;
}

/** Whether a server function may run in this installation. */
export function decideServerFunction(
  installation: Installation,
  meta: { filename: string; name: string },
  method: string,
): Decision {
  if (!installation.demoMode) return ALLOW;

  const policy = SERVER_FUNCTIONS[operationKey(meta)];
  if (policy) {
    return policy.demo === "denied" ? { allowed: false, because: policy.because! } : ALLOW;
  }

  /* Nobody decided about this one. A read cannot change anything; a write
     that nobody classified is exactly what must not reach a demonstration. */
  return method.toUpperCase() === "GET" ? ALLOW : { allowed: false, because: "unclassified" };
}

/**
 * Route handlers that do not go through server functions.
 *
 * Pages are not listed: they render, and every change they make goes through
 * a server function, which the table above decides. These are the handlers
 * that act on their own — listed so a test can insist a new one is decided
 * about too.
 */
export const ROUTE_HANDLERS: Readonly<
  Record<string, { demo: "allowed" | "denied" | "by-task" | "by-tester"; because?: DenialReason }>
> = {
  "/healthz": { demo: "allowed" },
  /* Denied unless the operator named testers — see `demoGoogleTesters`. The
     address itself is checked again when Google answers, so reaching these
     handlers signs nobody in. */
  "/auth/google/start": { demo: "by-tester", because: "authentication" },
  "/auth/google/callback": { demo: "by-tester", because: "authentication" },
  /* Bearer-token maintenance for cron: each task is decided on its own. */
  "/maintenance/run": { demo: "by-task" },
};

/**
 * `/maintenance/run?task=…`, task by task.
 *
 * Backups, retention and sweeping keep an installation's own records, and a
 * demonstration has none to keep. `demo-reset` is the one task a demonstration
 * runs — still behind the maintenance token, and still refused by the reset
 * itself on anything that is not a marked demonstration database. A task with
 * no entry — including a missing or misspelled one — is refused.
 */
export const MAINTENANCE_TASKS: Readonly<
  Record<string, { demo: "allowed" | "denied"; because?: DenialReason }>
> = {
  backup: { demo: "denied", because: "data" },
  retention: { demo: "denied", because: "data" },
  sweep: { demo: "denied", because: "data" },
  "demo-reset": { demo: "allowed" },
};

/** Whether a request to a route handler may proceed in this installation. */
export function decideRouteRequest(installation: Installation, url: URL): Decision {
  if (!installation.demoMode) return ALLOW;

  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const route = ROUTE_HANDLERS[pathname];
  if (!route || route.demo === "allowed") return ALLOW;
  if (route.demo === "denied") return { allowed: false, because: route.because! };
  if (route.demo === "by-tester") {
    return (installation.googleTesters ?? []).length > 0
      ? ALLOW
      : { allowed: false, because: route.because! };
  }

  const task = MAINTENANCE_TASKS[url.searchParams.get("task") ?? ""];
  if (task?.demo === "allowed") return ALLOW;
  return { allowed: false, because: task?.because ?? "unclassified" };
}

/**
 * What the browser is told about this installation's policy.
 *
 * Exactly the reasons the tables deny for — derived, not listed again, so a
 * screen's "disabled here" and the server's refusal cannot drift apart. Nothing
 * else: no environment names, paths or settings.
 */
export function installationView(installation: Installation): InstallationView {
  if (!installation.demoMode) return { demo: false, restricted: [] };

  const reasons = new Set<InstallationRestriction>();
  for (const table of [SERVER_FUNCTIONS, ROUTE_HANDLERS, MAINTENANCE_TASKS]) {
    for (const entry of Object.values(table)) {
      if (entry.demo === "denied" && entry.because) reasons.add(entry.because);
    }
  }
  return { demo: true, restricted: [...reasons].sort() };
}

/** The refusal, in the envelope every caller already understands. */
export function refusal(): ApiErrorBody {
  return { code: "disabled-by-installation", message: text("refusal.installation.disabled") };
}
