/**
 * @vitest-environment jsdom
 *
 * `sanitizeInline` needs a DOM, so this file asks for one. It is the only
 * reason jsdom is a dependency, and the reason is a good one: this function is
 * the last thing standing between what somebody typed and what another
 * leader's browser executes, and until this file existed its DOM path had no
 * automated coverage at all.
 */
import { describe, expect, it } from "vitest";

import { inlineHtmlIsSafe, sanitizeInline } from "./meeting";

/**
 * Whether any element in this markup carries an event handler.
 *
 * Parsed rather than pattern-matched, because escaped text is safe: sanitizing
 * `<noscript>…</noscript>` yields the literal characters `&lt;b onclick=…`,
 * which renders as words and executes nothing. A regex over the string cannot
 * tell that from a live attribute.
 */
function hasEventHandler(html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  return [...template.content.querySelectorAll("*")].some((el) =>
    [...el.attributes].some((a) => a.name.toLowerCase().startsWith("on")),
  );
}

describe("sanitizing what somebody wrote", () => {
  it("keeps the inline marks a leader actually uses", () => {
    expect(sanitizeInline("<b>bold</b>")).toBe("<b>bold</b>");
    expect(sanitizeInline("<i>a</i><u>b</u><br>")).toBe("<i>a</i><u>b</u><br>");
    expect(sanitizeInline("plain words")).toBe("plain words");
  });

  it("unwraps structure but keeps the words", () => {
    expect(sanitizeInline("<div>words</div>")).toBe("words");
    expect(sanitizeInline("<h1>a</h1><p>b</p>")).toBe("ab");
  });

  /**
   * The bug this test was written for.
   *
   * Unwrapping a disallowed tag promoted its children into the parent — out of
   * the list the walk was iterating, so they were never visited. One pass over
   * `<div><b onmouseover=…>` returned the handler intact.
   */
  it("cleans the subtree of a tag it unwraps", () => {
    const out = sanitizeInline('<div class="x"><b onmouseover="alert(1)">y</b></div>');
    expect(hasEventHandler(out)).toBe(false);
    expect(out).toBe("<b>y</b>");
  });

  it("cleans arbitrarily deep nesting inside unwrapped tags", () => {
    for (const html of [
      "<span><span><b onclick=alert(1)>deep</b></span></span>",
      "<div><div><div><img src=x onerror=alert(1)></div></div></div>",
      "<table><tr><td><b onmouseenter=alert(1)>t</b></td></tr></table>",
      "<noscript><b onclick=alert(1)>n</b></noscript>",
    ]) {
      expect(hasEventHandler(sanitizeInline(html)), html).toBe(false);
    }
  });

  it("strips every attribute except a safe href", () => {
    expect(sanitizeInline('<b style="color:red" class="x">s</b>')).toBe("<b>s</b>");
    expect(sanitizeInline('<a href="javascript:alert(1)">bad</a>')).not.toContain("javascript");
    expect(sanitizeInline('<a href="https://example.org">ok</a>')).toContain(
      'href="https://example.org"',
    );
  });

  it("drops script and frame content entirely", () => {
    for (const html of [
      "<script>alert(1)</script>",
      "<svg onload=alert(1)>",
      '<iframe src="https://evil.test"></iframe>',
      '<img src=x onerror="steal()">',
    ]) {
      const out = sanitizeInline(html);
      expect(hasEventHandler(out), html).toBe(false);
      expect(out.toLowerCase(), html).not.toContain("<script");
      expect(out.toLowerCase(), html).not.toContain("<iframe");
    }
  });

  it("is idempotent, so re-sanitizing stored content never changes it", () => {
    for (const html of [
      "<b>a</b>",
      '<div class="x"><b onmouseover=alert(1)>y</b></div>',
      '<a href="https://example.org">l</a>',
      '<a href="javascript:x" onclick="y">both</a>',
      "<b>a</b><script>alert(1)</script><i>b</i>",
    ]) {
      const once = sanitizeInline(html);
      expect(sanitizeInline(once), html).toBe(once);
    }
  });

  /**
   * The two halves must agree: anything the editor produces has to pass the
   * check the server applies, or saving a legitimate note fails.
   */
  it("always produces something the server's own guard accepts", () => {
    for (const html of [
      "",
      "plain",
      "<b>bold</b>",
      "<i>it</i><u>u</u><br>",
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>",
      "<svg onload=alert(1)>",
      '<a href="https://example.org">link</a>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="mailto:a@b.org">mail</a>',
      '<a href="/people/x">rel</a>',
      '<a href="data:text/html,x">d</a>',
      '<div class="x"><b onmouseover=alert(1)>y</b></div>',
      "<b><i><u>nested</u></i></b>",
      "<form><button onclick=alert(1)>go</button></form>",
      "a &amp; b &lt;c&gt;",
    ]) {
      expect(inlineHtmlIsSafe(sanitizeInline(html)), html).toBe(true);
    }
  });
});
