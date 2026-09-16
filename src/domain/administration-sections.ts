/**
 * The sections of Administration, opened one at a time.
 *
 * Administration used to render every section at once. At a few hundred
 * people that is tens of kilobytes of rows nobody asked to see, and the code
 * for configuration and data care downloaded whether or not the visit was
 * about them. Each section is now its own destination: the page shows the one
 * named by the address's `#hash` and loads its code when it is opened.
 *
 * The hash stays the section's name because other screens already link by
 * it — the Guide's destinations and Home's *Set up your church* card open
 * `/administration#people`, `#campuses`, `#ministries`, `#invite` and
 * `#assignments`. Those anchors are also the `id`s the sections render, so a
 * link that worked before still lands on the same heading.
 */

export type AdministrationSectionId =
  | "assignments"
  | "invite"
  | "people"
  | "campuses"
  | "ministries"
  | "groups"
  | "venues"
  | "google-workspace"
  | "data"
  | "configuration";

export interface AdministrationSection {
  id: AdministrationSectionId;
  label: string;
}

export const administrationSections: readonly AdministrationSection[] = [
  { id: "assignments", label: "Awaiting confirmation" },
  { id: "invite", label: "Invite people" },
  { id: "people", label: "People" },
  { id: "campuses", label: "Campuses" },
  { id: "ministries", label: "Ministries" },
  { id: "groups", label: "Responsibility groups" },
  { id: "venues", label: "Venues" },
  { id: "google-workspace", label: "Google Workspace" },
  { id: "data", label: "Data management" },
  { id: "configuration", label: "Configuration" },
];

/** What opens when the address names no section: the work waiting on someone. */
export const DEFAULT_ADMINISTRATION_SECTION: AdministrationSectionId = "assignments";

/**
 * The section an address's hash opens.
 *
 * Accepts the hash with or without its `#`. Anything unrecognised opens the
 * default rather than an empty page — an old or mistyped link should still
 * arrive somewhere useful.
 */
export function administrationSectionFor(hash: string | undefined): AdministrationSectionId {
  const name = (hash ?? "").replace(/^#/, "");
  return (
    administrationSections.find((section) => section.id === name)?.id ??
    DEFAULT_ADMINISTRATION_SECTION
  );
}
