import type { AreaId } from "@/domain/appearance";
import {
  Gauge,
  LayoutDashboard,
  BookLock,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  NotebookPen,
  FileText,
  FolderOpen,
  HeartHandshake,
  Inbox,
  Sprout,
  Search,
  Settings2,
  Target,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { Capability, Persona } from "@/domain/types";

export type NavPath =
  | "/"
  | "/inbox"
  | "/schedule"
  | "/weekly-agenda"
  | "/monthly-calendar"
  | "/goals"
  | "/forms"
  | "/meeting-notes"
  | "/progress-report"
  | "/leadership-reports"
  | "/resource-search"
  | "/documents"
  | "/people"
  | "/ministries"
  | "/lifegroups"
  | "/attendance"
  | "/reach-out"
  | "/reports"
  | "/team"
  | "/my-progress"
  | "/account-security"
  | "/leadership"
  | "/planning"
  | "/campuses"
  | "/administration";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: NavPath;
  /** Search params, for destinations that need them. */
  search?: Record<string, string>;
  /** Areas without a built route yet still belong in the IA. */
  planned?: boolean;
  /**
   * What the viewer must be able to do for this to be worth showing.
   *
   * A **capability**, not a list of role names. Roles are a church's to define
   * and rename now, so a menu keyed to `["admin"]` would hide Administration
   * from a church that called its administering role something else — a page
   * with no door, for exactly the people who need it.
   *
   * Absent means everyone. This is emphatically **not** authorization: the
   * server refuses what it refuses whether or not a link was drawn.
   */
  capability?: Capability;
  /** The area of work it belongs to, which gives it its colour in every theme. */
  area: AreaId;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
  /**
   * Which working context this group belongs to. The leader's Binder is the
   * product; leadership/oversight is a separate, subordinate context.
   */
  context: "binder" | "leadership";
}

/**
 * Navigation, structured as a binder: what is mine, what is shared, what the
 * leadership sees, and the organisation's own records.
 *
 * Two working contexts, deliberately separated:
 *
 *   MY BINDER    — I am the leader doing my work: plan, record, report.
 *   LEADERSHIP   — I am overseeing others' work: review, attention, org data.
 *
 * The Binder comes first and is the product. Leadership capabilities are real
 * and preserved, but they must not define every page. Section capabilities —
 * Goals, checklists, form definitions — live inside their section rather than
 * being promoted here.
 *
 * Do not add or reorder Binder sections without product approval.
 */
