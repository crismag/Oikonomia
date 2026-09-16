import { describe, expect, it } from "vitest";

import {
  documentHref,
  mayChangeDocument,
  mayUnfile,
  ministryIdOf,
  openableUrl,
  placeHref,
  placeName,
} from "./document-record";
import type { Ministry } from "./types";

const music: Ministry = {
  id: "min-music",
  name: "Music Ministry",
  purpose: "",
  campusId: "campus-1",
  leadId: "lead",
  teamIds: ["member"],
  sharedWithIds: ["shared"],
};

describe("who may change a document's record", () => {
  const document = { registeredById: "registrant" };

  it("is the people who work in its ministry", () => {
    expect(mayChangeDocument(document, music, "lead")).toBe(true);
    expect(mayChangeDocument(document, music, "member")).toBe(true);
  });

  /* Being shared with a ministry is not membership — not even for whoever
     registered the document there. */
  it("is not someone it is only shared with, nor its registrant outside the ministry", () => {
    expect(mayChangeDocument(document, music, "shared")).toBe(false);
    expect(mayChangeDocument(document, music, "registrant")).toBe(false);
    expect(mayChangeDocument(document, music, "stranger")).toBe(false);
  });

  it("is whoever registered it, when it is filed in no ministry", () => {
    expect(mayChangeDocument(document, undefined, "registrant")).toBe(true);
    expect(mayChangeDocument(document, undefined, "lead")).toBe(false);
  });

  it("belongs to the first ministry it is filed in", () => {
    expect(
      ministryIdOf({
        associations: [
          {
            id: "a",
            entityType: "gathering",
            entityId: "g",
            relationship: "filed-in",
            createdById: "x",
            createdAt: "",
          },
          {
            id: "b",
            entityType: "ministry",
            entityId: "min-music",
            relationship: "filed-in",
            createdById: "x",
            createdAt: "",
          },
        ],
      }),
    ).toBe("min-music");
    expect(ministryIdOf({ associations: [] })).toBeUndefined();
  });
});

describe("unfiling", () => {
  it("is offered only to someone who may change the record", () => {
    expect(mayUnfile({ origin: "drive" }, { entityType: "ministry" }, true)).toBe(true);
    expect(mayUnfile({ origin: "drive" }, { entityType: "ministry" }, false)).toBe(false);
  });

  it("never takes a binder-kept document out of its ministry", () => {
    expect(mayUnfile({ origin: "binder" }, { entityType: "ministry" }, true)).toBe(false);
    expect(mayUnfile({ origin: "binder" }, { entityType: "gathering" }, true)).toBe(true);
  });
});

describe("opening an address", () => {
  it.each(["https://docs.google.com/document/d/abc/edit", "http://example.org/plan"])(
    "opens %s",
    (url) => expect(openableUrl(url)).toBe(url),
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.org/file",
    "mailto:someone@example.org",
    "not an address",
    "",
    undefined,
  ])("refuses %s", (url) => expect(openableUrl(url)).toBeUndefined());
});

describe("links", () => {
  it("leads every document to its own page", () => {
    expect(documentHref("doc-1")).toEqual({
      to: "/documents/$documentId",
      params: { documentId: "doc-1" },
    });
  });

  it("links a place to the record that owns it", () => {
    expect(placeHref({ entityType: "ministry", entityId: "min-music" })).toEqual({
      to: "/ministries/min-music",
      search: { view: "documents" },
    });
    expect(placeHref({ entityType: "meeting-note", entityId: "note-1" })).toEqual({
      to: "/meeting-notes",
      search: { note: "note-1" },
    });
    expect(placeHref({ entityType: "gathering", entityId: "g-1" })).toEqual({
      to: "/lifegroups/g-1",
    });
  });

  it("has no link for an area-wide filing or a record without a page", () => {
    expect(placeHref({ entityType: "ministry", entityId: "" })).toBeUndefined();
    expect(placeHref({ entityType: "event", entityId: "e-1" })).toBeUndefined();
  });

  it("names a place by its record, or by its section when it names none", () => {
    expect(placeName({ section: "ministry", label: "Music Ministry" })).toBe("Music Ministry");
    expect(placeName({ section: "lifegroup" })).toBe("LifeGroup");
  });
});
