import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createMeetingService } from "./meeting-service";
import { viewerFor } from "@/test/viewer";
import { canView } from "@/domain/authorize";
import type { Database as Db } from "better-sqlite3";

/**
 * Meeting Notes persistence and rules.
 *
 * Against a real database. The cases that matter are the two the module rests
 * on — a personal note is not minutes, and a note nobody may read must not
 * appear anywhere — plus the ones a mock cannot have: whether rich text
 * survives a round trip, and whether search reaches what a note *says*.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createMeetingService>;
let repo: ReturnType<typeof createMeetingRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-meetings-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createMeetingRepository(db);
  service = createMeetingService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const note = (over: Record<string, unknown> = {}) => ({
  title: "Leaders Meeting",
  noteType: "minutes",
  date: "2026-09-08",
  ...over,
});

const block = (id: string, html: string, type = "paragraph") => ({ id, type, html });

describe("creating a note", () => {
  it("persists it and gives it an id", () => {
    const created = service.createNote(maria, note());
    expect(created.id).toMatch(/^mn-/);
    expect(repo.findNote(created.id)?.title).toBe("Leaders Meeting");
  });

  it("records the author", () => {
    expect(service.createNote(maria, note()).authorId).toBe(maria.person.id);
  });

  /** Starting shape, not a template the leader has to fill in. */
  it("opens minutes with the headings a meeting record needs", () => {
    const created = service.createNote(maria, note({ noteType: "minutes" }));
    expect(created.blocks.length).toBeGreaterThan(1);
  });

  it("opens a personal note with somewhere to write and nothing else", () => {
    const created = service.createNote(maria, note({ noteType: "personal" }));
    expect(created.blocks).toHaveLength(1);
  });

  /**
   * The distinction the module rests on: a personal note is the leader's own
   * working record, and minutes are the meeting's account of itself.
   */
  /**
   * Readership follows the type, and there is no second field to disagree
   * with it.
   *
   * `meeting_note.visibility` used to be written here and read by nothing.
   * What replaces it is the absence: a note carries its type, and the type is
   * what `getNote` consults.
   */
  it("gives a note its type and nothing else that claims to decide readership", () => {
    const personal = service.createNote(maria, note({ noteType: "personal" }));
    const minutes = service.createNote(maria, note({ noteType: "minutes" }));

    expect(personal.noteType).toBe("personal");
    expect(minutes.noteType).toBe("minutes");
    expect(personal).not.toHaveProperty("visibility");
    expect(minutes).not.toHaveProperty("visibility");
  });

  it("accepts a note with no title, because one is named once it has content", () => {
    expect(service.createNote(maria, note({ title: "" })).title).toBe("");
  });

  it("refuses a note with no date", () => {
    expect(() => service.createNote(maria, { title: "x", noteType: "personal" })).toThrow(ApiError);
  });

  it("refuses a note type it does not know", () => {
    expect(() => service.createNote(maria, note({ noteType: "verbatim" }))).toThrow(ApiError);
  });
});

describe("rich text survives", () => {
  it("keeps blocks, their types and their inline markup", () => {
    const created = service.createNote(
      maria,
      note({
        blocks: [
          block("b1", "What we <strong>agreed</strong>", "heading-2"),
          block("b2", "Keep the current rota until the camp.", "decision"),
          { id: "b3", type: "checklist", html: "Ring the camp office", checked: true },
          { id: "b4", type: "follow-up", html: "Two seats still unfilled", state: "open" },
        ],
      }),
    );

    const loaded = repo.findNote(created.id)!;
    expect(loaded.blocks).toHaveLength(4);
    expect(loaded.blocks[0]?.html).toBe("What we <strong>agreed</strong>");
    expect(loaded.blocks[1]?.type).toBe("decision");
    expect(loaded.blocks[2]?.checked).toBe(true);
    expect(loaded.blocks[3]?.state).toBe("open");
  });

  it("keeps tags and context links apart", () => {
    const created = service.createNote(
      maria,
      note({ tags: ["planning", "camp"], links: [{ kind: "ministry", id: "min-music" }] }),
    );
    const loaded = repo.findNote(created.id)!;
    expect(loaded.tags).toEqual(["planning", "camp"]);
    expect(loaded.links).toEqual([{ kind: "ministry", id: "min-music" }]);
  });

  it("omits an absent field rather than carrying an undefined one", () => {
    const created = service.createNote(maria, note({ noteType: "personal" }));
    const loaded = repo.findNote(created.id)!;
    expect("location" in loaded).toBe(false);
    expect("absenteeIds" in loaded).toBe(false);
  });
});

