import { describe, expect, it } from "vitest";

import {
  addTag,
  blockText,
  filterNotes,
  isMinutes,
  readership,
  knownTags,
  ministryContextId,
  minutesTemplate,
  normalizeTag,
  notesTagged,
  removeTag,
  searchNotes,
  setContext,
  startingBlocks,
  suggestTags,
  emptyBlock,
  meetingActivity,
  noteText,
  previousInSeries,
  sortNotes,
  stripTags,
  tasksFor,
  unresolvedFrom,
} from "./meeting";
import { meetingNotes, meetingTasks } from "@/test/fixtures";
import type { MeetingBlock, MeetingNote, MeetingTask } from "./types";

/**
 * Meeting Notes behaviour.
 *
 * The document is a block list, and everything the product promises — counting
 * decisions, carrying unresolved items into the next meeting, task provenance —
 * depends on that structure being real rather than parsed out of markup. These
 * cases guard it.
 */

const block = (
  type: MeetingBlock["type"],
  html: string,
  extra: Partial<MeetingBlock> = {},
): MeetingBlock => ({ id: `b-${html.slice(0, 6)}-${type}`, type, html, ...extra });

const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
  id: "n1",
  title: "Leaders Meeting",
  noteType: "minutes",
  date: "2026-09-08",
  type: "leaders",
  participantIds: [],
  blocks: [],
  status: "complete",
  tags: [],
  links: [],
  createdAt: "2026-09-08",
  updatedAt: "2026-09-08",
  ...over,
});

describe("block text", () => {
  it("reads text out of inline markup", () => {
    expect(blockText(block("paragraph", "Camp is <strong>18 short</strong>"))).toBe(
      "Camp is 18 short",
    );
  });

  it("turns a line break into a space rather than joining words", () => {
    expect(stripTags("one<br>two")).toBe("one two");
  });

  it("decodes the entities an editor produces", () => {
    expect(stripTags("Bread &amp; wine&nbsp;today")).toBe("Bread & wine today");
  });

  it("starts a new block empty and typed", () => {
    const created = emptyBlock("checklist");
    expect(created.html).toBe("");
    expect(created.type).toBe("checklist");
    expect(created.checked).toBe(false);
  });

  it("gives a follow-up an open state from the start", () => {
    expect(emptyBlock("follow-up").state).toBe("open");
  });
});

