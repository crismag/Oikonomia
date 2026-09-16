import { describe, expect, it } from "vitest";

import { mayChangeNote, mayCompleteTask } from "./meeting-access";
import { viewerFor } from "@/test/viewer";
import type { MeetingNote } from "./types";

/**
 * The meeting page decides read-only from the same rule the service enforces.
 * A participant who was shown an editable note learned it was not theirs only
 * when the save failed.
 */

const author = viewerFor("leader");
const participant = viewerFor("ministry-head");
const noteTaker = viewerFor("bishop");

const minutes: MeetingNote = {
  id: "mn-1",
  title: "Leaders Meeting",
  noteType: "minutes",
  date: "2026-09-08",
  authorId: author.person.id,
  noteTakerId: noteTaker.person.id,
  participantIds: [participant.person.id],
  blocks: [],
  status: "draft",
  tags: [],
  links: [],
  createdAt: "2026-09-08",
  updatedAt: "2026-09-08",
};

describe("who may change a meeting note", () => {
  it("lets its author change it", () => {
    expect(mayChangeNote(author, minutes)).toBe(true);
  });

  it("lets whoever took it down change it", () => {
    expect(mayChangeNote(noteTaker, minutes)).toBe(true);
  });

  it("lets a participant read minutes and not change them", () => {
    expect(mayChangeNote(participant, minutes)).toBe(false);
  });
});

describe("who may tick a meeting task", () => {
  it("lets the person it was given to complete it, though they may not edit the note", () => {
    expect(mayCompleteTask(participant, minutes, { assigneeId: participant.person.id })).toBe(true);
  });

  it("does not let a participant complete somebody else's task", () => {
    expect(mayCompleteTask(participant, minutes, { assigneeId: author.person.id })).toBe(false);
    expect(mayCompleteTask(participant, minutes, {})).toBe(false);
  });

  it("lets whoever keeps the note complete any of its tasks", () => {
    expect(mayCompleteTask(author, minutes, { assigneeId: participant.person.id })).toBe(true);
  });
});
