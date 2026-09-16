import { config } from "@/config";
import { z } from "zod";

/**
 * What Leadership Reports accepts.
 *
 * Shared by the editor and the server. Report *type* is deliberately open: the
 * known types in `leadership-report.ts` are suggestions, and a leader may type
 * any type the church actually uses. Nothing here turns that into a schema.
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

const links = z.array(z.object({ kind: z.string().min(1), id: z.string().min(1) }));

/**
 * A visibility a report may be *given*.
 *
 * Validated against the registry rather than against a frozen list, because
 * the registry is what the configuration screen offers. An enum here was the
 * exact failure the audit set out to find: the administrator adds a choice,
 * the form shows it, and the API refuses it.
 *
 * Only **active** choices may be set on a record. A deactivated one stays
 * readable wherever it is already stored — history is not rewritten — but
 * nothing new may be filed under it.
 */
const visibilityValue = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => config.options("reports.visibility").some((option) => option.id === value),
    "That is not one of the audience choices this church offers.",
  );

const contextType = z.enum([
  "lifegroup-gathering",
  "ministry",
  "meeting-note",
  "reach-out",
  "leadership",
]);

export const createReport = z.object({
  reportType: z.string().trim().min(1, "Say what kind of report this is.").max(80),
  contentSource: z.enum(["native", "linked-document"]).default("native"),
  /* A report is named once it has something in it. */
  title: z.string().trim().max(200).default(""),
  primaryDocumentId: z.string().trim().max(100).optional(),

  /*
   * Where it is being written. Metadata: it opens the source and filters a
   * list, and it grants nothing — a report written after a gathering is not
   * readable by everyone who was at the gathering.
   */
  contextType: contextType.optional(),
  contextId: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),

  /*
   * A report may be born with an audience. Writing a pastoral concern about
   * one person and *then* remembering to restrict it is the wrong order: the
   * restriction has to exist before the words do.
   */
  visibility: visibilityValue.optional(),
  audienceIds: z.array(z.string().min(1)).max(200).optional(),
  subjectId: z.string().trim().max(100).optional(),
  subjectText: z.string().trim().max(200).optional(),
  /** The author's mark. Set with the audience, before the words are shared. */
  confidential: z.boolean().optional(),
});

export const updateReport = z.object({
  title: z.string().trim().max(200).optional(),
  reportType: z.string().trim().min(1).max(80).optional(),
  reportingPeriod: z.string().trim().max(80).optional(),
  subjectText: z.string().trim().max(200).optional(),
  subjectId: z.string().trim().max(100).optional(),
  relatedText: z.string().trim().max(500).optional(),
  visibility: visibilityValue.optional(),
  audienceIds: z.array(z.string().min(1)).max(200).optional(),
  commenterIds: z.array(z.string().min(1)).max(200).optional(),
  discussionPolicy: z.enum(["disabled", "viewers", "selected"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  links: links.max(50).optional(),
  relatedDocumentIds: z.array(z.string().min(1)).max(100).optional(),
  primaryDocumentId: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  confidential: z.boolean().optional(),
});

export const setBlocks = z.object({
  id: z.string().min(1),
  blocks: blocks.max(2000),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export const addComment = z.object({
  reportId: z.string().min(1),
  body: z.string().trim().min(1, "Write something to say."),
  target: z.string().trim().min(1).optional(),
});

/**
 * A move to another status.
 *
 * It used to be one of four named actions, which meant the four names were the
 * protocol: a church could not add a stage or remove one. The target is now a
 * status this church actually offers, and what the move *does* — and who may
 * make it — is derived from that status's behaviour in
 * `planTransition`.
 */
export const transition = z.object({
  id: z.string().min(1),
  to: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => config.options("reports.statuses").some((option) => option.id === value),
      "That is not one of the stages this church uses.",
    ),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
