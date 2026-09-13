import { z } from "zod";

import { webAddress } from "./web-address";

/**
 * What the calendar accepts.
 *
 * One definition of a valid entry, shared by the form and the server, so the
 * two can never drift into disagreeing about what "valid" means. §21 still
 * holds: the frontend validates to be helpful and the **server is
 * authoritative** — it re-parses everything it is sent, because a request need
 * not have come from a screen.
 *
 * Messages are written for the leader who will read them.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "That is not a date.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 19:30.");

export const scheduleCategories = [
  "prayer-fasting",
  "chat",
  "lifegroup",
  "potbless",
  "victuals",
  "seed",
  "mentorship",
  "ministry-meeting",
  "service",
  "celebration",
  "other",
] as const;

export const reminderOffsets = ["at-time", "10m", "30m", "1h", "1d"] as const;
export const recurrenceFrequencies = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "yearly",
] as const;
export const scheduleSources = ["leader", "ministry", "lifegroup", "church", "event"] as const;
export const recurrenceScopes = ["occurrence", "following", "series"] as const;

export const recurrenceInput = z.object({
  frequency: z.enum(recurrenceFrequencies),
  weekday: z.number().int().min(0).max(6).optional(),
  from: isoDate,
  until: isoDate.optional(),
  skip: z.array(isoDate).optional(),
});

const binderLink = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
});

/**
 * The fields of an entry, before the rules *between* fields are applied.
 *
 * A title and a day are the whole requirement — "Friday, 7:30, CHAT" is a
 * complete thought, and §7's own list is everything-else-optional. The binder
 * works because writing in it is fast.
 */
const entryFields = {
  title: z.string().trim().min(1, "Give it a title."),
  date: isoDate.optional(),
  recurrence: recurrenceInput.optional(),
  startTime: clockTime.optional(),
  endTime: clockTime.optional(),
  allDay: z.boolean().optional(),
  category: z.enum(scheduleCategories).default("other"),
  ministryId: z.string().min(1).optional(),
  location: z.string().trim().max(200).optional(),
  meetingUrl: webAddress("That does not look like a link.").optional(),
  note: z.string().trim().max(4000).optional(),
  reminders: z.array(z.enum(reminderOffsets)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  participantIds: z.array(z.string().min(1)).optional(),
  related: z.array(binderLink).optional(),
  organizerId: z.string().min(1).optional(),
  source: z.enum(scheduleSources).optional(),
  relatedWorkId: z.string().min(1).optional(),
};

/**
 * The rules that involve more than one field.
 *
 * These are the ones a form cannot express with per-field validators, and the
 * ones the database's CHECK constraint would otherwise report as an
 * unreadable constraint failure.
 */
function crossFieldRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((v: { date?: string; recurrence?: unknown }) => !!v.date !== !!v.recurrence, {
      message: "An entry is either on a date or repeats — not both, and not neither.",
      path: ["date"],
    })
    .refine(
      (v: { startTime?: string; endTime?: string }) =>
        !v.startTime || !v.endTime || v.endTime > v.startTime,
      { message: "The end time is before the start.", path: ["endTime"] },
    )
    .refine((v: { allDay?: boolean; startTime?: string }) => !(v.allDay && v.startTime), {
      message: "An all-day entry has no start time.",
      path: ["startTime"],
    });
}

export const createEntry = crossFieldRules(z.object(entryFields));
export type CreateEntryInput = z.input<typeof createEntry>;

/**
 * A patch names only what changes, so every field is optional — but the rules
 * between fields still apply to the *result*, which is why the service merges
 * the patch onto the stored entry and re-parses the whole thing with
 * `entryAfterPatch`.
 */
export const updateEntry = z.object({
  title: entryFields.title.optional(),
  date: entryFields.date,
  recurrence: entryFields.recurrence,
  startTime: entryFields.startTime,
  endTime: entryFields.endTime,
  allDay: entryFields.allDay,
  /* `.default()` on a patch would reset a field nobody touched. */
  category: entryFields.category.removeDefault().optional(),
  ministryId: entryFields.ministryId,
  location: entryFields.location,
  meetingUrl: entryFields.meetingUrl,
  note: entryFields.note,
  reminders: entryFields.reminders,
  tags: entryFields.tags,
  participantIds: entryFields.participantIds,
  related: entryFields.related,
  organizerId: entryFields.organizerId,
  source: entryFields.source,
  relatedWorkId: entryFields.relatedWorkId,
});

export const entryAfterPatch = crossFieldRules(z.object(entryFields));

export const createAgendaItem = z
  .object({
    text: z.string().trim().min(1, "Write what you need to do."),
    date: isoDate.optional(),
    weekOf: isoDate.optional(),
    category: z.enum(scheduleCategories).optional(),
    ministryId: z.string().min(1).optional(),
    relatedEntryId: z.string().min(1).optional(),
    dueAt: isoDate.optional(),
    assigneeId: z.string().min(1).optional(),
  })
  .refine((v) => !!v.date || !!v.weekOf, {
    message: "File it on a day, or on the week.",
    path: ["date"],
  });

export const updateAgendaItem = z.object({
  text: z.string().trim().min(1, "Write what you need to do.").optional(),
  date: isoDate.optional(),
  weekOf: isoDate.optional(),
  completed: z.boolean().optional(),
  category: z.enum(scheduleCategories).optional(),
  ministryId: z.string().min(1).optional(),
  relatedEntryId: z.string().min(1).optional(),
  dueAt: isoDate.optional(),
  assigneeId: z.string().min(1).optional(),
});

/**
 * What a calendar screen asks for.
 *
 * A range, not a page. The month grid needs the month and the week view needs
 * the week; paging a calendar would mean paging time, which is not a thing a
 * leader does. `listQuery` and its `page`/`pageSize` belong to lists, and the
 * calendar is not one.
 */
export const entryRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: "The range ends before it starts.", path: ["to"] });

export type EntryRange = z.infer<typeof entryRange>;
