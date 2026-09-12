import { config } from "@/config/registry";
import type { LifegroupEntryCategory } from "./types";

/**
 * What kind of information this is — one vocabulary, for everything.
 *
 * LifeGroup entries already had categories; reports had none. Giving reports
 * their own list would have produced two words for the same thing and, worse,
 * two places to decide what "follow-up" means. So there is one set, and each
 * category declares where it may be used and whether it asks for attention.
 *
 * ## Category is not audience, and not attention
 *
 * Three separate dimensions, and collapsing them is the mistake this file
 * exists to prevent:
 *
 * - **Category** says what kind of information it is.
 * - **Audience** says who may see it — held on the record, resolved by
 *   `domain/access.ts` and by the report's own visibility.
 * - **Attention** says whether it currently needs somebody. It is derived:
 *   some categories trigger it, and an explicit ask always does.
 *
 * A confidential pastoral concern needs attention **and** is visible to almost
 * nobody. Both are true at once, and neither implies the other.
 *
 * ## Where the list comes from
 *
 * The configuration registry — `src/config/files/categories.json`, plus
 * whatever an administrator has changed or **added**. That indirection is the
 * point: a church that needs a "Safeguarding concern" category which reaches
 * leadership can have one without a code change, and it works the moment it
 * is added because nothing here compares a category to a literal.
 *
 * Nothing anywhere should ask `if (category === "attention-required")`. Ask
 * `triggersAttention(category)`.
 */

export type ReportCategory = LifegroupEntryCategory | "attention-required" | (string & {});

export interface CategoryDefinition {
  id: string;
  label: string;
  description?: string;
  /** Whether a record in this category asks somebody to look at it. */
  attentionTrigger?: boolean;
  /**
   * Where it may be used. A gathering entry and a report are different sizes
   * of thing, and "visitor" is a note about an evening rather than a report.
   */
  contexts?: ("entry" | "report")[];
  active?: boolean;
  sortOrder?: number;
}

/** Every category, including ones no longer offered — history must render. */
export const allCategories = (): CategoryDefinition[] =>
  config.get("information.categories") as unknown as CategoryDefinition[];

export function categoryById(id: string): CategoryDefinition | undefined {
  return allCategories().find((category) => category.id === id);
}

export const categoryLabelOf = (id: string): string => config.label("information.categories", id);

/**
 * Does a record in this category ask for attention?
 *
 * The only place the question is answered, and it reads the live
 * configuration — so a category an administrator added this morning, marked
 * as needing attention, behaves like one that shipped.
 */
export function triggersAttention(category: string | undefined): boolean {
  return !!category && (categoryById(category)?.attentionTrigger ?? false);
}

/** The categories offered in one place, in configured order. */
export function categoriesFor(context: "entry" | "report"): CategoryDefinition[] {
  return (config.options("information.categories") as unknown as CategoryDefinition[]).filter(
    /* A category with no contexts declared is offered everywhere: an
       administrator adding one is not asked a question the product's own
       vocabulary barely needs. */
    (category) => !category.contexts || category.contexts.includes(context),
  );
}

/** The default when nobody chooses. Information, deliberately. */
export const DEFAULT_CATEGORY = "general";

/** Categories that ask for attention, for the surfaces that project them. */
export const attentionCategories = (): string[] =>
  allCategories()
    .filter((category) => category.attentionTrigger)
    .map((category) => category.id);
