import { describe, expect, it } from "vitest";

import {
  isBinderNative,
  originLabel,
  originNote,
  pinnedFirst,
  searchDocuments,
  usedTypes,
} from "./documents";
import {
  activityFor,
  canContribute,
  canManage,
  documentsFor,
  ministriesFor,
  notesForMinistry,
  relationshipTo,
} from "./ministry";
import { binderDocuments, meetingNotes, ministries } from "@/test/fixtures";
import type { BinderDocument, MeetingNote, Ministry, MinistryActivity } from "./types";

/**
 * Ministry behaviour.
 *
 * Two rules carry the module: a ministry owns its information regardless of who
 * created it, and a person's relationship to a ministry decides what they can
 * do. These cases guard both, plus the document-is-not-a-file distinction.
 */

const ministry: Ministry = {
  id: "m1",
  name: "Music Ministry",
  purpose: "Lead worship.",
  campusId: "c1",
  leadId: "p-lead",
  teamIds: ["p-member"],
  sharedWithIds: ["p-guest"],
};

const doc = (over: Partial<BinderDocument> = {}): BinderDocument => ({
  id: "d1",
  title: "Worship Plan",
  owner: { kind: "ministry", ministryId: "m1" },
  preparedById: "p-lead",
  type: "plan",
  origin: "binder",
  updatedAt: "2026-09-01",
  ...over,
});

describe("relationships", () => {
  it("recognises the leader", () => {
    expect(relationshipTo(ministry, "p-lead")).toBe("lead");
  });

  it("recognises a participant", () => {
    expect(relationshipTo(ministry, "p-member")).toBe("participate");
  });

  it("recognises someone information was shared with", () => {
    expect(relationshipTo(ministry, "p-guest")).toBe("shared");
  });

  it("recognises no relationship at all", () => {
    expect(relationshipTo(ministry, "p-stranger")).toBe("none");
  });

  it("does not treat being shared with as membership", () => {
    expect(relationshipTo(ministry, "p-guest")).not.toBe("participate");
  });
});

describe("what a relationship permits", () => {
  it("lets only the leader manage the ministry", () => {
    expect(canManage("lead")).toBe(true);
    expect(canManage("participate")).toBe(false);
    expect(canManage("shared")).toBe(false);
  });

  it("lets leaders and participants contribute", () => {
    expect(canContribute("lead")).toBe(true);
    expect(canContribute("participate")).toBe(true);
  });

  it("does not let a shared viewer contribute", () => {
    expect(canContribute("shared")).toBe(false);
    expect(canContribute("none")).toBe(false);
  });
});

describe("a person's ministries", () => {
  const all: Ministry[] = [
    { ...ministry, id: "shared-one", leadId: "x", teamIds: [], sharedWithIds: ["p-me"] },
    { ...ministry, id: "led", leadId: "p-me", teamIds: [] },
    { ...ministry, id: "joined", leadId: "x", teamIds: ["p-me"] },
    { ...ministry, id: "unrelated", leadId: "x", teamIds: [], sharedWithIds: [] },
  ];

  it("lists only ministries the person is connected to", () => {
    expect(ministriesFor(all, "p-me").map((m) => m.id)).not.toContain("unrelated");
  });

  it("orders lead, then participate, then shared", () => {
    expect(ministriesFor(all, "p-me").map((m) => m.id)).toEqual(["led", "joined", "shared-one"]);
  });
});

describe("ownership", () => {
  /**
   * The whole point: a document created by one person belongs to the ministry,
   * so it survives that person leaving.
   */
  it("keeps prepared-by separate from belongs-to", () => {
    const d = doc({
      preparedById: "p-someone-else",
      owner: { kind: "ministry", ministryId: "m1" },
    });
    expect(d.owner).toEqual({ kind: "ministry", ministryId: "m1" });
    expect(d.preparedById).not.toBe(ministry.leadId);
    expect(documentsFor([d], "m1")).toHaveLength(1);
  });

  it("does not move a document when leadership changes", () => {
    const d = doc({ preparedById: "p-old-leader" });
    const afterHandover = { ...ministry, leadId: "p-new-leader" };
    expect(documentsFor([d], afterHandover.id)).toHaveLength(1);
  });
});

describe("documents are not files", () => {
  it("treats only binder-native content as editable here", () => {
    expect(isBinderNative("binder")).toBe(true);
    expect(isBinderNative("drive")).toBe(false);
    expect(isBinderNative("file")).toBe(false);
    expect(isBinderNative("link")).toBe(false);
  });

  it("describes each origin in plain language, not the enum", () => {
    expect(originLabel.drive).toBe("Google Drive");
    expect(originLabel.file).toBe("Uploaded file");
    expect(originLabel.binder).toBe("In the binder");
    expect(originLabel.link).toBe("Link");
  });

  it("carries the same metadata whatever the content is", () => {
    const drive = doc({ id: "d2", origin: "drive", url: "https://example.com" });
    expect(drive.owner).toEqual({ kind: "ministry", ministryId: "m1" });
    expect(drive.preparedById).toBe("p-lead");
  });
});

