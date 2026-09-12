import { z } from "zod";

/**
 * What configuration is, and what it is allowed to be.
 *
 * Oikonomia distinguishes three things that all look like constants in source
 * code and are not the same:
 *
 * | | Example | Where it belongs |
 * | --- | --- | --- |
 * | Application constant | an HTTP status, a schema version | in the code that needs it |
 * | **Configuration** | the report statuses, the week's start day | here |
 * | Organisational record | the Music Ministry, a person named Cris | the database |
 *
 * The test is: *could another church legitimately want a different value
 * without changing how Oikonomia works?* If yes, it is configuration. If the
 * value **is** part of that church rather than a choice about behaviour, it is
 * a record and belongs in a table — `config/` must never become a second
 * database.
 *
 * ## Ids are not labels
 *
 * Every option has a stable `id` and an editable `label`, and nothing but the
 * `id` is ever stored, compared or sent. An administrator renaming "In
 * progress" to "Currently working" must not break a single historical record,
 * and that is only possible if the label was never the identity.
 *
 * ## Meaning, not presentation
 *
 * A status carries a **semantic state** — `done`, `warning`, `danger` — never a
 * colour or a class name. What amber looks like is the design system's
 * question, and configuration that answered it would scatter design decisions
 * through the church's settings.
 */

/** The five states the interface knows how to express. */
export const semanticStates = ["neutral", "info", "success", "warning", "danger"] as const;
export type SemanticState = (typeof semanticStates)[number];

/**
 * A stable identifier.
 *
 * Lower case, no spaces: it travels into databases, URLs and APIs, and it is
 * the one thing about an option that may never change.
 */
const id = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "An id is lower case with hyphens: `in-progress`, not `In Progress`.",
  );

export const optionSchema = z.object({
  id,
  /** What people see. Editable, translatable, never an identifier. */
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  /**
   * Deactivated rather than deleted.
   *
   * A category with three hundred historical entries behind it must not be
   * removable — the records would lose their meaning. Inactive options stop
   * being offered and keep rendering what already refers to them.
   */
  active: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
});

export type OptionDefinition = z.infer<typeof optionSchema>;

export const statusSchema = optionSchema.extend({
  semanticState: z.enum(semanticStates).default("neutral"),
  /** True when nothing follows it: the record has reached its end. */
  terminal: z.boolean().default(false),
});

export type StatusDefinition = z.infer<typeof statusSchema>;

/* ----------------------------------------------- access: capability + option */

/**
 * The access strategies the application knows how to enforce.
 *
 * **A closed set, owned by the code.** This is the line the configuration
 * platform must never cross: an administrator chooses *which* strategy an
 * audience option uses and what it is called, and the application owns what
 * each strategy actually does. Anything else would be a security system edited
 * through a settings form.
 *
 * | Strategy | Who can read |
 * | --- | --- |
 * | `owner-only` | its author, and nobody else |
 * | `named-people` | its author and the people explicitly named on the record |
 * | `leadership-groups` | the named leadership audience groups |
 * | `organization` | ordinary organisational reading |
 */
/**
 * The permissions the application actually enforces.
 *
 * Restated here as strings rather than imported from `domain/capabilities`,
 * because configuration must not depend on the domain — the domain depends on
 * configuration. `roles-are-not-permissions.test.ts` fails if the two lists
 * ever disagree.
 */
export const knownCapabilities = [
  "campus-oversight",
  "cross-ministry-oversight",
  "administration",
] as const satisfies readonly string[];

export const accessStrategies = [
  "owner-only",
  "named-people",
  "leadership-groups",
  "organization",
] as const;
export type AccessStrategy = (typeof accessStrategies)[number];

/**
 * An audience choice a report's author may pick.
 *
 * The label and the description are the church's. `accessStrategy` names one
 * of the capabilities above, and is the only part that decides anything.
 */
/**
 * An access role: a named bundle of capabilities.
 *
 * Unknown capabilities are **dropped rather than rejected**, for the same
 * reason an unrecognised access strategy resolves to the narrowest one: a
 * bundle naming a permission this build does not implement must grant nothing,
 * not take the installation down. The administration screen only ever offers
 * capabilities that exist, so a dropped one means a downgrade or a hand-edited
 * row.
 */
