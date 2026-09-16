import { navFor, navGroups } from "@/components/oikonomia/nav";
import type { Persona } from "@/domain/types";

/**
 * Semantic destinations the Oikonomia knowledge pack may point at.
 *
 * Knowledge says `destination:leadership-reports`; this is the only place that
 * knows it means `/leadership-reports`. Renaming a route changes this table,
 * not the corpus.
 *
 * Every destination is a page the reader could open from the application
 * themselves. None performs anything.
 */
export interface OikonomiaDestination {
  path: string;
  /** In-page anchor, e.g. a section of Administration. */
  hash?: string;
  search?: Record<string, string>;
  label: string;
}

export const destinations: Record<string, OikonomiaDestination> = {
  home: { path: "/", label: "Open Home" },
  "my-progress": { path: "/my-progress", label: "Open My Progress" },
  welcome: { path: "/welcome", label: "Open Setup & walkthrough" },
  "weekly-agenda": { path: "/weekly-agenda", label: "Open Weekly Agenda" },
  "monthly-calendar": { path: "/monthly-calendar", label: "Open Monthly Calendar" },
  "meeting-notes": { path: "/meeting-notes", label: "Open Meeting Notes" },
  "reach-out": { path: "/reach-out", label: "Open Reach-Out" },
  "leadership-reports": { path: "/leadership-reports", label: "Open Leadership Reports" },
  "leadership-reports.shared": {
    path: "/leadership-reports",
    search: { tab: "shared" },
    label: "Open reports shared with you",
  },
  goals: { path: "/goals", label: "Open Goals" },
  lifegroups: { path: "/lifegroups", label: "Open LifeGroup" },
  ministries: { path: "/ministries", label: "Open Ministries" },
  documents: { path: "/documents", label: "Open Documents & Forms" },
  forms: { path: "/forms", label: "Open Forms" },
  "resource-search": { path: "/resource-search", label: "Open Resource Search" },
  inbox: { path: "/inbox", label: "Open Leadership Inbox" },
  team: { path: "/team", label: "Open Team Overview" },
  "reports-to-you": { path: "/reports", label: "Open Reports to you" },
  people: { path: "/people", label: "Open People" },
  attendance: { path: "/attendance", label: "Open Attendance" },
  campuses: { path: "/campuses", label: "Open Campuses" },
  "leadership-journal": { path: "/leadership", label: "Open Leadership journal" },
  "account-security": { path: "/account-security", label: "Open Account & security" },
  administration: { path: "/administration", label: "Open Administration" },
  "administration.campuses": {
    path: "/administration",
    hash: "campuses",
    label: "Open Administration → Campuses",
  },
  "administration.ministries": {
    path: "/administration",
    hash: "ministries",
    label: "Open Administration → Ministries",
  },
  "administration.people": {
    path: "/administration",
    hash: "people",
    label: "Open Administration → People",
  },
  "administration.assignments": {
    path: "/administration",
    hash: "assignments",
    label: "Open Administration → Awaiting confirmation",
  },
};

export const isKnownDestination = (id: string) => id in destinations;

/**
 * Whether the navigation offers this reader the destination's page.
 *
 * Read from the navigation's own filter (`navFor`), so the Guide never keeps
 * a second copy of who sees what. A page the navigation does not list at all
 * (Setup & walkthrough, Forms, Account & security) is open to everyone who is
 * signed in. Either way this is presentation — the page and the server still
 * refuse on their own.
 */
export function mayOpen(id: string, persona: Persona): boolean {
  const destination = destinations[id];
  if (!destination) return false;
  const listed = navGroups
    .flatMap((group) => group.items)
    .some((item) => item.to === destination.path);
  if (!listed) return true;
  return navFor(persona)
    .flatMap((group) => group.items)
    .some((item) => item.to === destination.path);
}
