import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiError, fail, ok, okPage, toResponse } from "./response";
import { windowFor } from "./pagination";
import { MAX_PAGE_SIZE, listQuery, parse, parseBody, parseQuery, sortClause } from "./validation";

/**
 * The API boundary.
 *
 * Three promises are tested here, because breaking any of them is invisible
 * until a leader sees the result: a refusal says which field was wrong in
 * language a person can read; an unplanned failure never shows its internals;
 * and a page number that no longer exists lands somewhere real.
 */

const listOf = (query: Record<string, string>) =>
  parseQuery(listQuery, new URL(`http://x/api/things?${new URLSearchParams(query)}`));

describe("refusals", () => {
  it("names the field that was wrong", () => {
    const schema = z.object({ title: z.string().min(1, "Title is required.") });
    try {
      parse(schema, { title: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fields).toEqual({ title: "Title is required." });
    }
  });

  it("writes messages for a person, not for a developer", () => {
    const schema = z.object({ startDate: z.string({ message: "A start date is required." }) });
    try {
      parse(schema, {});
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).fields?.["startDate"]).toBe("A start date is required.");
    }
  });

  it("keeps only the first message per field, so a form shows one fix at a time", () => {
    const schema = z.object({
      title: z.string().min(3, "Title is too short.").max(4, "Title is too long."),
    });
    try {
      parse(schema, { title: "x" });
      expect.unreachable();
    } catch (error) {
      expect(Object.keys((error as ApiError).fields ?? {})).toEqual(["title"]);
    }
  });

  it("treats a malformed body as a refusal rather than a crash", async () => {
    const request = new Request("http://x", { method: "POST", body: "{not json" });
    await expect(parseBody(z.object({}), request)).rejects.toBeInstanceOf(ApiError);
  });

  it("maps each code to the status a client expects", () => {
    expect(ApiError.validation({ a: "b" }).status).toBe(422);
    expect(ApiError.notFound().status).toBe(404);
    expect(ApiError.forbidden().status).toBe(403);
    expect(ApiError.conflict("x").status).toBe(409);
    expect(new ApiError("internal", "x").status).toBe(500);
  });

  /**
   * The §35 rule in one assertion: an unauthorized caller must not learn that
   * the record exists, so the withheld case is a 404 and not a 403.
   */
  it("hides existence behind not-found rather than forbidden", () => {
    expect(ApiError.notFound("That report").code).toBe("not-found");
    expect(ApiError.notFound().message).not.toMatch(/permission|forbidden/i);
  });
});

describe("what escapes to the caller", () => {
  it("returns an ApiError's own message", async () => {
    const response = await toResponse(() => {
      throw ApiError.conflict("That gathering has already been reported.");
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "conflict", message: "That gathering has already been reported." },
    });
  });

  /** A stack trace is for the log. The leader gets a sentence. */
  it("never leaks an unplanned exception's text", async () => {
    const response = await toResponse(() => {
      throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: event.id");
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(500);
    expect(body.error.message).not.toMatch(/SQLITE|constraint|event\.id/);
  });

  it("puts a single record under data", async () => {
    await expect(ok({ id: "ev-1" }).json()).resolves.toEqual({ data: { id: "ev-1" } });
  });

  it("puts a page's records under data and its arithmetic under page", async () => {
    const page = { page: 2, pageSize: 25, pageCount: 4, total: 90 };
    await expect(okPage([{ id: "ev-1" }], page).json()).resolves.toEqual({
      data: [{ id: "ev-1" }],
      page,
    });
  });

  it("omits an empty fields object rather than sending one", async () => {
    const body = (await fail(ApiError.notFound()).json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("fields");
  });
});

describe("list queries", () => {
  it("defaults to the first page at the shared page size", () => {
    expect(listOf({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("reads page and pageSize from the query string", () => {
    expect(listOf({ page: "3", pageSize: "10" })).toMatchObject({ page: 3, pageSize: 10 });
  });

  it("refuses a page size that would read the whole table", () => {
    expect(() => listOf({ pageSize: String(MAX_PAGE_SIZE + 1) })).toThrow(ApiError);
  });

  it("refuses a page that is not a whole number", () => {
    expect(() => listOf({ page: "1.5" })).toThrow(ApiError);
    expect(() => listOf({ page: "one" })).toThrow(ApiError);
    expect(() => listOf({ page: "0" })).toThrow(ApiError);
  });

  it("drops an empty search rather than searching for nothing", () => {
    expect(listOf({ search: "   " }).search).toBeUndefined();
  });
});

describe("sorting", () => {
  const allowed = { newest: "date DESC", title: "title COLLATE NOCASE ASC" };

  it("falls back to the first allowed sort", () => {
    expect(sortClause(undefined, allowed)).toBe("date DESC");
  });

  it("maps a name to its clause", () => {
    expect(sortClause("title", allowed)).toBe("title COLLATE NOCASE ASC");
  });

  /* A column name from the caller must never reach the SQL. */
  it("refuses a sort it does not know, and says which are allowed", () => {
    try {
      sortClause("id; DROP TABLE event", allowed);
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).fields?.["sort"]).toContain("newest, title");
    }
  });
});

describe("the page a query should read", () => {
  const query = { page: 1, pageSize: 25 };

  it("reads the first 25 rows for page 1", () => {
    const w = windowFor(query, 90);
    expect(w).toMatchObject({ limit: 25, offset: 0 });
    expect(w.meta).toEqual({ page: 1, pageSize: 25, pageCount: 4, total: 90 });
  });

  it("offsets by whole pages", () => {
    expect(windowFor({ ...query, page: 3 }, 90).offset).toBe(50);
  });

  /**
   * The stranding case again, this time in SQL: narrowing a filter while on
   * page 6 must return the last real page rather than an empty result set.
   */
  it("clamps a page past the end instead of returning nothing", () => {
    const w = windowFor({ ...query, page: 6 }, 40);
    expect(w.meta.page).toBe(2);
    expect(w.offset).toBe(25);
  });

  it("reports one page of nothing for an empty result set", () => {
    const w = windowFor(query, 0);
    expect(w.meta).toEqual({ page: 1, pageSize: 25, pageCount: 1, total: 0 });
    expect(w.offset).toBe(0);
  });
});
