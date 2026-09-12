import { describe, expect, it } from "vitest";

import {
  documentTypeLabel,
  documentsOwnedBy,
  isBinderNative,
  originLabel,
  originNote,
  ownedBy,
  pinnedFirst,
  searchDocuments,
  usedTypes,
} from "./documents";
import { binderDocuments } from "@/test/fixtures";
import type { BinderDocument } from "./types";

/**
 * The shared binder document model.
 *
 * One model, many areas. These cases guard the two things that make it worth
 * sharing: a document belongs to exactly one area and never drifts between
 * them, and a document is not a file whatever section is showing it.
 */

const doc = (over: Partial<BinderDocument> = {}): BinderDocument => ({
  id: "d1",
  title: "Community Outreach Planning",
  owner: { kind: "reach-out" },
  preparedById: "p-maria",
  type: "plan",
  origin: "binder",
  updatedAt: "2026-09-07",
  ...over,
});

const ministry = (ministryId: string) => ({ kind: "ministry" as const, ministryId });

describe("ownership", () => {
  it("matches a section-owned document", () => {
    expect(ownedBy(doc(), { kind: "reach-out" })).toBe(true);
  });

  it("matches a ministry-owned document by ministry", () => {
    const d = doc({ owner: ministry("min-music") });
    expect(ownedBy(d, ministry("min-music"))).toBe(true);
    expect(ownedBy(d, ministry("min-victuals"))).toBe(false);
  });

  it("never mixes a section's documents with a ministry's", () => {
    const d = doc({ owner: ministry("min-music") });
    expect(ownedBy(d, { kind: "reach-out" })).toBe(false);
    expect(ownedBy(doc(), ministry("min-music"))).toBe(false);
  });

  it("returns one area's documents, newest first", () => {
    const list = [
      doc({ id: "old", updatedAt: "2026-01-01" }),
      doc({ id: "new", updatedAt: "2026-09-09" }),
      doc({ id: "elsewhere", owner: ministry("min-music") }),
    ];
    expect(documentsOwnedBy(list, { kind: "reach-out" }).map((d) => d.id)).toEqual(["new", "old"]);
  });

  it("floats pinned documents to the top", () => {
    const list = [doc({ id: "plain" }), doc({ id: "pinned", pinned: true })];
    expect(pinnedFirst(list)[0]?.id).toBe("pinned");
  });
});

describe("a document is not a file", () => {
  it("treats only binder-native content as editable here", () => {
    expect(isBinderNative("binder")).toBe(true);
    expect(isBinderNative("drive")).toBe(false);
    expect(isBinderNative("file")).toBe(false);
    expect(isBinderNative("link")).toBe(false);
  });

  it("describes each origin in plain language, not the enum", () => {
    expect(originLabel.binder).toBe("In the binder");
    expect(originLabel.file).toBe("Uploaded file");
    expect(originLabel.drive).toBe("Google Drive");
    expect(originLabel.link).toBe("Link");
  });

  it("stays quiet when the origin would only repeat the type", () => {
    expect(originNote(doc({ type: "link", origin: "link" }))).toBe("");
    expect(originNote(doc({ type: "file", origin: "file" }))).toBe("");
  });

  it("keeps the metadata whatever the content is", () => {
    const drive = doc({ origin: "drive", url: "https://example.com" });
    expect(drive.owner).toEqual({ kind: "reach-out" });
    expect(drive.preparedById).toBe("p-maria");
  });
});

describe("filters and search", () => {
  it("offers only types actually present, so no dead options", () => {
    expect(usedTypes([doc({ type: "plan" }), doc({ id: "s", type: "spreadsheet" })])).toEqual([
      "plan",
      "spreadsheet",
    ]);
  });

  it("searches titles, descriptions and type names", () => {
    const list = [
      doc({ id: "a", title: "Invitation Distribution" }),
      doc({ id: "b", title: "Zebra", description: "outreach" }),
    ];
    expect(searchDocuments(list, "outreach").map((d) => d.id)).toEqual(["b"]);
    expect(searchDocuments(list, "invitation").map((d) => d.id)).toEqual(["a"]);
    expect(searchDocuments(list, "plan").map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchDocuments([doc(), doc({ id: "b" })], "  ")).toHaveLength(2);
  });

  it("has a label for every document type", () => {
    expect(Object.values(documentTypeLabel).every((label) => label.length > 0)).toBe(true);
  });
});

describe("the shipped documents", () => {
  it("are shared across several binder areas", () => {
    const kinds = new Set(binderDocuments.map((d) => d.owner.kind));
    expect(kinds.size).toBeGreaterThan(1);
    for (const kind of ["ministry", "reach-out", "leadership-report"]) {
      expect(kinds).toContain(kind);
    }
  });

  it("give Reach-Out working materials of every origin", () => {
    const mine = documentsOwnedBy(binderDocuments, { kind: "reach-out" });
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((d) => d.origin))).toEqual(
      new Set(["binder", "file", "drive", "link"]),
    );
  });

  /** §8 — a document supports the work, not one particular report. */
  it("never file a Reach-Out document under a report", () => {
    for (const d of documentsOwnedBy(binderDocuments, { kind: "reach-out" })) {
      expect(d).not.toHaveProperty("reportId");
    }
  });
});
