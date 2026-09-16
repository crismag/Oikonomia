import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { windowFor } from "../api/pagination";
import { PAGE_SIZE } from "@/domain/pagination";
import {
  createNote,
  createTask,
  noteQuery,
  updateNote,
  updateTask,
} from "@/domain/meeting-contract";
import { canEdit, canView } from "@/domain/authorize";
import { startingBlocks } from "@/domain/meeting";
import type { MeetingRepository, NoteValues } from "../repositories/meeting-repository";
import type { PageMeta } from "@/lib/api-envelope";
import type { MeetingNote, MeetingTask } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";
import { viewerOf } from "@/domain/viewer";
import { meetingTaskEmail } from "@/domain/email-notices";
import type { NoticeMailer } from "../notices/notice-mailer";

/**
 * Meeting Notes decisions.
 *
 * Two rules carry this module, and both live here rather than in a screen.
 *
 * **A personal note is not minutes.** A leader's own working record need not
 * represent everything that happened, and sharing it does not promote it. The
 * note type decides the default visibility and the starting blocks, and it is
 * the axis authorization turns on.
 *
 * **Filtering happens before paging.** A page of results that was filtered
 * afterwards is a page of the wrong length, and — more seriously — a list that
 * filtered for permission after paging would leak counts.
 */

