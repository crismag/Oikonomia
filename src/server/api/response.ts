import type { ApiErrorBody, ErrorCode, PageMeta } from "@/lib/api-envelope";

/**
 * Building an API response.
 *
 * The envelope's *types* live in `@/lib/api-envelope`, because the browser has
 * to read what this writes and TanStack Start denies the client any import
 * from `src/server/`. This module is the server half: the error class, the
 * status mapping, and the `Response` builders.
 *
 * A caller can tell success from failure without knowing which endpoint it
 * called, and a failure always says *which field* was wrong rather than only
 * that something was.
 *
 * ```
 * { "data": { ... } }                                   // one record
 * { "data": [ ... ], "page": { ... } }                  // a page of records
 * { "error": { "code": "validation", "message": "...",  // a refusal
 *              "fields": { "title": "Title is required." } } }
 * ```
 *
 * Errors are **written for a person to read**, because the leader is the one
 * who sees them. "Title is required." not "ValidationError: body.title".
 */

export type { ApiErrorBody, ApiResponse, ErrorCode, PageMeta, Result } from "@/lib/api-envelope";

const STATUS: Record<ErrorCode, number> = {
  validation: 422,
  "not-found": 404,
  forbidden: 403,
  unauthenticated: 401,
  conflict: 409,
  "disabled-by-installation": 403,
  internal: 500,
};

/**
 * A refusal the API knows how to explain.
 *
 * Thrown by services and repositories, caught once at the request boundary by
 * `toResponse`. Anything else that escapes becomes a 500 with a generic
 * message, because an unplanned exception's text is for the log, not the
 * leader — see §20's rule against showing raw failures.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.fields = fields;
  }

  get status(): number {
    return STATUS[this.code];
  }

  body(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }

  static validation(fields: Record<string, string>, message = "Some details need fixing.") {
    return new ApiError("validation", message, fields);
  }

  /**
   * Not found — used **also** when a record exists but the viewer may not know
   * that it does.
   *
   * Telling an unauthorized caller "forbidden" tells them the record exists,
   * which for a confidential leadership report is most of the secret. §35:
   * default to conservative behaviour. Reserve `forbidden` for the case where
   * the viewer can already see that the record exists and is only being
   * refused an action on it.
   */
  static notFound(what = "That record") {
    return new ApiError("not-found", `${what} could not be found.`);
  }

  static forbidden(message = "You do not have permission to do that.") {
    return new ApiError("forbidden", message);
  }

  static conflict(message: string) {
    return new ApiError("conflict", message);
  }

  /**
   * Nobody is signed in.
   *
   * Distinct from `forbidden`, which means "we know who you are and the answer
   * is no". This one means the question cannot be asked yet, and the browser
   * responds by sending the person to sign in rather than by showing them an
   * error about permissions they might well have.
   */
  static unauthenticated(message = "Nobody is signed in.") {
    return new ApiError("unauthenticated", message);
  }

  /**
   * Not available in this installation, whoever is asking.
   *
   * Distinct from `forbidden`, which is about the person: an administrator
   * who could do this elsewhere cannot do it here, and "you do not have
   * permission" would send them looking for a permission that does not exist.
   */
  static disabledByInstallation(message = "This action is disabled in this installation.") {
    return new ApiError("disabled-by-installation", message);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function ok<T>(data: T, status = 200): Response {
  return json({ data }, status);
}

export function okPage<T>(data: T[], page: PageMeta): Response {
  return json({ data, page }, 200);
}

export function created<T>(data: T): Response {
  return ok(data, 201);
}

/** 204: the delete succeeded and there is nothing to say about it. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function fail(error: ApiError): Response {
  return json({ error: error.body() }, error.status);
}

/**
 * Run a handler and turn whatever comes out into a response.
 *
 * The single place an exception becomes an HTTP status. An `ApiError` says
 * what it is; anything else is logged in full and reported as a generic 500,
 * so a stack trace never reaches a leader's screen.
 */
export async function toResponse(handler: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) return fail(error);
    console.error(error);
    return fail(new ApiError("internal", "Something went wrong saving that. Please try again."));
  }
}