export const navGroups: NavGroup[] = [
  {
    /*
     * The leader's home, and the first thing in their binder.
     *
     * It had no entry here at all for a while: the dashboard existed at `/`
     * and nothing in the interface pointed at it, because "My Binder" is the
     * context heading above these groups rather than a link. A page with no
     * door is a page nobody finds.
     *
     * Named for the scope it shows, mirroring "Team Overview" under
     * Leadership, so a leader always knows which of the two they are in
     * without a toggle to misread.
     */
    heading: "Home",
    context: "binder",
    items: [
      { label: "Home", icon: LayoutDashboard, to: "/", area: "home" },
      /* The deeper personal view. Home orients; this one measures. */
      { label: "My Progress", icon: Gauge, to: "/my-progress", area: "home" },
    ],
  },
  {
    heading: "My Work",
    context: "binder",
    items: [
      { label: "Weekly Agenda", icon: CalendarRange, to: "/weekly-agenda", area: "plan" },
      { label: "Monthly Calendar", icon: CalendarDays, to: "/monthly-calendar", area: "plan" },
      { label: "Meeting Notes", icon: NotebookPen, to: "/meeting-notes", area: "meet" },
      { label: "Reach-Out", icon: HeartHandshake, to: "/reach-out", area: "reach" },
      { label: "Leadership Reports", icon: FileText, to: "/leadership-reports", area: "reports" },
      /*
       * A page with no door is a page nobody finds. Goals already participate
       * in the leadership cycle — Home and My Progress send people here — and
       * used to live only inside a ministry, which hid them from anyone who
       * was not already on that ministry's page.
       */
      { label: "Goals", icon: Target, to: "/goals", area: "goals" },
    ],
  },
  /*
   * Meeting Notes, Ministry, LifeGroup and Reach-Out are four peer binder
   * sections. They shared a heading called "Ministry" until it was noticed that
   * a heading naming one of its own children reads as ownership — Reach-Out is
   * not part of Ministry, and the navigation must not suggest otherwise. No
   * heading here is the name of a section.
   */
  {
    /*
     * Where several leaders work on one record. LifeGroup's schedule is the
     * clearest case — a roster anyone may add a row to — and Ministry holds
     * material a ministry owns rather than a person. Meeting Notes and
     * Reach-Out are the leader's own and belong above.
     */
    heading: "Shared",
    context: "binder",
    items: [
      { label: "LifeGroup", icon: Sprout, to: "/lifegroups", area: "life" },
      { label: "Ministry", icon: UsersRound, to: "/ministries", area: "ministry" },
    ],
  },
  {
    /*
     * Supporting material rather than binder sections. Kept last and kept
     * short: §27 — the sidebar should communicate the product's shape, and a
     * flat list of everything communicates nothing.
     */
    heading: "Library",
    context: "binder",
    /*
     * Two different jobs. Documents & Forms is the working library — what this
     * area manages. Resource Search answers "where is that thing I know we
     * have?" across the whole workspace. Neither replaces the other.
     *
     * Named for what it is, not "More". A leftover heading teaches a leader
     * that these pages are miscellaneous, and they are not.
     */
    items: [
      { label: "Documents & Forms", icon: FolderOpen, to: "/documents", area: "library" },
      { label: "Resource Search", icon: Search, to: "/resource-search", area: "library" },
    ],
  },

  {
    /*
     * Not "Review".
     *
     * This group used to be named for what leadership was assumed to do with
     * everything that arrived — review it. Most of what arrives is
     * information, and the heading now says what these pages are for: seeing
     * what has been asked of you, and how the team is doing.
     */
    heading: "Oversight",
    context: "leadership",
    items: [
      /*
       * Named for what it shows rather than for a dashboard. "My Binder" and
       * "Team Overview" say which scope you are in without a toggle to
       * misread — and Team Overview sits here because that is what it is:
       * oversight, not the leader's own working environment.
       */
      { label: "Leadership Inbox", icon: Inbox, to: "/inbox", area: "lead" },
      { label: "Team Overview", icon: Users, to: "/team", area: "lead" },
      /*
       * Not "Reports". Leadership Reports (above) is what you write; this is
       * what has been published to you as work records. The same word for both
       * is how a pastor opens the wrong one and decides neither is the product.
       */
      { label: "Reports to you", icon: ClipboardCheck, to: "/reports", area: "lead" },
    ],
  },
  {
    heading: "Organization",
    context: "leadership",
    items: [
      { label: "People", icon: Users, to: "/people", area: "org" },
      { label: "Attendance", icon: ClipboardList, to: "/attendance", area: "life" },
      {
        label: "Campuses",
        icon: Building2,
        to: "/campuses",
        area: "org",
        capability: "campus-oversight",
      },
      {
        /*
         * Everyone's, deliberately.
         *
         * This used to be listed for three role names and hidden from the
         * fourth, which stopped meaning anything once a church could define
         * its own roles. A journal is private to whoever writes it — the
         * service does not refuse anybody, and there is no capability to
         * check, because keeping one is not a permission.
         */
        label: "Leadership Journal",
        icon: BookLock,
        to: "/leadership",
        area: "journal",
      },
      {
        label: "Administration",
        icon: Settings2,
        to: "/administration",
        area: "org",
        capability: "administration",
      },
    ],
  },
];

/**
 * The navigation this viewer is offered.
 *
 * Filtered by what they may **do**, never by what their role is called. A
 * convenience only — every page and every server function refuses on its own.
 */
export function navFor(persona: Persona): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.capability || persona.capabilities.includes(item.capability),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The area of work a pathname belongs to.
 *
 * The sidebar's own entries decide it, so a page and its link always share a
 * colour; pages reached only from inside an area say which area that is.
 */
export function areaFor(pathname: string): AreaId {
  const segment = "/" + (pathname.split("/")[1] ?? "");
  if (segment === "/work") return "lead";
  if (segment === "/records" || segment === "/forms" || segment === "/planning") return "library";
  if (segment === "/progress-report") return "reports";
  if (segment === "/schedule") return "plan";
  if (segment === "/welcome" || segment === "/account-security") return "home";
  const match = navGroups.flatMap((group) => group.items).find((item) => item.to === segment);
  return match?.area ?? "home";
}

/** The icon that stands for a pathname: its own sidebar entry's, or its area's. */
export function areaIconFor(pathname: string): LucideIcon {
  const segment = "/" + (pathname.split("/")[1] ?? "");
  const match = navGroups.flatMap((group) => group.items).find((item) => item.to === segment);
  if (match) return match.icon;
  const area = areaFor(pathname);
  return (
    navGroups.flatMap((group) => group.items).find((item) => item.area === area)?.icon ??
    LayoutDashboard
  );
}

/** Human label for a pathname, used by the breadcrumb. */
export function areaLabelFor(pathname: string): string {
  const segment = "/" + (pathname.split("/")[1] ?? "");
  /* Areas reachable only from within another area, so absent from the sidebar. */
  if (segment === "/work") return "Work";
  if (segment === "/records") return "Record";
  if (segment === "/forms") return "Documents & Forms";
  if (segment === "/progress-report") return "Leadership Reports";
  if (segment === "/planning") return "Resource Search";
  if (segment === "/schedule") return "Weekly Agenda";
  const match = navGroups.flatMap((group) => group.items).find((item) => item.to === segment);
  return match?.label ?? "My Binder";
}
