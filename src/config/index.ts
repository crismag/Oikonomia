/**
 * The Oikonomia configuration platform.
 *
 * One import for everything a module needs:
 *
 * ```ts
 * import { config, notify, text, useConfig } from "@/config";
 *
 * config.options("reports.statuses");     // what is offered now
 * config.label("work.statuses", id);      // what to call one
 * config.semanticOf("goals.statuses", id) // what it means, not how it looks
 * notify.success("reports.publish.success");
 * ```
 *
 * Configuration files are the **bootstrap**, not the storage. Every consumer
 * goes through the registry, so moving these values into the database and an
 * Administration screen changes this directory and nothing else.
 */

export {
  applyOverrides,
  config,
  currentOverrides,
  get,
  label,
  labels,
  option,
  options,
  reload,
  resetOverrides,
  semanticOf,
  validateAll,
} from "./registry";
export { accessStrategies, entryStrategies, knownCapabilities } from "./registry";
export type {
  AccessStrategy,
  AudienceOptionDefinition,
  BehavioralStatusDefinition,
  EntryOptionDefinition,
  EntryStrategy,
  Namespace,
  OptionDefinition,
  SemanticState,
  StatusBehavior,
  StatusDefinition,
} from "./registry";
export type { OverrideRecord } from "./overrides";
export { message, messages, text, type MessageKey, type Severity } from "./messages";
export { ConfirmProvider, notify, useConfirm } from "./messages/handlers";
export { useConfig, useMessages } from "./use-config";
