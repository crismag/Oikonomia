import { createServerFn } from "@tanstack/react-start";

import type { PageMeta, Result } from "./api-envelope";
import type { DocumentEntityType, RegisteredDocument } from "@/domain/registry";
import type { ResourceSearchResult } from "@/domain/types";

/**
 * The document registry's API.
 *
 * Same constraints as the other slices — see
 * `docs/architecture/api-boundary.md`.
 *
 * Nothing here opens, downloads or reads a resource. Every call answers a
 * question about **registered metadata**, which is the whole of what the
 * registry holds.
 */

export interface ResourcePage {
  resources: ResourceSearchResult[];
  page: PageMeta;
}

export type FilterOptions = ReturnType<DocumentService["filterOptions"]>;

async function withDocuments<T>(
  work: (service: DocumentService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createDocumentRepository },
    { createBinderContentRepository },
    { createDocumentService },
    { createOrganizationRepository },
    { createLeadershipReportRepository },
    { createWorkRepository },
    { createFormsRepository },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/document-repository"),
    import("@/server/repositories/binder-content-repository"),
    import("@/server/services/document-service"),
    import("@/server/repositories/organization-repository"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/repositories/work-repository"),
    import("@/server/repositories/forms-repository"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createDocumentService(
      createDocumentRepository(db),
      createBinderContentRepository(db),
      {
        organization: createOrganizationRepository(db),
        reports: createLeadershipReportRepository(db),
        work: createWorkRepository(db),
        forms: createFormsRepository(db),
      },
    );
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type DocumentService = import("@/server/services/document-service").DocumentService;
type Viewer = import("@/domain/viewer").Viewer;

export const searchDocuments = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v): ResourcePage => s.search(v, data)));

/** The filter choices, counted over what this viewer may already discover. */
export const fetchDocumentFilters = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v) => s.filterOptions(v, data)));

/** The documents filed against one binder record. */
export const fetchFiledDocuments = createServerFn({ method: "GET" })
  .validator((input: { entityType: DocumentEntityType; entityId: string }) => input)
  .handler(({ data }) =>
    withDocuments((s, v) => s.filedAgainst(v, data.entityType, data.entityId)),
  );

export const fetchDocument = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withDocuments((s, v): RegisteredDocument => s.get(v, data.id)));

export const registerDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v) => s.register(v, data)));

export const updateDocument = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) => withDocuments((s, v) => s.update(v, data.id, data.patch)));

export const fileDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v) => s.associate(v, data)));

export const unfileDocument = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withDocuments((s, v) => s.removeAssociation(v, data.id)));

/* ------------------------------------------- binder-native documents */

/**
 * Start a document the binder itself keeps.
 *
 * Unlike registering, this creates the resource as well as the record of it —
 * the binder is where this one lives.
 */
export const createBinderDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v) => s.createBinder(v, data)));

export const fetchBinderDocument = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withDocuments((s, v) => s.binder(v, data.id)));

export const saveBinderDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withDocuments((s, v) => s.saveBinder(v, data)));

export const removeDocument = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withDocuments((s, v) => s.remove(v, data.id)));
