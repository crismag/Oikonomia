import cadenceFile from "./files/cadence.json";
import goalsFile from "./files/goals.json";
import lifegroupFile from "./files/lifegroup.json";
import meetingsFile from "./files/meetings.json";
import reportsFile from "./files/reports.json";
import siteFile from "./files/site.json";
import workFile from "./files/work.json";
import categoriesFile from "./files/categories.json";
import organizationFile from "./files/organization.json";
import rolesFile from "./files/roles.json";

/**
 * Where configuration starts.
 *
 * **Files are the bootstrap, not the storage.** These JSON files are what a
 * new installation has before anybody has configured anything. An
 * administrator's changes are stored in the database and laid over the top —
 * see `overrides.ts` — so a file is a starting point that stays readable in
 * source control, and never the thing that has to be edited to rename a
 * status.
 *
 * JSON rather than YAML on purpose: the application already parses it, the
 * bundler already understands it, and configuration that needs a new
 * dependency to be read is configuration that can fail to load.
 *
 * Nothing in here names a person, a ministry or a campus. Those are records.
 */

export const fileSources = {
  "site.profile": siteFile,
  "site.cadence": cadenceFile,
  "reports.statuses": reportsFile.statuses,
  "reports.visibility": reportsFile.visibility,
  "work.statuses": workFile.statuses,
  "goals.statuses": goalsFile.statuses,
  "lifegroup.attendance": lifegroupFile.attendance,
  "lifegroup.gatheringStatuses": lifegroupFile.gatheringStatuses,
  "lifegroup.entryVisibility": lifegroupFile.entryVisibility,
  "meetings.types": meetingsFile.types,
  "meetings.noteTypes": meetingsFile.noteTypes,

  /*
   * Categories are a file, and deliberately so: an administrator may add one,
   * and what it *does* — whether it asks for attention — travels with it.
   * `domain/categories.ts` reads them back through the registry, so an added
   * category behaves like one that shipped.
   *
   * Access roles are a file like the rest. A role is a **named bundle of
   * capabilities**, so both its name and its bundle are an administrator's to
   * change — what stays in code is the closed set of capabilities a bundle may
   * draw from (`domain/capabilities.ts`), because each one is a rule somebody
   * wrote. This file must not import from `@/domain`: the domain reads
   * configuration, not the other way round.
   */
  "information.categories": categoriesFile,
  "people.roles": rolesFile,

  /*
   * What kinds of responsibility group a church has, and what somebody may be
   * called within one.
   *
   * Both are vocabulary only. A group's *behaviour* comes from its own fields —
   * whether it is the leadership audience, which campus it answers for — and a
   * function is what the church calls the job, never a permission. So these are
   * safe to add to: a new kind of group and a new name for a job are things the
   * application already knows how to carry.
   */
  "organization.groupTypes": organizationFile.groupTypes,
  "organization.assignmentFunctions": organizationFile.assignmentFunctions,
} as const;

export type FileNamespace = keyof typeof fileSources;
