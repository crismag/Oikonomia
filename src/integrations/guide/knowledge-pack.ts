import { knownCapabilities } from "@/config";
import { createMemoryKnowledgeProvider } from "@/features/guide/knowledge/repository";
import {
  buildCorpus,
  type CorpusResult,
  type PackRules,
} from "@/features/guide/knowledge/validate";
import type { GuideKnowledgeProvider } from "@/features/guide/core/contracts";
import { isKnownDestination } from "./destinations";
import { oikonomiaCategories } from "./pack";

/**
 * The Oikonomia knowledge pack: every Markdown file under
 * `knowledge/oikonomia/`, bundled at build time.
 *
 * Imported lazily by the Guide the first time it opens, so the corpus is not
 * part of the application's startup. Adding a file is enough to add a topic.
 */
const FILES = import.meta.glob("/knowledge/oikonomia/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const oikonomiaPackRules: PackRules = {
  categories: oikonomiaCategories.map((category) => category.id),
  destinations: isKnownDestination,
  capabilities: (capability) => (knownCapabilities as readonly string[]).includes(capability),
};

export function buildOikonomiaCorpus(): CorpusResult {
  return buildCorpus(
    Object.entries(FILES).map(([path, raw]) => ({ path, raw })),
    oikonomiaPackRules,
  );
}

export function loadOikonomiaKnowledge(): GuideKnowledgeProvider {
  const { items, errors } = buildOikonomiaCorpus();
  /* The test suite refuses a broken corpus; this only surfaces one in development. */
  if (errors.length > 0 && import.meta.env?.DEV) {
    console.warn(`Guide knowledge has ${errors.length} problem(s):\n${errors.join("\n")}`);
  }
  return createMemoryKnowledgeProvider(items, oikonomiaCategories);
}
