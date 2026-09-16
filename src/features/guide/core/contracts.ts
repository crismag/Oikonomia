import type { GuideContext, GuideEvent, GuideResponse, KnowledgeItem } from "./types";

/**
 * The seams between Guide and everything around it.
 *
 * Guide Core depends on these interfaces and nothing else. A host supplies an
 * adapter and a knowledge pack; retrieval and answering are replaceable.
 */

/**
 * What the host application lets Guide see and ask for.
 *
 * Deliberately narrow. Guide never receives the application's state, and it
 * never performs actions — `navigate` opens a place the reader could already
 * open themselves, and the host still enforces access when they arrive.
 */
export interface GuideHostAdapter {
  getContext(): GuideContext;
  /** Visibility only. The host's own authorization remains authoritative. */
  hasCapability(capability: string): boolean;
  /** Whether a semantic destination exists and is offered to this reader. */
  canNavigate(destinationId: string): boolean;
  /** A human label for a destination, e.g. "Open Leadership Reports". */
  destinationLabel(destinationId: string): string | undefined;
  navigate(destinationId: string): void;
  /** Optional. Guide calls it; the host decides whether anything records it. */
  onEvent?(event: GuideEvent): void;
}

/** Where knowledge comes from. Local Markdown today; anything later. */
export interface GuideKnowledgeProvider {
  get(id: string): KnowledgeItem | undefined;
  list(): KnowledgeItem[];
  /** Browse categories, in display order. */
  categories(): { id: string; title: string }[];
}

export interface GuideRetrievalRequest {
  query: string;
  context: GuideContext;
  limit?: number;
}

export interface GuideRetrievalHit {
  item: KnowledgeItem;
  score: number;
  /** Which signals matched, for debugging and future grounding. */
  reasons: string[];
}

export interface GuideRetrievalResult {
  hits: GuideRetrievalHit[];
  /** The top hit is strong and clear enough to answer with directly. */
  confident: boolean;
}

/**
 * Finds knowledge for a query in context.
 *
 * Asynchronous by contract even though the deterministic retriever is not, so
 * a full-text, vector or hybrid retriever can replace it without the service
 * or the panel changing.
 */
export interface GuideRetriever {
  retrieve(request: GuideRetrievalRequest): Promise<GuideRetrievalResult>;
}

/**
 * Turns retrieved knowledge into a response.
 *
 * The deterministic provider returns curated content as it stands. A future
 * grounded provider would compose an answer from the same sources — and must
 * still answer with a `GuideResponse` naming its `sourceIds`.
 */
export interface GuideAnswerProvider {
  answer(
    query: string,
    context: GuideContext,
    retrieval: GuideRetrievalResult,
  ): Promise<GuideResponse>;
}