export const roleOptionSchema = optionSchema.extend({
  capabilities: z
    .array(z.string())
    .default([])
    /* Filtered and de-duplicated: a bundle is a set. Holding a permission
       twice is not holding it more, and a duplicate makes a later removal look
       as though it did nothing. */
    .transform((values) => [
      ...new Set(
        values.filter((value) => (knownCapabilities as readonly string[]).includes(value)),
      ),
    ]),
});

export type RoleOptionDefinition = z.infer<typeof roleOptionSchema>;

export const audienceOptionSchema = optionSchema.extend({
  accessStrategy: z.enum(accessStrategies),
});

export type AudienceOptionDefinition = z.infer<typeof audienceOptionSchema>;

/**
 * How a gathering entry's audience is enforced.
 *
 * The same shape as `accessStrategies`, and separate from it on purpose: an
 * entry lives inside a gathering, so its audiences are the ones that gathering
 * has — its assigned leaders, the leaders generally — and none of those mean
 * anything to a leadership report. One shared list would offer each place
 * choices the other cannot honour, which is a control that looks operational
 * and is not.
 */
export const entryStrategies = [
  "author-only",
  "named-viewers",
  "gathering-leaders",
  "all-leaders",
] as const;
export type EntryStrategy = (typeof entryStrategies)[number];

export const entryOptionSchema = optionSchema.extend({
  entryStrategy: z.enum(entryStrategies),
});

export type EntryOptionDefinition = z.infer<typeof entryOptionSchema>;

/**
 * What a status *means*, so that code stops asking what it is *called*.
 *
 * `status === "published"` is the coupling this replaces: it made a
 * configured word into application protocol, so renaming it was unsafe and
 * adding another was meaningless. Code asks these questions instead.
 */
export const statusBehaviorSchema = z.object({
  /** May the record's content still be changed? */
  editable: z.boolean(),
  /** Is this the submitted record — content frozen, discussion open? */
  final: z.boolean(),
  /** Does it count as current work rather than history? */
  current: z.boolean(),
  /** Has it reached its audience? */
  visibleToAudience: z.boolean(),
});

export type StatusBehavior = z.infer<typeof statusBehaviorSchema>;

/** A status that carries its meaning with it. */
export const behavioralStatusSchema = statusSchema.extend({
  behaviors: statusBehaviorSchema,
});

export type BehavioralStatusDefinition = z.infer<typeof behavioralStatusSchema>;

/** A list of options, checked for the mistakes that make configuration lie. */
export function optionList<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(item)
    .min(1, "A list of options with nothing in it would offer nothing.")
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      for (const value of values as { id: string }[]) {
        if (seen.has(value.id)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate id "${value.id}". Two options sharing an id are one option with two labels.`,
          });
        }
        seen.add(value.id);
      }
    });
}

/* --------------------------------------------------------------- namespaces */

export const siteSchema = z.object({
  /** The product. Not the church — see `organization`. */
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(200).optional(),
  /** IANA zone. Every date the application shows is read in this. */
  timezone: z.string().trim().min(1),
  locale: z.string().trim().min(2),
  /** 0 = Sunday. The binder's week starts where the church's week starts. */
  weekStartsOn: z.number().int().min(0).max(6),
  dateFormat: z.string().trim().min(1),
  timeFormat: z.string().trim().min(1),
  pageSize: z.number().int().min(5).max(200),
  supportContact: z.string().trim().max(200).optional(),
});

export const cadenceSchema = z.object({
  /** How many days before a deadline the binder starts saying "due soon". */
  warnWithinDays: z.number().int().min(0).max(30),
  /** How long typing settles before a draft is written. Milliseconds. */
  autosaveDelayMs: z.number().int().min(100).max(5000),
  /** How many periods a trend or consistency view looks back over. */
  trendPeriods: z.number().int().min(2).max(24),
});

export type SiteConfig = z.infer<typeof siteSchema>;
export type CadenceConfig = z.infer<typeof cadenceSchema>;