describe("listing", () => {
  const shared = (over: Record<string, unknown> = {}) =>
    note({ noteType: "minutes", participantIds: [maria.person.id, joel.person.id], ...over });

  it("returns newest first", () => {
    service.createNote(maria, shared({ title: "Older", date: "2026-08-01" }));
    service.createNote(maria, shared({ title: "Newer", date: "2026-09-01" }));

    const { notes } = service.listNotes(maria, {});
    expect(notes.map((n) => n.title)).toEqual(["Newer", "Older"]);
  });

  it("pages in the database, after filtering", () => {
    for (let i = 0; i < 30; i += 1) {
      service.createNote(
        maria,
        shared({ title: `Meeting ${i}`, date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }),
      );
    }

    const first = service.listNotes(maria, { page: 1, pageSize: 25 });
    expect(first.notes).toHaveLength(25);
    expect(first.page).toMatchObject({ page: 1, pageCount: 2, total: 30 });

    const second = service.listNotes(maria, { page: 2, pageSize: 25 });
    expect(second.notes).toHaveLength(5);
  });

  it("clamps a page past the end rather than returning nothing", () => {
    service.createNote(maria, shared());
    const { notes, page } = service.listNotes(maria, { page: 9, pageSize: 25 });
    expect(page.page).toBe(1);
    expect(notes).toHaveLength(1);
  });

  it("filters by note type", () => {
    service.createNote(maria, shared({ title: "Minutes" }));
    service.createNote(maria, note({ title: "Mine", noteType: "personal" }));

    const { notes } = service.listNotes(maria, { noteType: "personal" });
    expect(notes.map((n) => n.title)).toEqual(["Mine"]);
  });

  it("filters by tag", () => {
    service.createNote(maria, shared({ title: "Camp", tags: ["camp"] }));
    service.createNote(maria, shared({ title: "Budget", tags: ["budget"] }));

    const { notes } = service.listNotes(maria, { tag: "camp" });
    expect(notes.map((n) => n.title)).toEqual(["Camp"]);
  });

  /** A ministry is a context link, not a hashtag. */
  it("filters by the ministry a meeting was held for", () => {
    service.createNote(
      maria,
      shared({ title: "Music", links: [{ kind: "ministry", id: "min-music" }] }),
    );
    service.createNote(maria, shared({ title: "Tagged", tags: ["min-music"] }));

    const { notes } = service.listNotes(maria, { ministryId: "min-music" });
    expect(notes.map((n) => n.title)).toEqual(["Music"]);
  });

  it("searches the title", () => {
    service.createNote(maria, shared({ title: "Camp committee" }));
    service.createNote(maria, shared({ title: "Budget review" }));

    const { notes } = service.listNotes(maria, { search: "camp" });
    expect(notes.map((n) => n.title)).toEqual(["Camp committee"]);
  });

  /**
   * What a note *says*, not only what it is called — which is why `body_text`
   * exists as a derived column.
   */
  it("searches what the note says", () => {
    service.createNote(
      maria,
      shared({ title: "Leaders Meeting", blocks: [block("b1", "The <em>minibus</em> is booked")] }),
    );
    service.createNote(maria, shared({ title: "Other", blocks: [block("b2", "Nothing here")] }));

    const { notes } = service.listNotes(maria, { search: "minibus" });
    expect(notes.map((n) => n.title)).toEqual(["Leaders Meeting"]);
  });

  it("does not match the markup a leader never typed", () => {
    service.createNote(maria, shared({ blocks: [block("b1", "The <em>minibus</em> is booked")] }));
    const { notes } = service.listNotes(maria, { search: "em" });
    expect(notes).toHaveLength(0);
  });

  it("finds notes again after the text is edited away", () => {
    const created = service.createNote(maria, shared({ blocks: [block("b1", "minibus")] }));
    service.updateNote(maria, created.id, { blocks: [block("b1", "coach")] });

    expect(service.listNotes(maria, { search: "minibus" }).notes).toHaveLength(0);
    expect(service.listNotes(maria, { search: "coach" }).notes).toHaveLength(1);
  });
});

