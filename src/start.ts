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

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
