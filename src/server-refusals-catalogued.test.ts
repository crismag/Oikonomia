import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { messages, text } from "@/config/messages";

/**
 * A refusal is said once, in the message catalogue.
 *
 * The server's refusals used to be written at each throw site. The same
 * situation — somebody else changed this while you were writing — was said four
 * ways, and nothing but reading every service would show it. With the sentence
 * behind a key (`refusal.<area>.<reason>` in `src/config/messages`), the
 * catalogue is the one place to read, reword, or later translate what a leader
 * is told when the answer is no.
 *
 * This scans every call that raises a refusal and fails on a sentence written
 * inline. What remains allowed, and why:
 *
 * - `ApiError.notFound("That report")` — a noun phrase, not a sentence. The
 *   helper fills it into `refusal.common.notFound` ("{what} could not be
 *   found."), so the sentence itself is still catalogued.
 * - `new ApiError("internal", …)` — the first argument is an error code.
 * - Anything not shaped like a sentence (`demand(viewer, report, "edit", …)` names a
 *   capability, not a message).
 *
 * > Deleting this test does not make the rule go away; it makes it unenforced.
 * > If a legitimate exception appears, add it to `ALLOWED` with the reason.
 */

const ROOT = new URL("./", import.meta.url).pathname;

/** Where refusals are raised. */
const RUNTIME = ["server", "lib"];

const ALLOWED: string[] = [];

/** The calls whose string arguments reach a person as a refusal. */
const REFUSAL_CALL = /(?:ApiError\.(\w+)|new ApiError|\bdemand|\brequireKnownPeople)\(/g;
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Every inline sentence handed to a refusal in `source`, with its line. */
function inlineRefusals(source: string): { line: number; sentence: string }[] {
  const found: { line: number; sentence: string }[] = [];
  for (const call of source.matchAll(REFUSAL_CALL)) {
    const start = call.index + call[0].length;
    let end = start;
    for (let depth = 1; depth > 0 && end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")") depth--;
    }
    const args = source.slice(start, end - 1);
    for (const literal of args.matchAll(LITERAL)) {
      const value = literal[1] ?? literal[2] ?? literal[3] ?? "";
      /* Identifiers, error codes and separators: not a sentence a person reads. */
      if (!/^[A-Z…].*\s/.test(value)) continue;
      /* A noun phrase for the catalogued "{what} could not be found." */
      if (call[1] === "notFound" && !/[.?!]$/.test(value)) continue;
      found.push({ line: source.slice(0, call.index).split("\n").length, sentence: value });
    }
  }
  return found;
}

const runtimeFiles = RUNTIME.flatMap((dir) => walk(join(ROOT, dir)))
  .map((file) => relative(ROOT, file))
  .filter((file) => !ALLOWED.includes(file));

describe("server refusals come from the message catalogue", () => {
  it("has files to check", () => {
    /* A path change that emptied this list would make the next test pass on
       nothing. */
    expect(
      runtimeFiles.filter((file) => file.startsWith("server/services/")).length,
    ).toBeGreaterThan(10);
  });

  it("recognises an inline sentence when it sees one", () => {
    expect(inlineRefusals(`throw ApiError.forbidden("This is not yours.");`)).toHaveLength(1);
    expect(inlineRefusals("throw ApiError.conflict(`Cannot be ${action} now.`);")).toHaveLength(1);
    expect(
      inlineRefusals(`throw ApiError.validation({\n  name: "Say who came.",\n});`),
    ).toHaveLength(1);
    expect(inlineRefusals(`throw ApiError.notFound("That report");`)).toHaveLength(0);
    expect(
      inlineRefusals(`throw ApiError.forbidden(text("refusal.lifegroup.notYoursToChange"));`),
    ).toHaveLength(0);
  });

  it.each(runtimeFiles)("%s writes no refusal sentence inline", (file) => {
    const offenders = inlineRefusals(readFileSync(join(ROOT, file), "utf8")).map(
      ({ line, sentence }) => `${file}:${line} "${sentence}"`,
    );
    expect(offenders).toEqual([]);
  });

  it("names every refusal key by area and reason", () => {
    for (const key of Object.keys(messages).filter((key) => key.startsWith("refusal."))) {
      expect(key).toMatch(/^refusal\.[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
    }
  });

  it("fills the value a refusal quotes", () => {
    expect(text("refusal.common.notFound", { what: "That report" })).toBe(
      "That report could not be found.",
    );
    expect(text("refusal.auth.inviteTooMany", { max: 50 })).toBe(
      "Invite at most 50 people at a time.",
    );
  });
});