describe("the filter options offered", () => {
  it("describe everything readable, not the page in hand", () => {
    for (let i = 0; i < 30; i += 1) {
      service.createNote(maria, note({ title: `M${i}`, date: "2026-09-01", tags: [`tag${i}`] }));
    }

    const { notes, facets } = service.listNotes(maria, { page: 1, pageSize: 5 });
    expect(notes).toHaveLength(5);
    /* A tag that vanishes when you turn a page is a filter nobody can trust. */
    expect(facets.tags).toHaveLength(30);
  });

  it("do not narrow when a search does", () => {
    service.createNote(maria, note({ title: "Camp", tags: ["camp"] }));
    service.createNote(maria, note({ title: "Budget", tags: ["budget"] }));

    const { facets } = service.listNotes(maria, { search: "camp" });
    expect(facets.tags).toEqual(["budget", "camp"]);
  });

  /** An option is a fact about notes; offering one from a note you cannot open leaks it. */
  it("never reveal a tag from a note the viewer cannot read", () => {
    service.createNote(maria, note({ noteType: "personal", tags: ["confidential-matter"] }));

    expect(service.listNotes(joel, {}).facets.tags).not.toContain("confidential-matter");
    expect(service.listNotes(maria, {}).facets.tags).toContain("confidential-matter");
  });

  it("lists the ministries meetings were held for", () => {
    service.createNote(maria, note({ links: [{ kind: "ministry", id: "min-music" }] }));
    service.createNote(maria, note({ tags: ["min-victuals"] }));

    const { facets } = service.listNotes(maria, {});
    expect(facets.ministryIds).toEqual(["min-music"]);
  });
});

