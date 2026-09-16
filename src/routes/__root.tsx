import { APPEARANCE_BOOT_SCRIPT } from "@/domain/appearance";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AppShell } from "@/components/oikonomia/app-shell";
import { DemoHeader } from "@/components/oikonomia/demo-header";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/config";
import { OrganizationProvider } from "@/components/oikonomia/organization-provider";
import { SessionProvider } from "@/components/oikonomia/session-provider";
import { AuthProvider } from "@/components/oikonomia/auth-provider";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Oikonomia — Church leadership workspace" },
      {
        name: "description",
        content:
          "Oikonomia is a ministry operating workspace built around one question: what needs my attention?",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        /* Every theme's typefaces. Each face is only fetched by a browser once a
           theme uses it, so the unused ones cost a stylesheet, not the fonts. */
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  /* The request's CSP nonce: without it the browser refuses this script. */
  const nonce = useRouter().options.ssr?.nonce;
  return (
    /* The theme is set on <html> by the script below before React hydrates,
       so the server's markup and the browser's differ there on purpose. */
    <html lang="en" data-theme="glass" suppressHydrationWarning>
      <head>
        {/* Before first paint: a dark or themed page must never flash the
            default first. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* One toaster and one confirmation dialog for the whole application:
          pages say what happened, and this decides how it is shown. */}
      <Toaster position="bottom-right" closeButton />
      <ConfirmProvider>
        <AuthProvider>
          <OrganizationProvider>
            <SessionProvider>
              {/* Only on a public demonstration; nothing on an ordinary installation. */}
              <DemoHeader />
              <AppShell>
                {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
                <Outlet />
              </AppShell>
            </SessionProvider>
          </OrganizationProvider>
        </AuthProvider>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