export function createMeetingService(
  repo: MeetingRepository,
  /** Emails a leader given a task, when they chose that. Optional, and never fails a write. */
  mailer?: NoticeMailer,
) {
  function readable(viewer: Viewer, note: MeetingNote): boolean {
    return canView(viewer, { kind: "meeting-note", note });
  }
  const readable_ = readable;

  /**
   * Load a note this viewer may read, or refuse without confirming it exists.
   *
   * A note they may not read and a note that is not there are the same answer
   * on purpose: a personal note's *existence* is part of what is private.
   */
  function require(viewer: Viewer, id: string): MeetingNote {
    const note = repo.findNote(id);
    if (!note || !readable(viewer, note)) throw ApiError.notFound("That meeting note");
    return note;
  }

  /** The latest readable meeting of the same type held before this one. */
  function previousInSeries(viewer: Viewer, note: MeetingNote): MeetingNote | undefined {
    if (!note.type) return undefined;
    return repo
      .listNotes(
        {
          readableBy: viewer.person.id,
          meetingType: note.type,
          before: note.date,
          excludeId: note.id,
        },
        1,
        0,
      )
      .find((candidate) => readable(viewer, candidate));
  }

  function requireWritable(viewer: Viewer, id: string): MeetingNote {
    const note = require(viewer, id);
    if (!canEdit(viewer, { kind: "meeting-note", note })) {
      /* They can see it, so hiding it now would only confuse. */
      throw ApiError.forbidden("This note belongs to whoever wrote it.");
    }
    return note;
  }

  /**
   * Tell somebody, by email if they want it, that they were given a task.
   *
   * Only when the task names somebody other than the person saving it — a
   * leader writing their own task is not news, and the mailer refuses the
   * actor anyway. The meeting is named, and linked, only when the recipient
   * may read the note; otherwise the email says "a meeting" and links to the
   * task's day on their week, as the bell does.
   */
  function emailTheAssignee(viewer: Viewer, task: MeetingTask): void {
    if (!mailer || !task.assigneeId || task.assigneeId === viewer.person.id) return;
    try {
      const note = repo.findNote(task.meetingId);
      mailer.notify({
        kind: "meeting-task",
        actorId: viewer.person.id,
        recipientIds: [task.assigneeId],
        compose: ({ recipient, actor, base }) => {
          const readable =
            !!note &&
            canView(viewerOf(recipient), {
              kind: "meeting-note",
              note,
            });
          return meetingTaskEmail({
            base,
            assignerName: actor?.name ?? viewer.person.name,
            title: task.title,
            ...(readable && note ? { meetingTitle: note.title || "Untitled meeting" } : {}),
            ...(task.dueDate ? { dueDate: task.dueDate } : {}),
            link: readable
              ? { to: "/meeting-notes", search: { note: task.meetingId } }
              : {
                  to: "/weekly-agenda",
                  ...(task.dueDate ? { search: { date: task.dueDate } } : {}),
                },
          });
        },
      });
    } catch (error) {
      console.error(
        "[notices] meeting task email not sent:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    /**
     * A page of notes this viewer may read.
     *
     * Readability is part of the query, not a pass over its results. Filtering
     * afterwards would return a page shorter than it claims and — the reason
     * it matters — a `total` that tells a viewer how many notes exist that
     * they may not read. "68 meeting notes" shown to someone who may read two
     * is a leak, however carefully the two are chosen.
     *
     * `canView` is then applied anyway. It is redundant when the SQL is right,
     * and it is the thing that stays right if the SQL ever is not.
     */
    listNotes(
      viewer: Viewer,
      input: unknown,
    ): { notes: MeetingNote[]; page: PageMeta; facets: { tags: string[]; ministryIds: string[] } } {
      const query = parse(noteQuery, input);
      const filters = {
        search: query.search,
        noteType: query.noteType,
        tag: query.tag,
        ministryId: query.ministryId,
        personId: query.personId,
        /* Readability narrows the query, so the count is the viewer's count. */
        readableBy: viewer.person.id,
      };

      const total = repo.countNotes(filters);
      /* The schema defaults both; `parse`'s generic cannot see through a Zod
         default, so the fallbacks restate it rather than assert past it. */
      const { limit, offset, meta } = windowFor(
        { page: query.page ?? 1, pageSize: query.pageSize ?? PAGE_SIZE },
        total,
      );

      const notes = repo.listNotes(filters, limit, offset).filter((n) => readable(viewer, n));

      /* Filter options describe everything readable, not this page — see
         `facets` in the repository. */
      return { notes, page: meta, facets: repo.facets({ readableBy: viewer.person.id }) };
    },

    /**
     * A note, its tasks, and the meeting before it in its series.
     *
     * The earlier meeting is looked for in the database, among notes this
     * viewer may read. Finding it among whatever page of the list happened to
     * be loaded missed it whenever it was on another page or outside a search,
     * and "what was left open last time" is a question about the notebook, not
     * about the screen.
     */
    getNote(
      viewer: Viewer,
      id: string,
    ): {
      note: MeetingNote;
      tasks: MeetingTask[];
      previous?: { note: MeetingNote; tasks: MeetingTask[] };
    } {
      const note = require(viewer, id);
      const previous = previousInSeries(viewer, note);
      return {
        note,
        tasks: repo.tasksFor([note.id]),
        ...(previous ? { previous: { note: previous, tasks: repo.tasksFor([previous.id]) } } : {}),
      };
    },

    /** Tasks belonging to notes the viewer may read, for a list's counts. */
    tasksForNotes(viewer: Viewer, ids: string[]): MeetingTask[] {
      const allowed = ids.filter((id) => {
        const note = repo.findNote(id);
        return !!note && readable(viewer, note);
      });
      return repo.tasksFor(allowed);
    },

    /**
     * Start a note.
     *
     * The type decides the starting shape: minutes open with the headings a
     * meeting record needs, a personal note opens with a blank line. Neither
     * is a template the leader has to fill in — both are editable away.
     */
    createNote(viewer: Viewer, input: unknown): MeetingNote {
      const values = parse(createNote, input);
      return repo.insertNote({
        ...values,
        blocks:
          values.blocks && values.blocks.length > 0
            ? values.blocks
            : startingBlocks(values.noteType),
        authorId: values.authorId ?? viewer.person.id,
      } as NoteValues);
    },

    /**
     * Save a note, unless somebody else already did.
     *
     * The caller states which version it was editing. An `expectedVersion` of
     * `undefined` means "I did not check" and writes anyway — kept for callers
     * that have no version to offer, and never used by the editor.
     */
    updateNote(viewer: Viewer, id: string, input: unknown, expectedVersion?: number): MeetingNote {
      const note = requireWritable(viewer, id);
      const patch = parse(updateNote, input);

      const {
        id: _id,
        createdAt: _created,
        updatedAt: _updated,
        version: _version,
        ...rest
      } = note;

      const saved = repo.saveNote(
        id,
        { ...rest, ...patch } as NoteValues,
        expectedVersion ?? note.version ?? 1,
      );

      if (saved === "stale") {
        throw ApiError.conflict(
          "This note was changed somewhere else while you were writing. Reopen it to see the current version.",
        );
      }
      if (!saved) throw ApiError.notFound("That meeting note");
      return saved;
    },

    deleteNote(viewer: Viewer, id: string): void {
      requireWritable(viewer, id);
      repo.deleteNote(id);
    },

    /* ------------------------------------------------------------- tasks */

    /**
     * A task that came out of a meeting.
     *
     * Its own record, because it outlives the document: it gets assigned,
     * tracked and surfaced elsewhere, and editing the sentence it came from
     * must not delete it.
     */
    createTask(viewer: Viewer, input: unknown): MeetingTask {
      const values = parse(createTask, input);
      requireWritable(viewer, values.meetingId);
      const task = repo.insertTask({
        ...values,
        status: "open",
        createdAt: new Date().toISOString(),
      });
      emailTheAssignee(viewer, task);
      return task;
    },

    updateTask(viewer: Viewer, id: string, input: unknown): MeetingTask {
      const existing = repo.findTask(id);
      if (!existing) throw ApiError.notFound("That task");

      /*
       * Whoever the task was given to may move it, as well as whoever keeps
       * the note.
       *
       * Without this, a leader could be assigned something in a meeting they
       * did not minute and then be unable to say they had done it — the task
       * would sit open until its author remembered to tick it, which is how a
       * task list stops being believed.
       */
      const mine = existing.assigneeId === viewer.person.id;
      if (!mine) requireWritable(viewer, existing.meetingId);

      const patch = parse(updateTask, input);
      const { id: _id, ...rest } = existing;
      /* `title` and `status` are required; a patch that omits them keeps them. */
      const saved = repo.saveTask(id, {
        ...rest,
        ...patch,
        title: patch.title ?? existing.title,
        status: patch.status ?? existing.status,
      });
      if (!saved) throw ApiError.notFound("That task");
      /* Only a change of hands is news; editing a task's title is not. */
      if (saved.assigneeId && saved.assigneeId !== existing.assigneeId) {
        emailTheAssignee(viewer, saved);
      }
      return saved;
    },

    /**
     * Every task assigned to this leader, wherever it came from.
     *
     * The task travels; the meeting's content does not. A task from a note
     * they may not read arrives with a neutral label, because what they have
     * been asked to do is theirs to know and the note is not.
     */
    myTasks(viewer: Viewer): {
      task: MeetingTask;
      contextLabel: string;
      readable: boolean;
      /** Written into a note this leader wrote or took down themselves. */
      byYou: boolean;
    }[] {
      return repo.tasksAssignedTo(viewer.person.id).map((task) => {
        const note = repo.findNote(task.meetingId);
        const readable = !!note && readable_(viewer, note);
        return {
          task,
          contextLabel: readable ? note!.title || "Untitled meeting" : "From a meeting",
          readable,
          /* Whether somebody else gave it to them — which is what makes it
             news. Tasks a leader writes for themselves are not. */
          byYou:
            !!note && (note.authorId === viewer.person.id || note.noteTakerId === viewer.person.id),
        };
      });
    },

    deleteTask(viewer: Viewer, id: string): void {
      const existing = repo.findTask(id);
      if (!existing) throw ApiError.notFound("That task");
      requireWritable(viewer, existing.meetingId);
      repo.deleteTask(id);
    },
  };
}

export type MeetingService = ReturnType<typeof createMeetingService>;
