import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./server/http/security-headers";
import { assertDeploymentProfile, currentInstallation } from "./server/installation/policy";

/** Logged once per process, not once per request. */
let reportedMisconfiguration = false;

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    /* Applied here because this is the one place every response passes
       through — the error pages below included. A policy that covers the
       application but not its failure modes is a policy with a gap exactly
       where things have already gone wrong. */
    /* An installation whose policy cannot be read serves nothing — not even
       /healthz — because a demonstration that is silently not one, or a
       church installation that silently is, is worse than an outage that
       names its cause. A deployment pinned to always be a demonstration
       (OIKONOMIA_REQUIRE_DEMO_MODE=true) is held to the same rule: missing or
       wrong Demo configuration serves nothing, rather than quietly falling
       back to an ordinary installation. */
    try {
      currentInstallation();
      assertDeploymentProfile();
    } catch (error) {
      if (!reportedMisconfiguration) console.error(error);
      reportedMisconfiguration = true;
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
