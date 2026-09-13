import { describe, expect, it } from "vitest";

import { createEntry } from "./calendar-contract";
import { registerDocument, updateDocument } from "./registry-contract";
import { isWebAddress, webAddress } from "./web-address";

/**
 * Stored links are opened by other people.
 *
 * Every scheme below parses as a URL, which is all `z.string().url()` asked.
 * Only the two a web address needs may be stored.
 */

const REFUSED = [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "not a url",
  "",
];

describe("a web address", () => {
  it.each(["https://drive.google.com/file/d/abc", "http://intranet.example.org/a?b=c#d"])(
    "accepts %s",
    (value) => {
      expect(isWebAddress(value)).toBe(true);
    },
  );

  it.each(REFUSED)("refuses %j", (value) => {
    expect(webAddress("no").safeParse(value).success).toBe(false);
  });

  it("stores the address trimmed, as before", () => {
    expect(webAddress("no").parse("  https://example.org/x  ")).toBe("https://example.org/x");
  });
});

describe("where addresses are stored", () => {
  const document = { title: "Rota", url: "" };
  const entry = { title: "Prayer", date: "2026-09-14", category: "other", meetingUrl: "" };

  it.each(REFUSED.filter(Boolean))("a document refuses %j", (url) => {
    expect(registerDocument.safeParse({ ...document, url }).success).toBe(false);
    expect(updateDocument.safeParse({ url }).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>"])(
    "a calendar entry's meeting link refuses %j",
    (meetingUrl) => {
      expect(createEntry.safeParse({ ...entry, meetingUrl }).success).toBe(false);
    },
  );

  it("still accepts ordinary links in both", () => {
    expect(
      registerDocument.safeParse({ ...document, url: "https://example.org/rota" }).success,
    ).toBe(true);
    expect(
      createEntry.safeParse({ ...entry, meetingUrl: "https://meet.example.org/abc" }).success,
    ).toBe(true);
  });
});
