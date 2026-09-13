import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createServerAuth, type AuthAdapter } from "@/lib/auth-adapter";
import { mayEnter, noMethods, type AuthMethods, type AuthSession } from "@/domain/auth";
import { ORDINARY_INSTALLATION, type InstallationView } from "@/domain/installation";

/**
 * One place that knows who is signed in.
 *
 * Every screen asks this rather than checking for itself, so there is a single
 * answer to "who is this?" and a single place a real backend replaces. Scatter
 * the check and you get screens that disagree — which, in a product holding
 * pastoral notes, is the kind of disagreement that matters.
 *
 * > **What this provides is presentation, not security.** It decides which
 * > screen to draw. What a person may actually read is decided by the server,
 * > every time, in the services — and would be even if this file lied.
 */

interface AuthContextValue {
  session: AuthSession;
  /** True while the session is still unknown. Never render protected content. */
  loading: boolean;
  mayEnter: boolean;
  /** What this installation actually supports. */
  methods: AuthMethods;
  /**
   * What this installation's own policy switches off, and whether it is a
   * public demonstration. For drawing controls honestly; the server enforces.
   */
  installation: InstallationView;
  adapter: AuthAdapter;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Demonstration only: look at a state without having to reach it. */
  demonstrate: (session: AuthSession) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  /* One adapter for the life of the application. Swapped for a real one here. */
  const adapter = useRef<AuthAdapter>(createServerAuth());
  const [session, setSession] = useState<AuthSession>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      setSession(await adapter.current.session());
    } catch {
      /* Never the underlying failure: a sign-in screen is not a place to
         publish what went wrong inside the server. */
      setSession({ status: "error", message: "We could not check your sign-in." });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await adapter.current.signOut();
    setSession({ status: "unauthenticated" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading: session.status === "loading",
      mayEnter: mayEnter(session),
      methods: session.methods ?? noMethods,
      installation: session.installation ?? ORDINARY_INSTALLATION,
      adapter: adapter.current,
      refresh,
      signOut,
      demonstrate: setSession,
    }),
    [session, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
