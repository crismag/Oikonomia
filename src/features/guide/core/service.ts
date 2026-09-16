import type {
  GuideAnswerProvider,
  GuideHostAdapter,
  GuideKnowledgeProvider,
  GuideRetrievalResult,
  GuideRetriever,
} from "./contracts";
import type { GuideContext, GuideResponse, GuideSuggestion, KnowledgeItem } from "./types";
import { visibleIn } from "../retrieval/visibility";

/**
 * The Guide service: the one thing the panel talks to.
 *
 * It composes a knowledge provider, a retriever and an answer provider behind
 * four questions — what helps here, show me this topic, answer this, and what
 * is there. Replace the retriever or the answer provider and the panel does
 * not change.
 */
export interface GuideService {
  home(): Promise<GuideResponse>;
  topic(id: string): Promise<GuideResponse>;
  ask(query: string): Promise<GuideResponse>;
  browse(): Promise<GuideResponse>;
}

export const suggestionOf = (item: KnowledgeItem): GuideSuggestion => ({
  id: item.id,
  title: item.title,
  type: item.type,
  summary: item.summary,
});

export function createGuideService(parts: {
  host: GuideHostAdapter;
  knowledge: GuideKnowledgeProvider;
  retriever: GuideRetriever;
  answers?: GuideAnswerProvider;
}): GuideService {
  const { host, knowledge, retriever } = parts;
  const context = () => host.getContext();
  const visible = (ctx: GuideContext) => knowledge.list().filter((item) => visibleIn(item, ctx));

  function relevantHere(ctx: GuideContext): KnowledgeItem[] {
    const items = visible(ctx);
    const byId = new Map(items.map((item) => [item.id, item]));
    const named = (ctx.topics ?? []).map((id) => byId.get(id)).filter(Boolean) as KnowledgeItem[];
    const onPage = items.filter(
      (item) =>
        !named.includes(item) &&
        ((ctx.page && item.pages.includes(ctx.page)) ||
          (ctx.module && item.modules.includes(ctx.module))),
    );
    return [...named, ...onPage];
  }

  function article(item: KnowledgeItem, ctx: GuideContext) {
    const related = item.related
      .map((id) => knowledge.get(id))
      .filter((r): r is KnowledgeItem => !!r && visibleIn(r, ctx))
      .map(suggestionOf);

    if (item.type === "walkthrough") {
      return {
        kind: "walkthrough" as const,
        item: suggestionOf(item),
        steps: item.steps.map((step) =>
          step.destination && !host.canNavigate(step.destination)
            ? { title: step.title, body: step.body }
            : step,
        ),
        related,
        sourceIds: [item.id],
      };
    }
    return {
      kind: "article" as const,
      item: suggestionOf(item),
      body: item.body,
      related,
      destinations: item.destinations
        .filter((id) => host.canNavigate(id))
        .map((id) => ({ id, label: host.destinationLabel(id) ?? id })),
      sourceIds: [item.id],
    };
  }

  /* Deterministic answering: curated content as it stands, never composed. */
  const deterministicAnswers: GuideAnswerProvider = {
    async answer(query, ctx, retrieval: GuideRetrievalResult) {
      const results = retrieval.hits.map((hit) => suggestionOf(hit.item));
      if (retrieval.hits.length === 0) {
        const suggestions = relevantHere(ctx).slice(0, 6).map(suggestionOf);
        return { kind: "fallback", query, suggestions, sourceIds: [] };
      }
      const top = retrieval.hits[0]!.item;
      return {
        kind: "results",
        query,
        ...(retrieval.confident ? { answer: article(top, ctx) } : {}),
        results: retrieval.confident ? results.slice(1) : results,
        sourceIds: retrieval.hits.map((hit) => hit.item.id),
      };
    },
  };
  const answers = parts.answers ?? deterministicAnswers;

  return {
    async home() {
      const ctx = context();
      const here = relevantHere(ctx);
      const pageItem = here.find(
        (item) => item.type === "page" && !!ctx.page && item.pages.includes(ctx.page),
      );
      const others = here.filter((item) => item !== pageItem);
      return {
        kind: "home",
        title: pageItem?.title ?? "Oikonomia Guide",
        ...(pageItem ? { summary: pageItem.summary } : {}),
        suggestions: [
          ...(pageItem ? [pageItem] : []),
          ...others.filter((item) => item.type !== "walkthrough"),
        ]
          .slice(0, 8)
          .map(suggestionOf),
        walkthroughs: others
          .filter((item) => item.type === "walkthrough")
          .slice(0, 3)
          .map(suggestionOf),
        sourceIds: here.map((item) => item.id),
      };
    },

    async topic(id) {
      const ctx = context();
      const item = knowledge.get(id);
      /* A topic this reader should not be shown is answered like one that is
         not there — the Guide is not a way to discover hidden functionality. */
      if (!item || !visibleIn(item, ctx)) {
        return {
          kind: "fallback",
          query: "",
          suggestions: relevantHere(ctx).slice(0, 6).map(suggestionOf),
          sourceIds: [],
        };
      }
      host.onEvent?.({ type: "guide_topic_opened", id, route: ctx.route });
      return article(item, ctx);
    },

    async ask(query) {
      const ctx = context();
      const trimmed = query.trim();
      const retrieval = await retriever.retrieve({ query: trimmed, context: ctx });
      host.onEvent?.(
        retrieval.hits.length === 0
          ? { type: "guide_search_no_result", query: trimmed, route: ctx.route }
          : {
              type: "guide_search",
              query: trimmed,
              resultCount: retrieval.hits.length,
              route: ctx.route,
            },
      );
      return answers.answer(trimmed, ctx, retrieval);
    },

    async browse() {
      const ctx = context();
      const items = visible(ctx);
      return {
        kind: "browse",
        categories: knowledge
          .categories()
          .map((category) => ({
            ...category,
            items: items
              .filter((item) => item.category === category.id)
              .sort((a, b) => typeOrder(a) - typeOrder(b) || a.title.localeCompare(b.title))
              .map(suggestionOf),
          }))
          .filter((category) => category.items.length > 0),
        sourceIds: items.map((item) => item.id),
      };
    },
  };
}

/* Explanations before instructions: what a thing is, then how to do it. */
const ORDER = ["page", "concept", "procedure", "walkthrough", "permission", "troubleshooting"];
const typeOrder = (item: KnowledgeItem) => ORDER.indexOf(item.type);
