import type { ApiErrorBody, Result } from "./api-envelope";

/**
 * Unwrapping the envelope, once.
 *
 * The server returns `{ data }` or `{ error }` so that field-level messages
 * survive the RPC boundary (`calendar-api.ts`). Every caller would
 * otherwise repeat the same three lines, and the one that forgot would treat a
 * refusal as a success.
 */

/**
 * A refusal the UI can act on.
 *
 * Carries `fields` so a form can attach messages to the inputs that caused
 * them, rather than showing one sentence above everything.
 */
export class CalendarError extends Error {
  readonly code: ApiErrorBody["code"];
  readonly fields: Record<string, string> | undefined;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = "CalendarError";
    this.code = body.code;
    this.fields = body.fields;
  }
}

export function unwrap<T>(result: Result<T>): T {
  if ("error" in result) throw new CalendarError(result.error);
  return result.data;
}

/**
 * What to show a leader when something failed.
 *
 * An `ApiError` was written for them and is shown as-is. Anything else — a
 * dropped connection, a server that never answered — gets a sentence that says
 * what happened without pretending to know why.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof CalendarError) return error.message;
  return "The calendar could not be reached. Check your connection and try again.";
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof CalendarError ? (error.fields ?? {}) : {};
}

/**
 * A request that never answers is a failure, not a wait.
 *
 * Nothing below this line times out on its own: an unreachable server leaves
 * the fetch pending indefinitely, and the screen above it spins forever. §20
 * requires a screen to be able to say a thing went wrong; it can only do that
 * if something eventually decides one did.
 *
 * Six seconds, because this is a local database behind a local server — a
 * request that slow has failed, whatever it is still doing.
 */
export const REQUEST_TIMEOUT_MS = 6000;

export async function withTimeout<T>(work: Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`The calendar did not answer within ${ms}ms.`)), ms);
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