describe("meeting activity", () => {
  const subject = note({
    blocks: [
      block("paragraph", "Ordinary writing"),
      block("decision", "We will hold two coaches"),
      block("follow-up", "Confirm the gym", { state: "open" }),
      block("follow-up", "Old thing", { state: "resolved" }),
      block("checklist", "Bring forms", { checked: false }),
      /* Empty structured blocks are scaffolding, not content. */
      block("decision", ""),
    ],
  });

  const tasks: MeetingTask[] = [
    { id: "t1", meetingId: "n1", title: "Call the school", status: "open", createdAt: "x" },
    { id: "t2", meetingId: "n1", title: "Send rota", status: "done", createdAt: "x" },
    { id: "t3", meetingId: "other", title: "Elsewhere", status: "open", createdAt: "x" },
  ];

  const activity = meetingActivity(subject, tasks);

  it("counts only this meeting's tasks", () => {
    expect(activity.tasks).toBe(2);
    expect(activity.openTasks).toBe(1);
  });

  it("counts decisions and follow-ups from the document", () => {
    expect(activity.decisions).toBe(1);
    expect(activity.followUps).toBe(2);
  });

  it("separates open follow-ups from resolved ones", () => {
    expect(activity.openFollowUps).toBe(1);
  });

  it("ignores an empty structured block", () => {
    expect(activity.decisions).not.toBe(2);
  });

  it("scopes tasks by meeting", () => {
    expect(tasksFor(tasks, "n1").map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});

describe("series and continuity", () => {
  const august = note({ id: "aug", date: "2026-08-25", type: "leaders" });
  const september = note({ id: "sep", date: "2026-09-08", type: "leaders" });
  const coaching = note({ id: "co", date: "2026-09-01", type: "coaching" });
  const all = [august, september, coaching];

  it("treats meetings of the same type as a series without configuration", () => {
    expect(previousInSeries(all, september)?.id).toBe("aug");
  });

  it("never crosses meeting types", () => {
    expect(previousInSeries(all, coaching)).toBeUndefined();
  });

  it("has no previous meeting for the first in a series", () => {
    expect(previousInSeries(all, august)).toBeUndefined();
  });

  it("ignores a later meeting when looking backwards", () => {
    expect(previousInSeries(all, august)?.id).not.toBe("sep");
  });

  it("has no series when the meeting has no type", () => {
    const { type: _omitted, ...untyped } = note({ id: "x" });
    expect(previousInSeries(all, untyped)).toBeUndefined();
  });
});

describe("unresolved carry-forward", () => {
  const subject = note({
    blocks: [
      block("follow-up", "Confirm the gym", { state: "open" }),
      block("follow-up", "Settled already", { state: "resolved" }),
      block("paragraph", "Not an action"),
    ],
  });

  const tasks: MeetingTask[] = [
    { id: "t1", meetingId: "n1", title: "Call the school", status: "open", createdAt: "x" },
    { id: "t2", meetingId: "n1", title: "Done thing", status: "done", createdAt: "x" },
  ];

  const items = unresolvedFrom(subject, tasks);

  it("carries open follow-ups and open tasks", () => {
    expect(items.map((i) => i.text)).toEqual(["Confirm the gym", "Call the school"]);
  });

  it("leaves resolved and completed items behind", () => {
    expect(items.some((i) => i.text === "Settled already")).toBe(false);
    expect(items.some((i) => i.text === "Done thing")).toBe(false);
  });

  it("remembers which meeting each item came from", () => {
    expect(items.every((i) => i.fromMeetingId === "n1")).toBe(true);
  });

  it("distinguishes a follow-up from a task", () => {
    expect(items.map((i) => i.kind)).toEqual(["follow-up", "task"]);
  });
});

describe("list and search", () => {
  const notes = [
    note({ id: "a", date: "2026-08-01", title: "August" }),
    note({ id: "b", date: "2026-09-08", title: "September" }),
  ];

  it("lists newest first", () => {
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("searches titles", () => {
    expect(searchNotes(notes, "august").map((n) => n.id)).toEqual(["a"]);
  });

  it("searches inside the document, not just the title", () => {
    const withBody = [
      note({ id: "c", title: "Untitled", blocks: [block("paragraph", "gym availability")] }),
    ];
    expect(searchNotes(withBody, "gym")).toHaveLength(1);
  });

  it("ignores inline markup when searching", () => {
    const withMarkup = [note({ id: "d", blocks: [block("paragraph", "Camp is <b>short</b>")] })];
    expect(searchNotes(withMarkup, "is short")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(searchNotes(notes, "   ")).toHaveLength(2);
  });

  it("includes the title in the searchable text", () => {
    expect(noteText(notes[1]!)).toContain("september");
  });
});

describe("the shipped fixtures", () => {
  it("store documents as blocks, not as a string", () => {
    expect(meetingNotes.every((n) => Array.isArray(n.blocks))).toBe(true);
    expect(meetingNotes.some((n) => n.blocks.some((b) => b.type === "decision"))).toBe(true);
  });

  it("carry an unresolved follow-up for the next meeting to pick up", () => {
    const september = meetingNotes.find((n) => n.id === "mn-1");
    expect(september?.blocks.some((b) => b.type === "follow-up" && b.state === "open")).toBe(true);
  });

  it("give a task its provenance back to a block", () => {
    const withOrigin = meetingTasks.find((t) => t.blockId);
    expect(withOrigin?.meetingId).toBe("mn-1");
  });

  it("form a leaders series across two months", () => {
    const september = meetingNotes.find((n) => n.id === "mn-1")!;
    expect(previousInSeries(meetingNotes, september)?.id).toBe("mn-3");
  });
});

/* ------------------------------------------------- personal notes vs minutes */

describe("the two kinds of note", () => {
  it("tells them apart", () => {
    expect(isMinutes(note({ noteType: "minutes" }))).toBe(true);
    expect(isMinutes(note({ noteType: "personal" }))).toBe(false);
  });

  /**
   * The rule that keeps them separate artifacts.
   *
   * There is nothing to share a personal note *with* — the type is the whole
   * of the readership rule, and the field that used to sit beside it was read
   * by nothing. `readership` says the rule in a sentence, and that sentence is
   * derived from the type, so the two can never disagree.
   */
  it("says a personal note is its author's and minutes are the meeting's", () => {
    expect(readership(note({ noteType: "personal" }))).toMatch(/you/i);
    expect(readership(note({ noteType: "minutes" }))).not.toMatch(/only you/i);
  });

  it("opens a personal note on a single empty paragraph", () => {
    const blocks = startingBlocks("personal");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(blocks[0]?.html).toBe("");
  });

  it("opens minutes on the starter headings", () => {
    const headings = startingBlocks("minutes")
      .filter((b) => b.type === "heading-2")
      .map((b) => b.html);
    expect(headings).toEqual([
      "Attendees",
      "Agenda",
      "Discussion",
      "Decisions",
      "Action items",
      "Follow-up and next meeting",
    ]);
  });

  /** Starter content, not a form: every part of it is an ordinary block. */
  it("makes the whole template editable, with no required fields", () => {
    const blocks = minutesTemplate();
    expect(blocks.every((b) => typeof b.html === "string")).toBe(true);
    expect(blocks.some((b) => b.type === "checklist")).toBe(true);
    expect(blocks.some((b) => b.type === "decision")).toBe(true);
    for (const b of blocks) {
      expect(b).not.toHaveProperty("required");
      expect(b).not.toHaveProperty("locked");
    }
  });
});

/* ------------------------------------------------------------------- tags */

describe("tags", () => {
  it("accepts what a leader would actually type", () => {
    expect(normalizeTag("#Planning")).toBe("planning");
    expect(normalizeTag("  follow up ")).toBe("follow-up");
    expect(normalizeTag("BUDGET")).toBe("budget");
  });

  it("ignores an empty tag", () => {
    expect(addTag([], "  #  ")).toEqual([]);
  });

  it("never adds the same tag twice", () => {
    expect(addTag(["planning"], "#Planning")).toEqual(["planning"]);
  });

  it("removes a tag", () => {
    expect(removeTag(["planning", "budget"], "planning")).toEqual(["budget"]);
  });

  it("suggests existing tags, most used first", () => {
    const notes = [
      note({ id: "a", tags: ["planning", "budget"] }),
      note({ id: "b", tags: ["planning"] }),
    ];
    expect(knownTags(notes)).toEqual(["planning", "budget"]);
  });

  it("does not suggest a tag the note already has", () => {
    const notes = [note({ tags: ["planning", "budget"] })];
    expect(suggestTags(notes, "", ["planning"])).toEqual(["budget"]);
  });

  it("narrows suggestions as the leader types", () => {
    const notes = [note({ tags: ["planning", "budget"] })];
    expect(suggestTags(notes, "bud", [])).toEqual(["budget"]);
  });

  it("finds notes by tag", () => {
    const notes = [note({ id: "a", tags: ["worship"] }), note({ id: "b", tags: ["budget"] })];
    expect(notesTagged(notes, "worship").map((n) => n.id)).toEqual(["a"]);
  });

  it("searches tags with or without the hash", () => {
    const notes = [note({ id: "a", tags: ["worship"] })];
    expect(searchNotes(notes, "#worship").map((n) => n.id)).toEqual(["a"]);
    expect(searchNotes(notes, "worship").map((n) => n.id)).toEqual(["a"]);
  });
});

/* --------------------------------------------------------- context links */

describe("organizational context", () => {
  /**
   * The distinction the brief insists on: a hashtag describes the note, a
   * context link says which real entity the meeting belongs to.
   */
  it("points at the ministry record, not at a name or a tag", () => {
    const n = note({ links: [{ kind: "ministry", id: "min-music" }] });
    expect(ministryContextId(n)).toBe("min-music");
    expect(n.tags).not.toContain("music");
  });

  it("has no context when the meeting is general leadership", () => {
    expect(ministryContextId(note())).toBeUndefined();
  });

  it("replaces the context rather than accumulating them", () => {
    const links = setContext([{ kind: "ministry", id: "min-music" }], "ministry", "min-victuals");
    expect(links.filter((l) => l.kind === "ministry")).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "min-victuals" });
  });

  it("clears the context without disturbing other links", () => {
    const links = setContext(
      [
        { kind: "schedule-entry", id: "se-1" },
        { kind: "ministry", id: "min-music" },
      ],
      "ministry",
    );
    expect(links).toEqual([{ kind: "schedule-entry", id: "se-1" }]);
  });
});

/* ---------------------------------------------------------------- filters */

describe("filtering the list", () => {
  const notes = [
    note({
      id: "minutes-music",
      noteType: "minutes",
      tags: ["worship"],
      links: [{ kind: "ministry", id: "min-music" }],
    }),
    note({ id: "personal", noteType: "personal", tags: ["worship"] }),
    note({ id: "minutes-other", noteType: "minutes", tags: ["budget"] }),
  ];

  it("filters by kind of note", () => {
    expect(filterNotes(notes, { noteType: "personal" }).map((n) => n.id)).toEqual(["personal"]);
  });

  it("filters by tag", () => {
    expect(
      filterNotes(notes, { tag: "worship" })
        .map((n) => n.id)
        .sort(),
    ).toEqual(["minutes-music", "personal"]);
  });

  it("filters by the ministry the meeting belongs to", () => {
    expect(filterNotes(notes, { ministryId: "min-music" }).map((n) => n.id)).toEqual([
      "minutes-music",
    ]);
  });

  it("combines filters", () => {
    expect(filterNotes(notes, { noteType: "minutes", tag: "worship" }).map((n) => n.id)).toEqual([
      "minutes-music",
    ]);
  });

  it("returns everything when nothing is set", () => {
    expect(filterNotes(notes, {})).toHaveLength(3);
  });

  /** One artifact, seen from two places — never a copy. */
  it("returns the very same records a ministry view would show", () => {
    const fromList = filterNotes(notes, { ministryId: "min-music" })[0];
    expect(fromList).toBe(notes[0]);
  });
});
