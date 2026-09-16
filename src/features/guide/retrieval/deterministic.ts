import type {
  GuideKnowledgeProvider,
  GuideRetrievalHit,
  GuideRetrievalRequest,
  GuideRetrievalResult,
  GuideRetriever,
} from "../core/contracts";
import type { KnowledgeItem } from "../core/types";
import { blocksText } from "../knowledge/markdown";
import { normalizeText, tokens } from "./normalize";
import { visibleIn } from "./visibility";

/**
 * Deterministic retrieval over curated metadata.
 *
 * Signals, strongest first: the id or title said exactly; an alias said
 * exactly or contained; keyword phrases; title words; summary and body words.
 * Page, module and the host's topics for this page only lift items that
 * already matched — context breaks ties, it never invents a match.
 *
 * Every score is explained in `reasons`, so a surprising result can be traced,
 * and a future hybrid retriever can combine these signals with others.
 */

/** Below this, a match is noise. */
const MIN_SCORE = 8;
/** At or above this, with a clear lead, the top result is the answer. */
const CONFIDENT_SCORE = 40;
const CONFIDENT_LEAD = 1.3;

interface Indexed {
  item: KnowledgeItem;
  id: string;
  title: string;
  titleTokens: Set<string>;
  aliases: string[];
  keywords: string[];
  keywordTokens: Set<string>;
  summaryTokens: Set<string>;
  bodyTokens: Set<string>;
}

function index(item: KnowledgeItem): Indexed {
  const steps = item.steps.map((step) => `${step.title} ${blocksText(step.body)}`).join(" ");
  return {
    item,
    id: normalizeText(item.id),
    title: normalizeText(item.title),
    titleTokens: new Set(tokens(item.title)),
    aliases: item.aliases.map(normalizeText).filter(Boolean),
    keywords: item.keywords.map(normalizeText).filter(Boolean),
    keywordTokens: new Set(item.keywords.flatMap(tokens)),
    summaryTokens: new Set(tokens(item.summary)),
    bodyTokens: new Set(tokens(`${blocksText(item.body)} ${steps}`)),
  };
}

const overlap = (query: string[], set: Set<string>) => query.filter((t) => set.has(t)).length;

export function createDeterministicRetriever(knowledge: GuideKnowledgeProvider): GuideRetriever {
  let cache: { source: KnowledgeItem[]; indexed: Indexed[] } | null = null;
  const indexed = () => {
    const source = knowledge.list();
    if (!cache || cache.source !== source) cache = { source, indexed: source.map(index) };
    return cache.indexed;
  };

  return {
    async retrieve({ query, context, limit = 8 }: GuideRetrievalRequest) {
      return retrieveSync(indexed(), query, context, limit);
    },
  };
}

function retrieveSync(
  entries: Indexed[],
  query: string,
  context: GuideRetrievalRequest["context"],
  limit: number,
): GuideRetrievalResult {
  const phrase = normalizeText(query);
  const words = tokens(query);
  if (!phrase) return { hits: [], confident: false };

  const hits: GuideRetrievalHit[] = [];

  for (const entry of entries) {
    if (!visibleIn(entry.item, context)) continue;
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string) => {
      if (points <= 0) return;
      score += points;
      reasons.push(reason);
    };

    if (phrase === entry.id || phrase === entry.title) add(100, "exact title");

    for (const alias of entry.aliases) {
      if (phrase === alias) add(90, `alias "${alias}"`);
      else if (alias.split(" ").length >= 2 && phrase.includes(alias))
        add(45, `contains alias "${alias}"`);
      else {
        const aliasWords = tokens(alias);
        const shared = aliasWords.length
          ? overlap(words, new Set(aliasWords)) / aliasWords.length
          : 0;
        if (shared >= 0.6 && words.length > 0)
          add(Math.round(35 * shared), `alias words "${alias}"`);
      }
    }

    let phrases = 0;
    for (const keyword of entry.keywords) {
      if (phrases < 2 && ` ${phrase} `.includes(` ${keyword} `)) {
        add(keyword.includes(" ") ? 25 : 15, `keyword "${keyword}"`);
        phrases++;
      }
    }

    add(overlap(words, entry.titleTokens) * 10, "title words");
    add(overlap(words, entry.keywordTokens) * 5, "keyword words");
    add(overlap(words, entry.summaryTokens) * 3, "summary words");
    add(Math.min(overlap(words, entry.bodyTokens), 5), "body words");

    if (score < MIN_SCORE) continue;

    /* Context lifts what already matched; it never makes a match. */
    if (context.topics?.includes(entry.item.id)) add(10, "topic of this page");
    if (context.page && entry.item.pages.includes(context.page)) add(8, "this page");
    if (context.module && entry.item.modules.includes(context.module)) add(4, "this area");

    hits.push({ item: entry.item, score, reasons });
  }

  hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  const top = hits[0];
  const second = hits[1];
  const confident =
    !!top &&
    top.score >= CONFIDENT_SCORE &&
    (!second || top.score >= second.score * CONFIDENT_LEAD);

  return { hits: hits.slice(0, limit), confident };
}