describe("who may read a note", () => {
  it("keeps a personal note to its author", () => {
    const mine = service.createNote(maria, note({ noteType: "personal", title: "My notes" }));

    expect(service.listNotes(maria, {}).notes.map((n) => n.id)).toContain(mine.id);
    expect(service.listNotes(joel, {}).notes).toHaveLength(0);
    expect(service.listNotes(bishop, {}).notes).toHaveLength(0);
  });

  /** Existence is part of what is private: the same answer as "no such note". */
  it("answers not-found rather than forbidden for someone else's personal note", () => {
    const mine = service.createNote(maria, note({ noteType: "personal" }));
    try {
      service.getNote(joel, mine.id);
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).code).toBe("not-found");
    }
  });

  it("lets a participant read minutes", () => {
    const minutes = service.createNote(
      maria,
      note({ noteType: "minutes", noteTakerId: maria.person.id, participantIds: [joel.person.id] }),
    );
    expect(service.getNote(joel, minutes.id).note.id).toBe(minutes.id);
  });

  it("keeps minutes from someone who was not at the meeting", () => {
    const minutes = service.createNote(
      maria,
      note({ noteType: "minutes", noteTakerId: maria.person.id, participantIds: [] }),
    );
    expect(() => service.getNote(bishop, minutes.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("does not let a participant edit minutes they did not write", () => {
    const minutes = service.createNote(
      maria,
      note({ noteType: "minutes", noteTakerId: maria.person.id, participantIds: [joel.person.id] }),
    );
    try {
      service.updateNote(joel, minutes.id, { title: "Rewritten" });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).code).toBe("forbidden");
    }
    expect(repo.findNote(minutes.id)?.title).toBe("Leaders Meeting");
  });

  it("does not let anyone delete a note that is not theirs", () => {
    const mine = service.createNote(maria, note({ noteType: "personal" }));
    expect(() => service.deleteNote(joel, mine.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
    expect(repo.findNote(mine.id)).toBeDefined();
  });
});

/**
 * The one place the same rule is written twice.
 *
 * `domain/authorize.ts` states who may read a note; the repository expresses
 * that as SQL so the count and the page can be the viewer's own. Two
 * implementations of one rule drift, so this asserts they agree — across every
 * shape of note and every persona, not on a chosen example.
 */
describe("the SQL filter and canView agree", () => {
  const shapes = [
    { title: "personal-maria", noteType: "personal", authorId: maria.person.id },
    { title: "personal-joel", noteType: "personal", authorId: joel.person.id },
    { title: "minutes-nobody", noteType: "minutes", noteTakerId: maria.person.id },
    {
      title: "minutes-joel-present",
      noteType: "minutes",
      noteTakerId: maria.person.id,
      participantIds: [joel.person.id],
    },
    {
      title: "minutes-all-present",
      noteType: "minutes",
      noteTakerId: maria.person.id,
      participantIds: [joel.person.id, bishop.person.id],
    },
    {
      title: "minutes-bishop-took",
      noteType: "minutes",
      noteTakerId: bishop.person.id,
      participantIds: [],
    },
    { title: "personal-bishop", noteType: "personal", authorId: bishop.person.id },
    /*
     * The case that distinguishes the two rules. A personal note *may* list
     * participants — the leader wrote down who was in the room — and that must
     * not make it readable by them. Without this shape, a SQL filter that
     * ignored `note_type` would look correct.
     */
    {
      title: "personal-maria-with-participants",
      noteType: "personal",
      authorId: maria.person.id,
      participantIds: [joel.person.id, bishop.person.id],
    },
  ];

  beforeEach(() => {
    for (const shape of shapes) service.createNote(maria, note(shape));
  });

  for (const viewer of [maria, joel, bishop]) {
    it(`agrees for ${viewer.persona.label}`, () => {
      /*
       * The repository's own answer, not the service's — the service applies
       * `canView` afterwards, so comparing its output to `canView` would agree
       * however wrong the SQL was.
       */
      const fromSql = repo
        .listNotes({ readableBy: viewer.person.id }, 100, 0)
        .map((n) => n.title)
        .sort();

      /* What the domain rule says, applied to every note that exists. */
      const fromDomain = repo
        .listNotes({}, 100, 0)
        .filter((n) => canView(viewer, { kind: "meeting-note", note: n }))
        .map((n) => n.title)
        .sort();

      expect(fromSql).toEqual(fromDomain);
    });

    it(`counts only what ${viewer.persona.label} may read`, () => {
      const { notes, page } = service.listNotes(viewer, { pageSize: 100 });
      /* The leak this guards: a total larger than the viewer's own list. */
      expect(page.total).toBe(notes.length);
    });
  }
});

describe("editing", () => {
  it("saves a changed block without touching the rest of the note", () => {
    const created = service.createNote(
      maria,
      note({ location: "SC Church", blocks: [block("b1", "first")] }),
    );

    const updated = service.updateNote(maria, created.id, { blocks: [block("b1", "second")] });
    expect(updated.blocks[0]?.html).toBe("second");
    expect(updated.location).toBe("SC Church");
    expect(updated.date).toBe("2026-09-08");
  });

  it("moves the updated timestamp and leaves the created one alone", () => {
    const created = service.createNote(maria, note());
    const updated = service.updateNote(maria, created.id, { title: "Renamed" });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("refuses a note that does not exist", () => {
    expect(() => service.updateNote(maria, "mn-nope", { title: "x" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

/**
 * Two savers, one note.
 *
 * Notes autosave behind a debounce, so this is not an exotic case: two tabs, or
 * a leader and the person who took the minutes, and the slower write silently
 * replaces the faster one. Silently is the problem — last-write-wins looks
 * exactly like success.
 */
describe("a save that arrives late", () => {
  it("counts up on every write", () => {
    const created = service.createNote(maria, note());
    expect(created.version).toBe(1);
    expect(service.updateNote(maria, created.id, { title: "Second" }).version).toBe(2);
    expect(service.updateNote(maria, created.id, { title: "Third" }).version).toBe(3);
  });

  it("refuses a write against a version that has moved on", () => {
    const created = service.createNote(maria, note());
    const stale = created.version!;

    /* Somebody else saves first. */
    service.updateNote(maria, created.id, { title: "Theirs" }, stale);

    try {
      service.updateNote(maria, created.id, { title: "Mine" }, stale);
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).code).toBe("conflict");
    }
  });

  it("leaves the first writer's work in place", () => {
    const created = service.createNote(maria, note());
    const stale = created.version!;

    service.updateNote(maria, created.id, { title: "Theirs" }, stale);
    try {
      service.updateNote(maria, created.id, { title: "Mine" }, stale);
    } catch {
      /* expected */
    }

    expect(repo.findNote(created.id)?.title).toBe("Theirs");
  });

  it("accepts the next write once the caller has the current version", () => {
    const created = service.createNote(maria, note());
    const after = service.updateNote(maria, created.id, { title: "Theirs" }, created.version!);
    const next = service.updateNote(maria, created.id, { title: "Mine" }, after.version!);
    expect(next.title).toBe("Mine");
  });

  /** A conflict and a deletion are different things to tell a leader. */
  it("says not-found rather than conflict when the note is gone", () => {
    const created = service.createNote(maria, note());
    const version = created.version!;
    service.deleteNote(maria, created.id);

    expect(() => service.updateNote(maria, created.id, { title: "x" }, version)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

describe("tasks that came out of a meeting", () => {
  it("belongs to the meeting and starts open", () => {
    const meeting = service.createNote(maria, note());
    const task = service.createTask(maria, {
      meetingId: meeting.id,
      title: "Ring the camp office",
    });

    expect(task.status).toBe("open");
    expect(task.meetingId).toBe(meeting.id);
  });

  it("remembers which block produced it", () => {
    const meeting = service.createNote(maria, note({ blocks: [block("b1", "Ring them")] }));
    const task = service.createTask(maria, {
      meetingId: meeting.id,
      blockId: "b1",
      title: "Ring them",
    });
    expect(task.blockId).toBe("b1");
  });

  /** The task is its own record: editing the sentence away must not delete it. */
  it("survives the block it came from being edited away", () => {
    const meeting = service.createNote(maria, note({ blocks: [block("b1", "Ring them")] }));
    const task = service.createTask(maria, {
      meetingId: meeting.id,
      blockId: "b1",
      title: "Ring them",
    });

    service.updateNote(maria, meeting.id, { blocks: [block("b1", "Something else entirely")] });
    expect(repo.findTask(task.id)).toBeDefined();
  });

  it("closes and reopens", () => {
    const meeting = service.createNote(maria, note());
    const task = service.createTask(maria, { meetingId: meeting.id, title: "Do it" });

    expect(service.updateTask(maria, task.id, { status: "done" }).status).toBe("done");
    expect(service.updateTask(maria, task.id, { status: "open" }).status).toBe("open");
  });

  it("refuses a task with no name", () => {
    const meeting = service.createNote(maria, note());
    expect(() => service.createTask(maria, { meetingId: meeting.id, title: "  " })).toThrow(
      ApiError,
    );
  });

  it("does not let someone add a task to a note they cannot write", () => {
    const mine = service.createNote(maria, note({ noteType: "personal" }));
    expect(() => service.createTask(joel, { meetingId: mine.id, title: "Sneaky" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  /** Tasks were filed nowhere else, so they go when the meeting goes. */
  it("goes with the meeting when the meeting is deleted", () => {
    const meeting = service.createNote(maria, note());
    const task = service.createTask(maria, { meetingId: meeting.id, title: "Do it" });

    service.deleteNote(maria, meeting.id);
    expect(repo.findTask(task.id)).toBeUndefined();
  });
});

/**
 * Personal notes, minutes and tasks are three different things.
 *
 * The module holds all three, and the boundary between them is what these
 * tests exist for. A personal note is one leader's working record; minutes are
 * the meeting's account of itself; a task is a responsibility that outlives
 * both and follows the person who accepted it.
 */
describe("a personal note stays personal", () => {
  it("is invisible to a participant, and so is the fact that it exists", () => {
    const mine = service.createNote(maria, {
      ...note({ noteType: "personal", title: "What to ask Joel" }),
      participantIds: [joel.person.id],
    });

    /* Not "forbidden" — not-found, so its existence is private too. */
    expect(() => service.getNote(joel, mine.id)).toThrow(ApiError);
    expect(service.listNotes(joel, {}).notes.some((n) => n.id === mine.id)).toBe(false);
  });

  /**
   * A visibility sent by a caller is not authorization, and is not kept.
   *
   * The column used to exist, be written on every note, and be read by
   * nothing — so a client could set a personal note to "leaders", be answered
   * with success, and reasonably believe it had been shared. It is gone, and
   * this pins both halves: sending it changes no access, and it is not stored
   * for some future reader to mistake for a decision.
   */
  it("ignores a visibility a caller sends, and keeps none", () => {
    const mine = service.createNote(maria, {
      ...note({ noteType: "personal", title: "Preparation" }),
      visibility: "leaders",
      participantIds: [joel.person.id],
    } as never);

    expect(() => service.getNote(joel, mine.id)).toThrow(ApiError);
    expect(() => service.getNote(bishop, mine.id)).toThrow(ApiError);
    expect(service.getNote(maria, mine.id).note).not.toHaveProperty("visibility");
  });

  it("never becomes minutes by being shared", () => {
    const mine = service.createNote(maria, note({ noteType: "personal" }));
    expect(service.getNote(maria, mine.id).note.noteType).toBe("personal");
  });
});

describe("minutes are the meeting's record", () => {
  it("are readable by the people who were there", () => {
    const minutes = service.createNote(maria, {
      ...note({ noteType: "minutes", title: "Leadership meeting" }),
      participantIds: [joel.person.id],
    });

    expect(service.getNote(joel, minutes.id).note.title).toBe("Leadership meeting");
  });

  it("are not readable by somebody who was not", () => {
    const minutes = service.createNote(maria, {
      ...note({ noteType: "minutes", title: "Leadership meeting" }),
      participantIds: [],
    });

    expect(() => service.getNote(bishop, minutes.id)).toThrow(ApiError);
  });

  /* Worth stating plainly: minutes are shared for *reading*. Writing them
     stays with whoever keeps them, which is what the note-taker is. */
  it("are written by whoever keeps them, not by everyone who can read them", () => {
    const minutes = service.createNote(maria, {
      ...note({ noteType: "minutes" }),
      participantIds: [joel.person.id],
    });

    expect(() => service.updateNote(joel, minutes.id, { title: "Mine now" })).toThrow(ApiError);
  });
});

describe("a task follows the person it was given to", () => {
  const assigned = () => {
    const minutes = service.createNote(maria, {
      ...note({ noteType: "minutes" }),
      participantIds: [joel.person.id],
    });
    const task = service.createTask(maria, {
      meetingId: minutes.id,
      title: "Confirm the venue",
      assigneeId: joel.person.id,
      dueDate: "2026-09-15",
    });
    return { minutes, task };
  };

  it("can be completed by its assignee, who does not keep the note", () => {
    const { task } = assigned();
    const done = service.updateTask(joel, task.id, { status: "done" });
    expect(done.status).toBe("done");
  });

  it("cannot be touched by somebody it was not given to", () => {
    const { task } = assigned();
    expect(() => service.updateTask(bishop, task.id, { status: "done" })).toThrow(ApiError);
  });

  it("reaches the assignee's own workspace, with where it came from", () => {
    const { task } = assigned();
    const mine = service.myTasks(joel);

    expect(mine).toHaveLength(1);
    expect(mine[0]?.task.id).toBe(task.id);
    expect(mine[0]?.contextLabel).toBeTruthy();
    expect(mine[0]?.readable).toBe(true);
  });

  /**
   * The case that decides whether this is safe.
   *
   * A task written into somebody's **personal** note and assigned to another
   * leader: the responsibility is theirs to know, the note is not theirs to
   * read. They get the task and a neutral label.
   */
  it("arrives without the note's title when the note is not theirs to read", () => {
    const personal = service.createNote(maria, {
      ...note({ noteType: "personal", title: "My candid thoughts about Joel" }),
    });
    service.createTask(maria, {
      meetingId: personal.id,
      title: "Ask about the rota",
      assigneeId: joel.person.id,
      dueDate: "2026-09-16",
    });

    const mine = service.myTasks(joel);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.readable).toBe(false);
    expect(mine[0]?.contextLabel).toBe("From a meeting");
    expect(JSON.stringify(mine)).not.toContain("candid");
  });

  it("is not somebody else's to see in their workspace", () => {
    assigned();
    expect(service.myTasks(bishop)).toEqual([]);
  });
});
