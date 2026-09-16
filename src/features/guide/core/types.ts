/**
 * Guide Core types.
 *
 * Guide is a deterministic, context-aware help system: curated knowledge,
 * retrieval, walkthroughs and navigation. Nothing here knows which application
 * hosts it. Routes, modules, capabilities and destinations are opaque strings
 * the host gives meaning to.
 */

/* ------------------------------------------------------------------ context */

/**
 * Where the reader is, as the host describes it.
 *
 * Intentionally small. It is what retrieval ranks against and what visibility
 * filters on — never the application's store.
 */
export interface GuideContext {
  /** The current path, as the host routes it. */
  route: string;
  /** A coarse area of the application, e.g. "reports". */
  module?: string;
  /** A specific page within it, e.g. "report-detail". */
  page?: string;
  /** Topics the host says belong to this page, most relevant first. */
  topics?: string[];
  /** What is on screen, when the host can say so safely. */
  entity?: { type: string; id?: string };
  /** What the reader may do, in the host's own capability vocabulary. */
  capabilities: string[];
  /**
   * Conditions of this installation or session, e.g. "demo". Knowledge may be
   * hidden while one is present (`hideWhen`). Never a substitute for the
   * host's own enforcement.
   */
  flags: string[];
}

/* ---------------------------------------------------------------- knowledge */

export const knowledgeTypes = [
  "concept",
  "page",
  "procedure",
  "walkthrough",
  "permission",
  "troubleshooting",
] as const;

export type KnowledgeType = (typeof knowledgeTypes)[number];

/** Safe, structured content. Never HTML: rendering cannot execute anything. */
export type GuideInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: GuideInline[] }
  | { kind: "em"; children: GuideInline[] }
  | { kind: "code"; text: string }
  /** Another knowledge item, by id. */
  | { kind: "topic"; id: string; children: GuideInline[] }
  /** A host destination, by semantic id. Navigation only — never an action. */
  | { kind: "destination"; id: string; children: GuideInline[] };

export type GuideBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; content: GuideInline[] }
  | { kind: "list"; ordered: boolean; items: GuideInline[][] }
  | { kind: "note"; content: GuideInline[] };

export interface WalkthroughStep {
  title: string;
  body: GuideBlock[];
  /** Where this step happens, when the host can take the reader there. */
  destination?: string;
}

export interface KnowledgeItem {
  /** Stable, dotted, lower-case. Survives edits; used for links and sources. */
  id: string;
  title: string;
  type: KnowledgeType;
  /** One sentence, shown in lists and search results. */
  summary: string;
  /** Browse category, by the pack's category id. */
  category: string;
  modules: string[];
  pages: string[];
  keywords: string[];
  aliases: string[];
  /** Any one of these is enough to see the item. Empty means everyone. */
  capabilities: string[];
  /** Hidden while any of these context flags is present. */
  hideWhen: string[];
  related: string[];
  /** Destinations offered beside the content. */
  destinations: string[];
  body: GuideBlock[];
  /** Walkthroughs only. */
  steps: WalkthroughStep[];
  /** Where it came from, for validation messages and future grounding. */
  source: string;
}

/* --------------------------------------------------------------- responses */

export interface GuideSuggestion {
  id: string;
  title: string;
  type: KnowledgeType;
  summary: string;
}

export interface GuideDestinationLink {
  id: string;
  label: string;
}

/**
 * What the panel renders. Every provider — deterministic today, grounded
 * generation later — answers in this shape, and says which knowledge it used.
 */
export type GuideResponse =
  | {
      kind: "home";
      title: string;
      summary?: string;
      suggestions: GuideSuggestion[];
      walkthroughs: GuideSuggestion[];
      sourceIds: string[];
    }
  | {
      kind: "article";
      item: GuideSuggestion;
      body: GuideBlock[];
      related: GuideSuggestion[];
      destinations: GuideDestinationLink[];
      sourceIds: string[];
    }
  | {
      kind: "walkthrough";
      item: GuideSuggestion;
      steps: WalkthroughStep[];
      related: GuideSuggestion[];
      sourceIds: string[];
    }
  | {
      kind: "results";
      query: string;
      /** The best match was confident enough to answer with directly. */
      answer?: Extract<GuideResponse, { kind: "article" | "walkthrough" }>;
      results: GuideSuggestion[];
      sourceIds: string[];
    }
  | {
      kind: "fallback";
      query: string;
      suggestions: GuideSuggestion[];
      sourceIds: string[];
    }
  | {
      kind: "browse";
      categories: { id: string; title: string; items: GuideSuggestion[] }[];
      sourceIds: string[];
    };

/* ------------------------------------------------------------------ events */

/**
 * What Guide can report about its use. The host decides whether anything
 * listens; Guide sends nothing anywhere itself.
 */
export type GuideEvent =
  | { type: "guide_opened"; route: string }
  | { type: "guide_topic_opened"; id: string; route: string }
  | { type: "guide_search"; query: string; resultCount: number; route: string }
  | { type: "guide_search_no_result"; query: string; route: string }
  | { type: "guide_walkthrough_started"; id: string }
  | { type: "guide_walkthrough_completed"; id: string }
  | { type: "guide_walkthrough_abandoned"; id: string; step: number };
