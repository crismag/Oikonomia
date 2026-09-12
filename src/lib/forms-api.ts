import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { FormDefinition, FormRecord } from "@/domain/types";

/**
 * Forms' API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 */

export interface FormsData {
  definitions: FormDefinition[];
  records: FormRecord[];
}

async function withForms<T>(work: (service: Service, viewer: Viewer) => T): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createFormsRepository },
    { createFormsService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/forms-repository"),
    import("@/server/services/forms-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);
    const service = createFormsService(createFormsRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type Service = import("@/server/services/forms-service").FormsService;
type Viewer = import("@/domain/viewer").Viewer;

export const fetchForms = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withForms((s, v): FormsData => s.all(v)));

export const createFormDefinition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withForms((s, v): FormDefinition => s.createDefinition(v, data)));

export const saveFormDefinition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withForms((s, v): FormDefinition => s.saveDefinition(v, data)));

export const renameFormDefinition = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withForms((s, v): FormDefinition => s.renameDefinition(v, data)));

export const copyFormDefinition = createServerFn({ method: "POST" })
  .validator((input: { id: string; title: string }) => input)
  .handler(({ data }) =>
    withForms((s, v): FormDefinition => s.copyDefinition(v, data.id, data.title)),
  );

export const deleteFormDefinition = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withForms((s, v) => s.deleteDefinition(v, data.id)));

export const createFormRecord = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withForms((s, v): FormRecord => s.createRecord(v, data)));

export const setFormResponse = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withForms((s, v): FormRecord => s.setResponse(v, data)));

export const completeFormRecord = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withForms((s, v): FormRecord => s.completeRecord(v, data.id)));

export const reopenFormRecord = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withForms((s, v): FormRecord => s.reopenRecord(v, data.id)));
