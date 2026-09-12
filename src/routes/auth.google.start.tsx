import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Starting a Google sign-in.
 *
 * A full-page redirect rather than a fetch, because the next thing that happens
 * is Google's own screen. The `state` generated here is remembered in a short
 * cookie and checked on the way back: without that check, a third party can
 * complete somebody else's sign-in, which is login CSRF.
 *
 * When Google is not configured this sends the person back to the sign-in page
 * rather than to a page that cannot work.
 */
export const Route = createFileRoute("/auth/google/start")({
  server: {
    handlers: {
      GET: async () => {
        const [{ startUrl }, { stateCookie }] = await Promise.all([
          import("@/server/auth/google"),
          import("@/server/auth/oauth-state"),
        ]);

        const start = startUrl();
        if (!start) {
          return new Response(null, {
            status: 302,
            headers: { location: "/login?step=sign-in" },
          });
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: start.url,
            "set-cookie": stateCookie(start.state),
          },
        });
      },
    },
  },
  beforeLoad: () => {
    throw redirect({ to: "/login", search: {} });
  },
});
