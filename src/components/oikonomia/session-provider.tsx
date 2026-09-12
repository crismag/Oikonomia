import { useCallback, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SessionContext } from "@/domain/session";
import { signOut as signOutOnServer } from "@/lib/auth-api";
import { withTimeout } from "@/lib/calendar-client";

/**
 * Signing out.
 *
 * ## Why this is a server call and not a cookie deletion
 *
 * It used to clear a cookie. That cookie *was* the claim, so deleting it was
 * the whole of signing out — and when real sessions arrived, the same code
 * left a live session on the server while the browser looked signed out.
 * Somebody who had the cookie still had access.
 *
 * So signing out is the server destroying the session. The cookie it clears is
 * `HttpOnly` and cannot be cleared from here anyway, which is the correct
 * shape: the browser asks, and the server decides.
 *
 * ## Signing *in* is not here
 *
 * There is no `signIn` any more. Becoming somebody is proving who you are, on
 * `/login`, through `auth-adapter`. A function that made this browser somebody
 * without proof is exactly what this milestone removed.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    try {
      await withTimeout(signOutOnServer({ data: undefined }));
    } finally {
      /* Everything loaded was loaded as somebody. None of it may be kept, and
         a failed call is still a sign-out attempt worth honouring locally. */
      queryClient.clear();
      if (typeof window !== "undefined") window.location.assign("/login");
    }
  }, [queryClient]);

  const value = useMemo(() => ({ signOut }), [signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
