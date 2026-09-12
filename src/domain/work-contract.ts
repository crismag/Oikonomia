import { z } from "zod";

/**
 * What the work / review context accepts.
 *
 * The lifecycle is a set of **named actions**, not a status field a caller may
 * set. `modules/REPORTS.md`: "Not every report type needs every state" — so the
 * service decides which action is available from where, and a caller cannot
 * invent a transition by writing a status directly.
 */

export const workComment = z.object({
  workId: z.string().min(1),
  body: z.string().trim().min(1, "Write something to say."),
  target: z.string().trim().min(1).optional(),
});

export const workTransition = z.object({
  id: z.string().min(1),
  action: z.enum(["submit", "start-review", "request-changes", "acknowledge", "resolve", "reopen"]),
  /**
   * Why, in the reviewer's words.
   *
   * Required for `request-changes`: "changes requested" without saying what
   * sends a leader back to reread a thread, which is the thing this shell
   * exists to prevent.
   */
  note: z.string().trim().max(2000).optional(),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

/** Asking for a decision that has not been made yet. */
export const requestDecision = z.object({
  workId: z.string().min(1),
  summary: z.string().trim().min(1, "Say what needs deciding.").max(500),
});

export const recordDecision = z.object({
  workId: z.string().min(1),
  summary: z.string().trim().min(1, "Say what was decided.").max(500),
  /** Set when this answers a decision somebody asked for. */
  decisionId: z.string().min(1).optional(),
});
