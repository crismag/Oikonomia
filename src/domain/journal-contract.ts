import { z } from "zod";

/**
 * What the leadership journal accepts.
 *
 * The shape of the sharing step is the part worth reading: a summary names the
 * **blocks** a leader chose, not the entry. Sharing a journal entry wholesale
 * is exactly the thing the boundary exists to prevent.
 */

const blocks = z.array(
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    html: z.string().max(40000),
    checked: z.boolean().optional(),
    state: z.string().optional(),
    taskId: z.string().optional(),
  }),
);

export const createEntry = z.object({
  /* Untitled is a real state: a leader names a reflection once it has something
     in it, not before they are allowed to start writing. */
  title: z.string().trim().max(200).default(""),
});

export const writeEntry = z.object({
  id: z.string().min(1),
  blocks: blocks.max(2000),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export const renameEntry = z.object({
  id: z.string().min(1),
  title: z.string().trim().max(200),
});

/**
 * Selecting what belongs in an accountability summary.
 *
 * The chosen lines are **copied** into a new Leadership Report. Not referenced:
 * a reference would make the report a door into the journal, and the whole
 * point is that a derived report never opens the rest.
 */
export const summarize = z.object({
  entryId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1, "Choose what belongs in the summary."),
  title: z.string().trim().max(200).default(""),
  reportType: z.string().trim().min(1).max(80).default("leadership-development"),
});
