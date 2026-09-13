import type { ApiErrorBody } from "@/lib/api-envelope";
import { text } from "@/config/messages";

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

/** Read from the environment on every call: a process that changes it is believed. */
export function currentInstallation(): Installation {
  return { demoMode: parseDemoMode(process.env["OIKONOMIA_DEMO_MODE"]) };
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
  Record<string, { demo: "allowed" | "denied" | "by-task"; because?: DenialReason }>
> = {
  "/healthz": { demo: "allowed" },
  "/auth/google/start": { demo: "denied", because: "authentication" },
  "/auth/google/callback": { demo: "denied", because: "authentication" },
  /* Bearer-token maintenance for cron: each task is decided on its own. */
  "/maintenance/run": { demo: "by-task" },
};

/**
 * `/maintenance/run?task=…`, task by task.
 *
 * Every task that exists today writes backups or prunes the installation's own
 * records, and a demonstration has neither to keep. A later task that a
 * demonstration needs (resetting itself) is added here as `allowed`; a task
 * with no entry — including a missing or misspelled one — is refused.
 */
export const MAINTENANCE_TASKS: Readonly<
  Record<string, { demo: "allowed" | "denied"; because?: DenialReason }>
> = {
  backup: { demo: "denied", because: "data" },
  retention: { demo: "denied", because: "data" },
  sweep: { demo: "denied", because: "data" },
};

/** Whether a request to a route handler may proceed in this installation. */
export function decideRouteRequest(installation: Installation, url: URL): Decision {
  if (!installation.demoMode) return ALLOW;

  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const route = ROUTE_HANDLERS[pathname];
  if (!route || route.demo === "allowed") return ALLOW;
  if (route.demo === "denied") return { allowed: false, because: route.because! };

  const task = MAINTENANCE_TASKS[url.searchParams.get("task") ?? ""];
  if (task?.demo === "allowed") return ALLOW;
  return { allowed: false, because: task?.because ?? "unclassified" };
}

/** The refusal, in the envelope every caller already understands. */
export function refusal(): ApiErrorBody {
  return { code: "disabled-by-installation", message: text("refusal.installation.disabled") };
}
