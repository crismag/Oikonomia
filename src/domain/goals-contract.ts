import { z } from "zod";

/**
 * What Goals accepts.
 *
 * Shared by the form and the server. A goal is a sentence a leader wrote down
 * in January; the validator's job is to keep it readable back, not to make
 * setting one feel like filing a return.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "That is not a date.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "That is not a month.");

export const goalStatuses = ["active", "completed", "on-hold", "carried-forward"] as const;
export const goalUpdateKinds = ["note", "status", "completion"] as const;

/**
 * "June" and "21 May 2026" are both things the binder says.
 *
 * Precision is part of the value, so a month target never renders as the 1st
 * of that month — a day nobody chose.
 */
export const goalTarget = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("month"), value: isoMonth }),
  z.object({ precision: z.literal("date"), value: isoDate }),
]);

const binderLink = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
});

export const createGoal = z.object({
  title: z.string().trim().min(1, "Write what the goal is."),
  year: z.coerce
    .number()
    .int()
    .min(2000, "That year is too far back.")
    .max(2100, "That year is too far ahead."),
  description: z.string().trim().max(2000).optional(),
  ministryId: z.string().min(1).optional(),
  campusId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  target: goalTarget.optional(),
  links: z.array(binderLink).default([]),
});

export const updateGoal = z.object({
  title: z.string().trim().min(1, "Write what the goal is.").optional(),
  description: z.string().trim().max(2000).optional(),
  ministryId: z.string().min(1).optional(),
  campusId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  target: goalTarget.optional(),
  links: z.array(binderLink).optional(),
  /* Status moves through `complete`, `hold` and `resume`, which record why. */
});

export const addUpdate = z.object({
  goalId: z.string().min(1),
  text: z.string().trim().min(1, "Write what has happened."),
  kind: z.enum(goalUpdateKinds).default("note"),
  date: isoDate.optional(),
});

/** Goals are read a year at a time, the way the binder is. */
export const goalsForYear = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
