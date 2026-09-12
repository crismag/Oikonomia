import type { BinderSection, ResourceAssociation } from "./types";

/**
 * What to call the binder's sections.
 *
 * Searching used to live here, as a read projection over three fixture arrays.
 * It is now the document registry's — `server/services/document-service.ts` —
 * and what is left is the vocabulary the rest of the application shares with
 * it: a leader looks for "the Music Ministry planning sheet", so the section a
 * resource takes part in is how results are placed, and where the bytes happen
 * to live is never the organizing idea.
 */

/* --------------------------------------------------------- section labels */

export const sectionLabel: Record<BinderSection, string> = {
  "weekly-agenda": "Weekly Agenda",
  "monthly-calendar": "Monthly Calendar",
  "meeting-notes": "Meeting Notes",
  ministry: "Ministry",
  lifegroup: "LifeGroup",
  "reach-out": "Reach-Out",
  "leadership-reports": "Leadership Reports",
  "documents-forms": "Documents & Forms",
};

export const binderSections = Object.keys(sectionLabel) as BinderSection[];

/** "Ministry › Music Ministry", "LifeGroup › Thomson Park › 3 Sep". */
export function contextPath(association: ResourceAssociation): string {
  return [sectionLabel[association.section], association.label, association.secondaryLabel]
    .filter(Boolean)
    .join(" › ");
}
