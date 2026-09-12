import { createContext, useContext } from "react";

import type { Viewer } from "./viewer";

/**
 * The session: who is signed in.
 *
 * Nothing is routed here. What a leader is being asked for lives in the
 * Leadership Inbox, because it exists only where somebody asked — and what
 * they have read is a reading state, not a queue.
 *
 * > **Not authentication.** Signing in states a claim and is believed. See
 * > `src/server/auth/current-user.ts`.
 */

export interface Session {
  signOut: () => void | Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/**
 * The viewer.
 *
 * Only ever called inside the application shell, which does not render until
 * somebody is signed in — so this may assume a viewer where the organization
 * store may not.
 */
export function useViewer(): Viewer {
  const value = useContext(ViewerContext);
  if (!value) {
    throw new Error("useViewer was called with nobody signed in; the shell should have gated it");
  }
  return value;
}

export const ViewerContext = createContext<Viewer | null>(null);
