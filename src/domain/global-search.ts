import { readableReports, reportTypeLabel, searchableBy } from "./leadership-report";
import type { LeadershipReport, Ministry, Person, Persona, ResourceSearchResult } from "./types";

/**
 * Global search.
 *
 * The one field in the application chrome, answering "take me to the thing I
 * am thinking of". It spans the entities the placeholder promises — people,
 * ministries, reports — plus the resources Resource Search already knows how
 * to find, and the binder's own destinations.
 *
 * Two things it is not. It is not a second search engine: reports and
 * resources are **handed in** by the modules that own them, already searched
 * and already authorized, which is why they are parameters rather than
 * something this file fetches. And it is not a replacement for Resource
 * Search, which exists to *refine* rather than to jump — pressing Enter here
 * hands the query over to it.
 */

export type GlobalResultKind = "page" | "person" | "ministry" | "report" | "resource";

export interface GlobalResult {
  kind: GlobalResultKind;
  id: string;
  label: string;
  /** Where it sits, shown quietly beneath the label. */
  detail?: string;
  /** Application path to navigate to. */
  to: string;
  /** Set when the destination needs search parameters. */
  search?: Record<string, string>;
}

export const kindLabel: Record<GlobalResultKind, string> = {
  page: "Go to",
  person: "People",
  ministry: "Ministry",
  report: "Leadership Reports",
  resource: "Resources",
};

/** The order groups appear in, most specific first. */
export const kindOrder: GlobalResultKind[] = ["page", "person", "ministry", "report", "resource"];

/**
 * Binder destinations, so the field doubles as a way to move around.
 *
 * Kept here rather than derived from the sidebar because a destination worth
 * typing is not always one worth listing — and the sidebar's shape is a
 * presentation decision.
 */
const pages: { label: string; to: string; detail: string }[] = [
  { label: "Weekly Agenda", to: "/weekly-agenda", detail: "Plan" },
  { label: "Monthly Calendar", to: "/monthly-calendar", detail: "Plan" },
  { label: "Meeting Notes", to: "/meeting-notes", detail: "Record" },
  { label: "Ministry", to: "/ministries", detail: "Record" },
  { label: "LifeGroup", to: "/lifegroups", detail: "Record" },
  { label: "Reach-Out", to: "/reach-out", detail: "Record" },
  { label: "Leadership Reports", to: "/leadership-reports", detail: "Progress" },
  { label: "Documents & Forms", to: "/documents", detail: "Resources" },
  { label: "Resource Search", to: "/resource-search", detail: "Resources" },
  { label: "Reports to Review", to: "/reports", detail: "Leadership" },
  { label: "Attention", to: "/inbox", detail: "Leadership" },
  { label: "People", to: "/people", detail: "Organization" },
  { label: "Attendance", to: "/attendance", detail: "Organization" },
];

const hit = (text: string, q: string) => text.toLowerCase().includes(q);

/**
 * Everything matching, grouped and capped.
 *
 * Reports and resources are requested through their own authorized readers, so
 * global search can neither widen access nor become a way around it. A record
 * the viewer may not discover is never counted, never suggested, and never
 * reaches the dropdown.
 */
export function globalSearch(
  query: string,
  persona: Persona,
  person: Person,
  reports: LeadershipReport[],
  resources: ResourceSearchResult[],
  /* The directory is passed in rather than imported: search must look at the
     same people and ministries the rest of the page is looking at. */
  directory: { people: Person[]; ministries: Ministry[] } = { people: [], ministries: [] },
  limitPerGroup = 4,
): GlobalResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const out: GlobalResult[] = [];

  for (const page of pages) {
    if (hit(page.label, q)) {
      out.push({
        kind: "page",
        id: `page-${page.label}`,
        label: page.label,
        detail: page.detail,
        to: page.to,
      });
    }
  }

  for (const candidate of directory.people) {
    if (hit(candidate.name, q) || hit(candidate.role, q)) {
      out.push({
        kind: "person",
        id: candidate.id,
        label: candidate.name,
        detail: candidate.role,
        to: `/people/${candidate.id}`,
      });
    }
  }

  for (const ministry of directory.ministries) {
    if (hit(ministry.name, q) || hit(ministry.purpose, q)) {
      out.push({
        kind: "ministry",
        id: ministry.id,
        label: ministry.name,
        detail: ministry.purpose,
        to: `/ministries/${ministry.id}`,
      });
    }
  }

  /*
   * Two gates, and the second is the narrower one.
   *
   * `readableReports` is what this viewer may discover at all. `searchableBy`
   * is what may be *found by typing*: a private or restricted report answers
   * only to its author and the people it was explicitly shared with. Nobody
   * goes looking for a report they do not know about — search would be
   * volunteering it.
   */
  for (const report of readableReports(reports, persona, person).filter((report) =>
    searchableBy(report, person),
  )) {
    if (hit(report.title, q) || hit(reportTypeLabel(report.reportType), q)) {
      out.push({
        kind: "report",
        id: report.id,
        label: report.title || "Untitled report",
        detail: reportTypeLabel(report.reportType),
        to: `/leadership-reports/${report.id}`,
      });
    }
  }

  for (const resource of resources) {
    out.push({
      kind: "resource",
      id: resource.id,
      label: resource.title,
      ...(resource.associations[0]?.label ? { detail: resource.associations[0].label } : {}),
      to: "/resource-search",
      search: { q: resource.title },
    });
  }

  return kindOrder.flatMap((kind) => out.filter((r) => r.kind === kind).slice(0, limitPerGroup));
}
