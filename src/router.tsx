import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

/**
 * The Content-Security-Policy nonce for this request (`src/server.ts`), which
 * the router puts on every inline script it streams — the dehydrated state,
 * React's own, the scroll restorer — and in a `csp-nonce` meta tag the
 * browser-side router reads back. `undefined` in the browser, and wherever the
 * router is built before the request context exists (a redirect answered
 * without rendering), where there is no inline script to allow.
 */
function requestNonce(): string | undefined {
  try {
    const context = getGlobalStartContext() as { nonce?: unknown } | undefined;
    return typeof context?.nonce === "string" ? context.nonce : undefined;
  } catch {
    return undefined;
  }
}

export const getRouter = () => {
  const queryClient = new QueryClient();
  const nonce = requestNonce();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  });

  return router;
};