describe("saying where a document lives", () => {
  it("names the origin when it adds something", () => {
    expect(originNote(doc({ origin: "drive", type: "spreadsheet" }))).toBe("Google Drive");
    expect(originNote(doc({ origin: "binder", type: "plan" }))).toBe("In the binder");
  });

  it("stays quiet when the origin would only repeat the type", () => {
    expect(originNote(doc({ origin: "link", type: "link" }))).toBe("");
    expect(originNote(doc({ origin: "file", type: "file" }))).toBe("");
  });
});

describe("meeting notes held for a ministry", () => {
  const note = (id: string, date: string, ministryIds: string[]): MeetingNote => ({
    id,
    title: id,
    noteType: "minutes",
    date,
    participantIds: [],
    blocks: [],
    status: "complete",
    tags: [],
    links: ministryIds.map((mid) => ({ kind: "ministry" as const, id: mid })),
    createdAt: date,
    updatedAt: date,
  });

  const all = [
    note("older", "2026-08-01", ["m1"]),
    note("newer", "2026-09-01", ["m1"]),
    note("elsewhere", "2026-09-05", ["m2"]),
    note("unlinked", "2026-09-06", []),
  ];

  it("finds notes by the link on the note, not by its title", () => {
    expect(notesForMinistry(all, "m1").map((n) => n.id)).toEqual(["newer", "older"]);
  });

  it("leaves out notes linked to another ministry", () => {
    expect(notesForMinistry(all, "m1").map((n) => n.id)).not.toContain("elsewhere");
  });

  /** The note is referenced, never duplicated into the ministry. */
  it("returns the very same records, not copies", () => {
    expect(notesForMinistry(all, "m1")[0]).toBe(all[1]);
  });

  it("connects at least one shipped note to a ministry", () => {
    expect(notesForMinistry(meetingNotes, "min-music").length).toBeGreaterThan(0);
  });
});

describe("document lists", () => {
  const docs = [
    doc({ id: "old", updatedAt: "2026-01-01" }),
    doc({ id: "new", updatedAt: "2026-09-09" }),
    doc({ id: "pinned", updatedAt: "2026-05-05", pinned: true }),
    doc({ id: "other", owner: { kind: "ministry", ministryId: "m2" } }),
  ];

  it("returns only this ministry's documents, newest first", () => {
    expect(documentsFor(docs, "m1").map((d) => d.id)).toEqual(["new", "pinned", "old"]);
  });

  it("floats pinned documents to the top", () => {
    expect(pinnedFirst(documentsFor(docs, "m1"))[0]?.id).toBe("pinned");
  });

  it("searches titles and types", () => {
    expect(searchDocuments(docs, "worship")).toHaveLength(4);
    expect(searchDocuments(docs, "plan").length).toBeGreaterThan(0);
  });

  it("returns everything for an empty query", () => {
    expect(searchDocuments(docs, "  ")).toHaveLength(4);
  });

  it("offers only types actually present, so no dead filters", () => {
    const mixed = [doc({ type: "plan" }), doc({ id: "g", type: "goals" })];
    expect(usedTypes(mixed)).toEqual(["goals", "plan"]);
  });
});

describe("activity", () => {
  const entries: MinistryActivity[] = [
    {
      id: "a",
      ministryId: "m1",
      at: "2026-09-01",
      actorId: "p",
      summary: "did a thing",
    },
    {
      id: "b",
      ministryId: "m1",
      at: "2026-09-09",
      actorId: "p",
      summary: "did another",
    },
    {
      id: "c",
      ministryId: "m2",
      at: "2026-09-05",
      actorId: "p",
      summary: "elsewhere",
    },
  ];

  it("returns this ministry's activity, newest first", () => {
    expect(activityFor(entries, "m1").map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("the shipped fixtures", () => {
  const music = ministries.find((m) => m.id === "min-music");
  const transport = ministries.find((m) => m.id === "min-transport");
  const victuals = ministries.find((m) => m.id === "min-victuals");

  it("give Maria the three relationships the product describes", () => {
    expect(relationshipTo(music!, "p-maria")).toBe("lead");
    expect(relationshipTo(victuals!, "p-maria")).toBe("participate");
    expect(relationshipTo(transport!, "p-maria")).toBe("shared");
  });

  it("hold documents of every origin, so the distinction is exercised", () => {
    const origins = new Set(binderDocuments.map((d) => d.origin));
    expect(origins).toEqual(new Set(["binder", "file", "drive", "link"]));
  });

  it("include a document prepared by someone other than the leader", () => {
    const music_docs = documentsFor(binderDocuments, "min-music");
    expect(music_docs.some((d) => d.preparedById !== music!.leadId)).toBe(true);
  });

  it("never leave a ministry document without a ministry to belong to", () => {
    const ministryOwned = binderDocuments
      .map((d) => d.owner)
      .filter((owner) => owner.kind === "ministry");
    expect(ministryOwned.length).toBeGreaterThan(0);
    expect(ministryOwned.every((owner) => ministries.some((m) => m.id === owner.ministryId))).toBe(
      true,
    );
  });
});
