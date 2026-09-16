import { text } from "@/config/messages";
import { z } from "zod";

import { PAGE_SIZE } from "@/domain/pagination";
import { ApiError } from "./response";

/**
 * Validation at the API boundary.
 *
 * §21: validate at both the UX boundary and the API boundary, and the backend
 * is authoritative. The frontend's validation exists to be helpful; this one
 * exists to be true. A screen that forgets a check, a request that never came
 * from a screen at all, and a future client all arrive here.
 *
 * Zod is already a dependency, so schemas live beside the domain that owns
 * them and this module only supplies the glue: turn a parse failure into the
 * readable, field-addressed error that `response.ts` promises.
 */

/**
 * Parse, or refuse in the caller's language.
 *
 * Zod's own messages are developer-facing ("Expected string, received null").
 * Every schema in this codebase supplies its own message, and this turns the
 * issue list into `{ field: message }` — the shape a form can attach to inputs.
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_";
    /* First message wins: a leader fixes one thing at a time, and the first
       failure on a field is the one that explains the rest. */
    if (!(path in fields)) fields[path] = issue.message;
  }

  throw ApiError.validation(fields);
}

/** Parse a JSON request body. A malformed body is a validation failure, not a crash. */
export async function parseBody<T>(schema: z.ZodType<T>, request: Request): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw ApiError.validation({ _: text("refusal.request.invalidJson") });
  }
  return parse(schema, payload);
}

/** Parse a URL's query string. Repeated keys keep their last value. */
export function parseQuery<T>(schema: z.ZodType<T>, url: URL): T {
  return parse(schema, Object.fromEntries(url.searchParams));
}

/* ------------------------------------------------------------ list queries */

/** The largest page a caller may ask for, so one request cannot read the table. */
export const MAX_PAGE_SIZE = 100;

/**
 * Text that is absent when it is blank.
 *
 * `?search=` and `?search=%20%20` are how a cleared search box reaches the
 * server. Refusing them would turn clearing a filter into an error message;
 * searching for the empty string would return everything and call it a match.
 * Both are wrong, so a blank becomes no filter at all.
 */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const positiveInt = (label: string) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`);

/**
 * The query parameters every collection endpoint understands.
 *
 * §5 names these, and §19 requires that paging survive a filter change. The
 * frontend already writes them into the URL (`src/domain/pagination.ts`), so
 * one vocabulary spans the address bar, the fetch and the SQL.
 *
 * A domain extends this with its own filters rather than redefining it:
 *
 * ```ts
 * const eventQuery = listQuery.extend({ ministryId: z.string().optional() });
 * ```
 */
export const listQuery = z.object({
  page: positiveInt("Page").default(1),
  pageSize: positiveInt("Page size")
    .max(MAX_PAGE_SIZE, `Page size cannot be more than ${MAX_PAGE_SIZE}.`)
    .default(PAGE_SIZE),
  search: optionalText,
  sort: optionalText,
});

export type ListQuery = z.infer<typeof listQuery>;

/**
 * Build a sort clause from a caller-supplied name.
 *
 * The allowed sorts are a table the domain owns, never a column name pasted
 * into SQL. An unknown sort is refused rather than silently ignored: a list
 * that quietly ignores `?sort=oldest` looks broken to the person who asked.
 */
export function sortClause(sort: string | undefined, allowed: Record<string, string>): string {
  const names = Object.keys(allowed);
  const first = names[0];
  if (!first) throw new Error("sortClause needs at least one allowed sort.");
  if (!sort) return allowed[first]!;

  const clause = allowed[sort];
  if (!clause) {
    throw ApiError.validation({
      sort: text("refusal.request.sortUnknown", { names: names.join(", ") }),
    });
  }
  return clause;
}

/** ISO `yyyy-MM-dd`, the only date shape the domain stores. */
export const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date.`)
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} is not a real date.`);

/** 24-hour `HH:mm`. */
export const clockTime = (label: string) =>
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} must be a time like 19:30.`);
