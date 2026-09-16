import { z } from "zod";

/**
 * What Reach-Out accepts.
 *
 * Shared by the report editor and the server. Deliberately minimal: §11 says
 * to keep the model simple and not to impose outreach categories, so there is
 * no status, no stage, no pipeline and no outcome to record.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "That is not a date.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

export const createReport = z.object({
  /* A report is named once it has something in it; "Weekly reach-out" is fine. */
  title: z.string().trim().max(200).default(""),
  reportDate: isoDate,
  content: z.string().max(20000).default(""),
});

export const updateReport = z.object({
  title: z.string().trim().max(200).optional(),
  reportDate: isoDate.optional(),
  content: z.string().max(20000).optional(),
});

export const addComment = z.object({
  reportId: z.string().min(1),
  body: z.string().trim().min(1, "Write something to say."),
  target: z.string().trim().min(1).optional(),
});

/** Reach-Out is a list, so it pages. */
export const reportQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Reports this person wrote first or has since worked on. */
  personId: z.string().trim().min(1).optional(),
});
