import { z } from "zod";

import { documentEntityTypes } from "./registry";
import { webAddress } from "./web-address";

/**
 * What the registry accepts.
 *
 * Shared by the register dialog and the server, so a leader and the database
 * never disagree about what a valid record is.
 */

const entityType = z.enum(documentEntityTypes as [string, ...string[]]);
const relationship = z.enum(["filed-in", "supporting", "report-content"]);

/**
 * Registering a resource.
 *
 * A title and where it is. Everything else is optional, because a leader
 * registering the ministry's planning sheet at the end of a meeting should not
 * have to complete a metadata form to do it.
 *
 * `url` is required: the only resources a leader can register today are ones
 * kept somewhere else. The binder never stores a file: an upload goes straight
 * to Google Drive (`drive-service.ts`) and is registered from there.
 */
export const registerDocument = z.object({
  title: z.string().trim().min(1, "Give it a name you would look for it by.").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  kind: z.string().trim().min(1).max(60).default("Document"),
  url: webAddress("That does not look like a web address."),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  associations: z
    .array(
      z.object({
        entityType,
        entityId: z.string().trim().max(100).default(""),
        relationship: relationship.default("filed-in"),
      }),
    )
    .max(20)
    .default([]),
});

/**
 * Starting a document the binder itself keeps.
 *
 * A ministry, and what kind of thing this is. No address, because this one does
 * not live anywhere else — the binder is where it lives.
 */
export const createBinderDocument = z.object({
  ministryId: z.string().trim().min(1, "A document belongs to a ministry."),
  kind: z.enum(["Plan", "Report", "Announcement", "Checklist", "Update"]),
  /* Untitled is a real state: a leader names a plan once it has something in
     it, not before they are allowed to start writing. */
  title: z.string().trim().max(200).default(""),
});

/** Metadata only. The resource itself is somebody else's to change. */
export const updateDocument = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  kind: z.string().trim().min(1).max(60).optional(),
  url: webAddress("That does not look like a web address.").optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

/** What a binder-native document says. Blocks, as the editor writes them. */
export const saveContent = z.object({
  documentId: z.string().min(1),
  blocks: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        html: z.string().max(20000),
        checked: z.boolean().optional(),
        state: z.string().optional(),
        taskId: z.string().optional(),
      }),
    )
    .max(1000),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export const associateDocument = z.object({
  documentId: z.string().min(1),
  entityType,
  entityId: z.string().trim().max(100).default(""),
  relationship: relationship.default("filed-in"),
});

/**
 * What search accepts.
 *
 * Paged, because withholding has to happen before the count — a total that
 * includes resources the viewer may not know about is a leak whether or not
 * their titles are shown.
 */
export const resourceQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  section: z.string().trim().optional(),
  relatedLabel: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  addedById: z.string().trim().optional(),
  since: z.string().trim().optional(),
  sort: z.enum(["relevance", "updated", "title"]).optional(),
});
