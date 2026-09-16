/**
 * Guide — a pluggable, deterministic help assistant.
 *
 * Guide Core knows no host application. A host mounts `GuideProvider` with a
 * `GuideHostAdapter` and a knowledge loader, places `GuidePanel` beside its
 * content and `GuideToggle` in its chrome. See development/guide/.
 */
export type {
  GuideAnswerProvider,
  GuideHostAdapter,
  GuideKnowledgeProvider,
  GuideRetrievalHit,
  GuideRetrievalRequest,
  GuideRetrievalResult,
  GuideRetriever,
} from "./core/contracts";
export type {
  GuideBlock,
  GuideContext,
  GuideEvent,
  GuideInline,
  GuideResponse,
  GuideSuggestion,
  KnowledgeItem,
  KnowledgeType,
  WalkthroughStep,
} from "./core/types";
export { createGuideService, type GuideService } from "./core/service";
export {
  buildCorpus,
  type CorpusResult,
  type KnowledgeSource,
  type PackRules,
} from "./knowledge/validate";
export { createMemoryKnowledgeProvider } from "./knowledge/repository";
export { createDeterministicRetriever } from "./retrieval/deterministic";
export { GuideProvider, useGuide, useOptionalGuide } from "./ui/guide-provider";
export { GuideHint, GuidePanel, GuideToggle } from "./ui/guide-panel";
