import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * An override, on the wire.
 *
 * `value` is deliberately a closed union rather than `unknown`: what an
 * administrator may store is a scalar setting or a patch of an option's
 * editable fields, and nothing else. Typing it loosely here would let anything
 * that reached the endpoint be written into configuration.
 */
export interface WireOverride {
  namespace: string;
  optionId?: string;
  field?: string;
  value: string | number | boolean | { [key: string]: string | number | boolean };
}

/**
 * Configuration, over the wire.
 *
 * Two different questions, deliberately separate endpoints:
 *
 * - **`fetchConfiguration`** — what an administrator has changed. Everybody
 *   asks this, because every page renders labels; it carries no secrets and
 *   nothing that is not already on screen.
 * - **`fetchConfigurationAdmin`** and the writes — the management surface,
 *   refused to anybody who is not an administrator, in the service.
 */

export type ConfigurationView = import("@/server/services/configuration-service").ConfigurationView;
export type ConfigurationChange =
  import("@/server/repositories/configuration-repository").ConfigurationChange;

type Service = import("@/server/services/configuration-service").ConfigurationService;
type Viewer = import("@/domain/viewer").Viewer;

async function parts() {
  const [
    { ApiError },
    { getDatabase },
    { refreshConfiguration },
    { createConfigurationRepository },
    { createConfigurationService },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/configuration-repository"),
    import("@/server/services/configuration-service"),
  ]);

  const db = getDatabase();
  /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
  refreshConfiguration(db);
  const service = createConfigurationService(createConfigurationRepository(db));
  return { ApiError, db, service };
}

async function withConfiguration<T>(
  work: (service: Service, viewer: Viewer) => T,
): Promise<Result<T>> {
  const { ApiError, db, service } = await parts();
  const [{ requireCurrentUser }, { getRequest }] = await Promise.all([
    import("@/server/auth/require-user"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved. Please try again." } };
  }
}

/**
 * The overrides every page needs in order to render labels.
 *
 * Deliberately open to anybody signed in: these are the words already on
 * screen. It is also the one call that must not fail hard — a configuration
 * fetch that errors would take down every page, so a failure returns an empty
 * override set and the application runs on what shipped.
 */
export const fetchConfiguration = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<Result<WireOverride[]>> => {
    try {
      const { db } = await parts();
      const { createConfigurationRepository } =
        await import("@/server/repositories/configuration-repository");
      return { data: createConfigurationRepository(db).all() as WireOverride[] };
    } catch (error) {
      console.error(error);
      return { data: [] };
    }
  });

export const fetchConfigurationAdmin = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withConfiguration((service, viewer) => service.all(viewer)));

/** Add a value — refused for every vocabulary that is part of the product. */
export const addConfigurationOption = createServerFn({ method: "POST" })
  .validator(
    (input: {
      namespace: string;
      label: string;
      description?: string;
      attentionTrigger?: boolean;
      accessStrategy?: string;
      entryStrategy?: string;
      capabilities?: string[];
      behaviors?: {
        editable: boolean;
        final: boolean;
        current: boolean;
        visibleToAudience: boolean;
      };
    }) => input,
  )
  .handler(({ data }) => withConfiguration((service, viewer) => service.addOption(viewer, data)));

export const setConfigurationOption = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withConfiguration((service, viewer) => service.setOption(viewer, data)));

export const setConfigurationValue = createServerFn({ method: "POST" })
  .validator(
    (input: { namespace: string; field: string; value: string | number | boolean }) => input,
  )
  .handler(({ data }) => withConfiguration((service, viewer) => service.setValue(viewer, data)));

export const resetConfiguration = createServerFn({ method: "POST" })
  .validator((input: { namespace: string; optionId?: string; field?: string }) => input)
  .handler(({ data }) =>
    withConfiguration((service, viewer) => {
      service.reset(viewer, data.namespace, data.optionId, data.field);
      return { reset: true };
    }),
  );

export const fetchConfigurationHistory = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withConfiguration((service, viewer) => service.history(viewer)));
