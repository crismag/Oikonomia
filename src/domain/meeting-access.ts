import { canEdit } from "./authorize";
import type { MeetingNote, MeetingTask } from "./types";
import type { Viewer } from "./viewer";

/*
 * Kept apart from `meeting.ts`, which `authorize.ts` reaches through
 * `leadership-report.ts`: importing the rules into the document helpers would
 * make the two modules load each other.
 */

/**
 * Whether this viewer may change the note — the rule the server enforces.
 *
 * A participant may read minutes and may not change them. The page used to
 * offer every field anyway and let the save fail, which is a page that lies
 * until you type. Asking `canEdit` here, the same question the meeting service
 * asks, keeps the page and the server from disagreeing.
 */
export const mayChangeNote = (viewer: Viewer, note: MeetingNote): boolean =>
  canEdit(viewer, { kind: "meeting-note", note });

/**
 * Whether this viewer may tick a task done or open again.
 *
 * Whoever keeps the note, and whoever the task was given to — a leader asked to
 * do something in a meeting they did not minute can still say they did it.
 */
export const mayCompleteTask = (
  viewer: Viewer,
  note: MeetingNote,
  task: Pick<MeetingTask, "assigneeId">,
): boolean => task.assigneeId === viewer.person.id || mayChangeNote(viewer, note);

/** Said on a note the viewer may read and not change. */
export const readOnlyReason =
  "You can read these minutes. Only whoever wrote them or took them down can change them.";
