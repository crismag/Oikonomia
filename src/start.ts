import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
//
// Browsers that send `Sec-Fetch-Site` are judged on that alone. The rest are
// judged by `Origin`, which by default is compared with the request's own URL —
// and behind a TLS-terminating proxy that URL says `http://` while the browser
// says `https://`, refusing every server function. The configured address is
// the installation's real origin, read from configuration rather than from
// forwarded headers a client can write.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin, ctx) => origin === expectedOrigin(ctx.request),
});

function expectedOrigin(request: Request): string {
  const configured = process.env["OIKONOMIA_URL"]?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* A malformed address is reported where links are built; here it falls
         back to the request's own origin rather than refusing everything. */
    }
  }
  return new URL(request.url).origin;
}

/*
 * Installation policy (`src/server/installation/policy.ts`): what this
 * installation allows at all, whoever is asking. Off unless the environment
 * says `OIKONOMIA_DEMO_MODE=true`, and then a pure subtraction — nothing here
 * grants an operation or asks who is signed in.
 *
 * The policy is imported lazily inside each server body, as the API modules
 * import server code: this file is also part of the browser bundle, which may
 * not reference `src/server/`.
 */

/** Route handlers that act without a server function: Google sign-in, maintenance. */
export const installationRequestMiddleware = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    if (handlerType !== "router") return next();

    const { currentInstallation, decideRouteRequest, refusal } =
      await import("./server/installation/policy");
    const decision = decideRouteRequest(currentInstallation(), new URL(request.url));
    if (decision.allowed) return next();

    return new Response(JSON.stringify({ ok: false, error: refusal() }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  },
);

/**
 * Every server function, before its own validation, authorization or work.
 *
 * A refused call answers in the envelope the function itself would have used,
 * so the caller's `unwrap()` raises it like any other refusal.
 */
export const installationFunctionMiddleware = createMiddleware({ type: "function" }).server(
  async (context) => {
    const { currentInstallation, decideServerFunction, refusal } =
      await import("./server/installation/policy");
    const decision = decideServerFunction(
      currentInstallation(),
      context.serverFnMeta,
      context.method,
    );
    if (decision.allowed) return context.next();

    /* Returning the context with a result, rather than calling `next()`, is
       how TanStack Start's middleware runner ends a call early; the typed API
       only describes the `next()` path. */
    return { ...context, result: { error: refusal() } } as never;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, installationRequestMiddleware, csrfMiddleware],
  functionMiddleware: [installationFunctionMiddleware],
}));
