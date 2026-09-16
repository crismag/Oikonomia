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

import type { GuideHostAdapter, GuideKnowledgeProvider } from "../core/contracts";
import { createGuideService, type GuideService } from "../core/service";
import type { GuideResponse } from "../core/types";
import { createDeterministicRetriever } from "../retrieval/deterministic";
import {
  moveWalkthrough,
  startWalkthrough,
  type WalkthroughMove,
  type WalkthroughProgress,
} from "../walkthrough/engine";

/**
 * Guide state for one session in one browser tab.
 *
 * What the panel shows is a small history of views — this page's help, a
 * topic, an answer to a question, the browser — so Back behaves like a reader
 * expects. Nothing is persisted beyond the tab except whether the panel was
 * open, and nothing is sent anywhere.
 */

export type GuideView =
  | { kind: "home" }
  | { kind: "topic"; id: string }
  | { kind: "ask"; query: string }
  | { kind: "browse" };

interface GuideState {
  enabled: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Open the Guide straight to a topic — for `[?]` hints beside a control. */
  openTopic: (id: string) => void;
  ask: (query: string) => void;
  browse: () => void;
  goHome: () => void;
  back: () => void;
  canGoBack: boolean;
  view: GuideView;
  response: GuideResponse | null;
  loading: boolean;
  host: GuideHostAdapter;
  /**
   * Ask the host to open a destination. On a narrow screen the Guide covers
   * the page, so it steps aside; on a wide one it stays beside the page.
   */
  navigate: (destinationId: string) => void;
  /** Where the reader is in each walkthrough, kept while the tab is open. */
  walkthrough: (id: string, total: number) => WalkthroughProgress;
  moveWalkthrough: (id: string, total: number, move: WalkthroughMove) => WalkthroughProgress;
  /** The element focus returns to when the panel closes. */
  setReturnFocus: (element: HTMLElement | null) => void;
}

const GuideContext = createContext<GuideState | null>(null);

const OPEN_KEY = "guide.open";

export function GuideProvider({
  host,
  loadKnowledge,
  enabled = true,
  routeKey,
  children,
}: {
  host: GuideHostAdapter;
  /** Loaded the first time the Guide opens, not at startup. */
  loadKnowledge: () => Promise<GuideKnowledgeProvider>;
  enabled?: boolean;
  /** Changes when the host's page changes, so this page's help refreshes. */
  routeKey: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [stack, setStack] = useState<GuideView[]>([{ kind: "home" }]);
  const [response, setResponse] = useState<GuideResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [service, setService] = useState<GuideService | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState<Record<string, WalkthroughProgress>>({});
  const hostRef = useRef(host);
  hostRef.current = host;

  /* The host adapter changes every render; the service reads it through a ref. */
  const liveHost = useMemo<GuideHostAdapter>(
    () => ({
      getContext: () => hostRef.current.getContext(),
      hasCapability: (c) => hostRef.current.hasCapability(c),
      canNavigate: (d) => hostRef.current.canNavigate(d),
      destinationLabel: (d) => hostRef.current.destinationLabel(d),
      navigate: (d) => hostRef.current.navigate(d),
      onEvent: (e) => hostRef.current.onEvent?.(e),
    }),
    [],
  );

  /* A convenience only: the panel reopens where the reader left it. */
  useEffect(() => {
    if (!enabled) return;
    try {
      if (
        window.localStorage.getItem(OPEN_KEY) === "1" &&
        window.matchMedia("(min-width: 1440px)").matches
      ) {
        setIsOpen(true);
      }
    } catch {
      /* Storage unavailable: start closed. */
    }
  }, [enabled]);

  useEffect(() => {
    if (!isOpen || service) return;
    let cancelled = false;
    void loadKnowledge().then((knowledge) => {
      if (cancelled) return;
      setService(
        createGuideService({
          host: liveHost,
          knowledge,
          retriever: createDeterministicRetriever(knowledge),
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, service, loadKnowledge, liveHost]);

  const view = stack[stack.length - 1]!;

  useEffect(() => {
    if (!isOpen || !service) return;
    let cancelled = false;
    setLoading(true);
    const load =
      view.kind === "home"
        ? service.home()
        : view.kind === "topic"
          ? service.topic(view.id)
          : view.kind === "ask"
            ? service.ask(view.query)
            : service.browse();
    void load.then((next) => {
      if (cancelled) return;
      setResponse(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    /* `routeKey` refreshes this page's help when the reader moves page. */
  }, [isOpen, service, view, routeKey]);

  const remember = (open: boolean) => {
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* Not remembered; nothing else depends on it. */
    }
  };

  const open = useCallback(() => {
    setIsOpen((wasOpen) => {
      if (!wasOpen)
        liveHost.onEvent?.({ type: "guide_opened", route: liveHost.getContext().route });
      return true;
    });
    remember(true);
  }, [liveHost]);

  const close = useCallback(() => {
    setIsOpen(false);
    remember(false);
    const target = returnFocus.current;
    if (target) window.setTimeout(() => target.focus(), 0);
  }, []);

  const push = useCallback(
    (next: GuideView) => {
      setStack((current) => {
        const top = current[current.length - 1]!;
        if (JSON.stringify(top) === JSON.stringify(next)) return current;
        return [...current, next].slice(-30);
      });
      open();
    },
    [open],
  );

  const value = useMemo<GuideState>(
    () => ({
      enabled,
      isOpen,
      open,
      close,
      toggle: () => (isOpen ? close() : open()),
      openTopic: (id) => push({ kind: "topic", id }),
      ask: (query) => {
        if (query.trim()) push({ kind: "ask", query: query.trim() });
      },
      browse: () => push({ kind: "browse" }),
      goHome: () => setStack([{ kind: "home" }]),
      back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      canGoBack: stack.length > 1,
      view,
      response: service ? response : null,
      loading: !service || loading,
      host: liveHost,
      navigate: (destinationId) => {
        liveHost.navigate(destinationId);
        if (!window.matchMedia("(min-width: 1440px)").matches) {
          setIsOpen(false);
        }
      },
      walkthrough: (id, total) => progress[id] ?? startWalkthrough(id, total),
      moveWalkthrough: (id, total, move) => {
        const next = moveWalkthrough(progress[id] ?? startWalkthrough(id, total), move);
        setProgress((current) => ({ ...current, [id]: next }));
        return next;
      },
      setReturnFocus: (element) => {
        returnFocus.current = element;
      },
    }),
    [
      enabled,
      isOpen,
      open,
      close,
      push,
      stack.length,
      view,
      service,
      response,
      loading,
      liveHost,
      progress,
    ],
  );

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useGuide(): GuideState {
  const value = useContext(GuideContext);
  if (!value) throw new Error("useGuide must be used inside GuideProvider");
  return value;
}

/** For optional entry points (a `[?]` hint) that must render without a Guide. */
export function useOptionalGuide(): GuideState | null {
  return useContext(GuideContext);
}
