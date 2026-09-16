import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";

import { useAuth } from "@/components/oikonomia/auth-provider";
import { GuideProvider, type GuideHostAdapter } from "@/features/guide";
import { useViewer } from "@/domain/session";
import { guideContextFor } from "./context";
import { destinations, mayOpen } from "./destinations";

/**
 * Whether Oikonomia mounts the Guide.
 *
 * One switch. Turned off, the shell renders exactly as it did before the Guide
 * existed: no button, no panel, no knowledge loaded.
 */
export const GUIDE_ENABLED = true;

/**
 * Oikonomia's side of the Guide: the host adapter, and nothing else.
 *
 * It translates the signed-in viewer, the route and the installation into a
 * `GuideContext`, answers whether a semantic destination is offered to this
 * viewer (from the navigation's own capability filter), and navigates. Guide
 * Core never imports Oikonomia; this file is the whole bridge.
 */
export function OikonomiaGuide({ children }: { children: ReactNode }) {
  const { persona } = useViewer();
  const { installation } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();

  const host: GuideHostAdapter = {
    getContext: () =>
      guideContextFor({ pathname, capabilities: persona.capabilities, installation }),
    hasCapability: (capability) => (persona.capabilities as readonly string[]).includes(capability),
    canNavigate: (id) => mayOpen(id, persona),
    destinationLabel: (id) => destinations[id]?.label,
    navigate: (id) => {
      const destination = destinations[id];
      if (!destination || !mayOpen(id, persona)) return;
      void navigate({
        to: destination.path,
        ...(destination.search ? { search: destination.search } : {}),
        ...(destination.hash ? { hash: destination.hash } : {}),
      } as never);
    },
    /* Oikonomia has no product analytics; events are available to add one. */
  };

  const loadKnowledge = useCallback(
    () => import("./knowledge-pack").then((pack) => pack.loadOikonomiaKnowledge()),
    [],
  );

  return (
    <GuideProvider
      host={host}
      loadKnowledge={loadKnowledge}
      enabled={GUIDE_ENABLED}
      routeKey={pathname}
    >
      {children}
    </GuideProvider>
  );
}
