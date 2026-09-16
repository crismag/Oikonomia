import type { GuideKnowledgeProvider } from "../core/contracts";
import type { KnowledgeItem } from "../core/types";

/**
 * Knowledge held in memory. The initial provider: a pack parsed once when the
 * Guide first opens. A database- or index-backed provider implements the same
 * contract.
 */
export function createMemoryKnowledgeProvider(
  items: KnowledgeItem[],
  categories: { id: string; title: string }[],
): GuideKnowledgeProvider {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    get: (id) => byId.get(id),
    list: () => items,
    categories: () => categories,
  };
}
