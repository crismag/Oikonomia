import { z } from "zod";

import { config } from "@/config";

/**
 * What LifeGroup accepts.
 *
 * Shared by the gathering editor, the attendance sheet and the server. The
 * shape is strict about *who* and *when* and permissive about what a leader
 * writes: somebody recording a gathering in the room must never be stopped by
 * a validator.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "That is not a date.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 19:30.");

export const gatheringStatuses = ["planned", "open", "completed", "cancelled"] as const;
export const attendanceStatuses = ["present", "absent", "excused"] as const;
/**
 * The audience choices this church currently offers for an entry.
 *
 * A refinement rather than a `z.enum` of the four that shipped, for the reason
 * the configuration audit kept finding: the administrator adds a choice, the
 * form offers it, and the API refuses it. Only **active** choices may be set;
 * a deactivated one stays readable wherever it is already stored.
 */
const entryVisibilityValue = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => config.options("lifegroup.entryVisibility").some((option) => option.id === value),
    "That is not one of the audience choices this church offers.",
  );
export const entryCategories = [
  "general",
  "highlight",
  "concern",
  "prayer",
  "follow-up",
  "visitor",
  "decision",
  "action",
] as const;

/**
 * A new row on the schedule.
 *
 * **A date and nothing else is enough.** The schedule is a roster several
 * leaders fill in together — "Tuesday, Markham, leader needed" is a real row —
 * so venue and leaders are settled afterwards, inline. Requiring them here is
 * what made adding a gathering a form to complete rather than a line to add.
 */
export const createGathering = z
  .object({
    date: isoDate,
    startTime: clockTime.optional(),
    endTime: clockTime.optional(),
    venueId: z.string().min(1).optional(),
    hostId: z.string().min(1).optional(),
    campusId: z.string().min(1).optional(),
    assignedLeaderIds: z.array(z.string().min(1)).optional(),
    expectedAttendeeIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    message: "The end time is before the start.",
    path: ["endTime"],
  });

/** When, where and who leads — never what the gathering recorded. */
export const updateGathering = z.object({
  date: isoDate.optional(),
  startTime: clockTime.optional(),
  endTime: clockTime.optional(),
  venueId: z.string().min(1).optional(),
  hostId: z.string().min(1).optional(),
  /* May be emptied: a gathering whose leaders have all stepped away goes back
     to needing one, rather than keeping a name that is no longer true. */
  assignedLeaderIds: z.array(z.string().min(1)).optional(),
  primaryLeaderId: z.string().min(1).optional(),
  expectedAttendeeIds: z.array(z.string().min(1)).optional(),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(["planned", "assigned", "confirmed", "open", "completed", "cancelled"]).optional(),
});

/**
 * Putting your own name against a gathering, or taking it off.
 *
 * Its own operation, deliberately separate from `updateGathering`: joining is
 * something any leader may do and assigning somebody else is not, so they must
 * not share a code path where the difference could be lost.
 */
export const joinGathering = z.object({
  gatheringId: z.string().min(1),
  action: z.enum(["claim", "join", "leave"]),
});

export const markAttendance = z.object({
  gatheringId: z.string().min(1),
  personId: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  status: z.enum(attendanceStatuses),
  expected: z.boolean().optional(),
  firstTime: z.boolean().optional(),
});

export const setExhortation = z.object({
  gatheringId: z.string().min(1),
  /* Clearing the topic clears the exhortation, which is why "" is allowed. */
  topic: z.string().trim().max(200),
  scripture: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),
  givenById: z.string().min(1).optional(),
});

export const addEntry = z.object({
  gatheringId: z.string().min(1),
  body: z.string().trim().min(1, "Write what is worth remembering."),
  category: z.enum(entryCategories).optional(),
  visibility: entryVisibilityValue.optional(),
  viewerIds: z.array(z.string().min(1)).optional(),
});

export const updateEntry = z.object({
  body: z.string().trim().min(1, "Write what is worth remembering.").optional(),
  category: z.enum(entryCategories).optional(),
  visibility: entryVisibilityValue.optional(),
  viewerIds: z.array(z.string().min(1)).optional(),
  personId: z.string().min(1).optional(),
  assignedTo: z.string().min(1).optional(),
  dueDate: isoDate.optional(),
  completed: z.boolean().optional(),
  reportable: z.boolean().optional(),
});

export const setSummary = z.object({
  gatheringId: z.string().min(1),
  summary: z.string().trim().max(4000),
});

/** Gatherings are read around a date, the way a leader looks at their weeks. */
export const gatheringRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: "The range ends before it starts.", path: ["to"] });
