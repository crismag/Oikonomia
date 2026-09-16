import type { GuideContext, KnowledgeItem } from "../core/types";

/**
 * Whether this reader should be shown an item.
 *
 * Presentation only. Knowledge about a capability the reader lacks is hidden
 * so the Guide does not send them towards what they cannot use — but the host
 * refuses those things on its own, whatever the Guide shows.
 */
export function visibleIn(item: KnowledgeItem, context: GuideContext): boolean {
  if (item.capabilities.length > 0) {
    if (!item.capabilities.some((capability) => context.capabilities.includes(capability))) {
      return false;
    }
  }
  return !item.hideWhen.some((flag) => context.flags.includes(flag));
}
