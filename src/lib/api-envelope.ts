/**
 * The shape of an answer, shared by both sides.
 *
 * These types live outside `src/server/` deliberately: TanStack Start denies
 * the client any import from that directory, by path and regardless of what
 * the file contains. The envelope has to be describable on both sides — the
 * server builds it, the browser reads it — so the *types* live here and the
 * server's implementation (`server/api/response.ts`) builds on them.
 *
 * ```jsonc
 * { "data": { … } }                                  // one record
 * { "data": [ … ], "page": { … } }                   // a page of records
 * { "error": { "code": "validation",                 // a refusal
 *              "message": "Some details need fixing.",
 *              "fields": { "title": "Give it a title." } } }
 * ```
 */

export type ErrorCode =
  /** The request was understood and is wrong. The fields say how. */
  | "validation"
  /** No such record — or none this viewer may know exists. */
  | "not-found"
  /** The record exists, the viewer may know that, and may not do this. */
  | "forbidden"
  /** The request conflicts with the record's current state. */
  | "conflict"
  /** Nobody is signed in, or the person signed in no longer exists. */
  | "unauthenticated"
  /** Something failed that the caller could not have prevented. */
  | "internal";

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** Field path → readable message. Present for `validation`. */
  fields?: Record<string, string>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

/** What a server function returns. Exactly one of the two keys is present. */
export type Result<T> = { data: T } | { error: ApiErrorBody };

export type ApiResponse<T> = { data: T; page?: PageMeta } | { error: ApiErrorBody };
