import { useMemo } from "react";

import { config, type Namespace } from "./registry";
import { message, text, type MessageKey } from "./messages";

/**
 * Configuration, for components.
 *
 * A hook rather than a direct read, for one reason that has not arrived yet:
 * when configuration comes from the database it will be fetched, cached and
 * invalidated, and every component that used this hook will keep working
 * unchanged. Reading the registry directly in a component would make that a
 * rewrite instead of a swap.
 */
export function useConfig<K extends Namespace>(namespace: K) {
  return useMemo(
    () => ({
      /** Active options, in order. What a control should offer. */
      options: config.options(namespace),
      /** Everything, including deactivated ones, for rendering history. */
      all: config.get(namespace),
      label: (id: string) => config.label(namespace, id),
      labels: config.labels(namespace),
      semanticOf: (id: string) => config.semanticOf(namespace, id),
    }),
    [namespace],
  );
}

/** Messages, for components. Same reasoning as `useConfig`. */
export function useMessages() {
  return useMemo(
    () => ({
      message: (key: MessageKey | string, values?: Record<string, string | number>) =>
        message(key, values),
      text: (key: MessageKey | string, values?: Record<string, string | number>) =>
        text(key, values),
    }),
    [],
  );
}
