import type { KnowledgeItem } from "../core/types";
import { parseKnowledge } from "./parse";

/**
 * A whole knowledge pack, checked as product data.
 *
 * Everything that would make a topic silently wrong or missing is an error:
 * malformed files, duplicate ids, unknown categories, related ids or topic
 * links that go nowhere, destinations or capabilities the host does not know.
 * Run in the test suite, so a broken corpus fails the build.
 */

export interface KnowledgeSource {
  path: string;
  raw: string;
}

export interface PackRules {
  categories: string[];
  /** Destinations the host can resolve. */
  destinations: (id: string) => boolean;
  /** Capabilities the host recognises. */
  capabilities: (capability: string) => boolean;
}

export interface CorpusResult {
  items: KnowledgeItem[];
  errors: string[];
}

export function buildCorpus(sources: KnowledgeSource[], rules?: PackRules): CorpusResult {
  const errors: string[] = [];
  const items: KnowledgeItem[] = [];
  const links = new Map<string, { topics: string[]; destinations: string[] }>();

  for (const source of sources) {
    const parsed = parseKnowledge(source.raw, source.path);
    errors.push(...parsed.errors);
    if (!parsed.item) continue;
    items.push(parsed.item);
    links.set(parsed.item.id, { topics: parsed.topicLinks, destinations: parsed.destinations });
  }

  const ids = new Map<string, string>();
  for (const item of items) {
    const first = ids.get(item.id);
    if (first) errors.push(`${item.source}: id "${item.id}" is already used by ${first}`);
    else ids.set(item.id, item.source);
  }

  for (const item of items) {
    for (const related of item.related) {
      if (!ids.has(related)) errors.push(`${item.source}: related "${related}" does not exist`);
      if (related === item.id) errors.push(`${item.source}: an item cannot relate to itself`);
    }
    const { topics, destinations } = links.get(item.id)!;
    for (const topic of topics) {
      if (!ids.has(topic)) errors.push(`${item.source}: link to topic "${topic}" goes nowhere`);
    }
    if (!rules) continue;
    if (!rules.categories.includes(item.category)) {
      errors.push(`${item.source}: category "${item.category}" is not one of the pack's`);
    }
    for (const destination of destinations) {
      if (!rules.destinations(destination)) {
        errors.push(`${item.source}: destination "${destination}" is not known to the host`);
      }
    }
    for (const capability of item.capabilities) {
      if (!rules.capabilities(capability)) {
        errors.push(`${item.source}: capability "${capability}" is not known to the host`);
      }
    }
  }

  return { items, errors };
}
