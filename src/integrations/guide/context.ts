/**
 * Where the reader is, in the Guide's terms.
 *
 * One central table from Oikonomia's routes to a module, a page and the topics
 * that page most needs — so pages do not register themselves and the corpus
 * does not know routes. A route not listed here still gets a context (its
 * path and capabilities); the Guide then falls back to general help.
 */

export interface RouteGuide {
  /** Matched against the pathname. `$` segments match any value. */
  pattern: string;
  module: string;
  page: string;
  topics: string[];
  entityType?: string;
}

export const routeGuides: RouteGuide[] = [
  {
    pattern: "/",
    module: "home",
    page: "home",
    topics: ["home.page", "getting-started.overview", "getting-started.binder-and-leadership"],
  },
  { pattern: "/my-progress", module: "home", page: "my-progress", topics: ["my-progress.page"] },
  {
    pattern: "/welcome",
    module: "onboarding",
    page: "welcome",
    topics: ["onboarding.welcome", "assignments.claims"],
  },
  {
    pattern: "/weekly-agenda",
    module: "planning",
    page: "weekly-agenda",
    topics: ["weekly-agenda.page", "weekly-agenda.add-item", "asks.put-on-week"],
  },
  {
    pattern: "/monthly-calendar",
    module: "planning",
    page: "monthly-calendar",
    topics: ["monthly-calendar.page"],
  },
  {
    pattern: "/meeting-notes",
    module: "meetings",
    page: "meeting-notes",
    topics: ["meeting-notes.page", "meeting-notes.personal-vs-minutes", "meeting-notes.tasks"],
  },
  { pattern: "/reach-out", module: "reach-out", page: "reach-out", topics: ["reach-out.page"] },
  {
    pattern: "/reach-out/$",
    module: "reach-out",
    page: "reach-out-report",
    topics: ["reach-out.page"],
    entityType: "reach-out-report",
  },
  {
    pattern: "/leadership-reports",
    module: "reports",
    page: "leadership-reports",
    topics: ["reports.page", "reports.create", "reports.visibility", "reports.confidential"],
  },
  {
    pattern: "/leadership-reports/$",
    module: "reports",
    page: "leadership-report",
    topics: [
      "reports.report-page",
      "reports.visibility",
      "reports.confidential",
      "reports.statuses",
      "reports.follow-ups",
      "asks.raise",
    ],
    entityType: "leadership-report",
  },
  { pattern: "/goals", module: "goals", page: "goals", topics: ["goals.page", "goals.scope"] },
  {
    pattern: "/goals/$",
    module: "goals",
    page: "goal",
    topics: ["goals.scope", "goals.progress"],
    entityType: "goal",
  },
  { pattern: "/lifegroups", module: "lifegroup", page: "lifegroups", topics: ["lifegroup.page"] },
  {
    pattern: "/lifegroups/$",
    module: "lifegroup",
    page: "gathering",
    topics: ["lifegroup.page"],
    entityType: "gathering",
  },
  { pattern: "/ministries", module: "ministries", page: "ministries", topics: ["ministries.page"] },
  {
    pattern: "/ministries/$",
    module: "ministries",
    page: "ministry",
    topics: ["ministries.page", "ministries.add-link", "goals.scope"],
    entityType: "ministry",
  },
  {
    pattern: "/documents",
    module: "documents",
    page: "documents",
    topics: ["documents.page", "documents.register"],
  },
  {
    pattern: "/forms",
    module: "documents",
    page: "forms",
    topics: ["forms.page", "forms.retire"],
  },
  {
    pattern: "/forms/$",
    module: "documents",
    page: "form",
    topics: ["forms.page", "forms.retire"],
  },
  { pattern: "/records/$", module: "documents", page: "form-record", topics: ["forms.page"] },
  {
    pattern: "/resource-search",
    module: "documents",
    page: "resource-search",
    topics: ["documents.page"],
  },
  {
    pattern: "/inbox",
    module: "leadership",
    page: "inbox",
    topics: ["inbox.page", "asks.put-on-week"],
  },
  { pattern: "/team", module: "leadership", page: "team", topics: ["team.page"] },
  {
    pattern: "/reports",
    module: "leadership",
    page: "reports-to-you",
    topics: ["reports-to-you.page", "reports.confidential"],
  },
  { pattern: "/people", module: "people", page: "people", topics: ["people.page"] },
  {
    pattern: "/people/$",
    module: "people",
    page: "person",
    topics: ["people.person-page"],
    entityType: "person",
  },
  { pattern: "/attendance", module: "lifegroup", page: "attendance", topics: ["lifegroup.page"] },
  {
    pattern: "/leadership",
    module: "journal",
    page: "leadership-journal",
    topics: ["journal.page"],
  },
  {
    pattern: "/administration",
    module: "administration",
    page: "administration",
    topics: [
      "administration.page",
      "administration.setup-church",
      "assignments.confirm",
      "administration.invite",
    ],
  },
  {
    pattern: "/account-security",
    module: "account",
    page: "account-security",
    topics: ["account.sign-in", "account.password"],
  },
];

const matches = (pattern: string, pathname: string) => {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  return want.length === have.length && want.every((part, i) => part === "$" || part === have[i]);
};

export function routeGuideFor(pathname: string): (RouteGuide & { entityId?: string }) | undefined {
  const guide = routeGuides.find((candidate) => matches(candidate.pattern, pathname));
  if (!guide) return undefined;
  const last = pathname.split("/").filter(Boolean).at(-1);
  return guide.entityType && last ? { ...guide, entityId: last } : guide;
}

/**
 * Oikonomia's state, as the Guide may see it.
 *
 * Only what retrieval and visibility need: where the reader is, what they may
 * do, and the installation's conditions (a public demo, groups of operations
 * switched off) as flags. Demo and installation policy are still enforced by
 * the server; the flags only let help say so or stay out of the way.
 */
export function guideContextFor(input: {
  pathname: string;
  capabilities: readonly string[];
  installation: { demo: boolean; restricted: readonly string[] };
}): import("@/features/guide").GuideContext {
  const route = routeGuideFor(input.pathname);
  return {
    route: input.pathname,
    ...(route
      ? {
          module: route.module,
          page: route.page,
          topics: route.topics,
          ...(route.entityType
            ? {
                entity: {
                  type: route.entityType,
                  ...(route.entityId ? { id: route.entityId } : {}),
                },
              }
            : {}),
        }
      : {}),
    capabilities: [...input.capabilities],
    flags: [
      ...(input.installation.demo ? ["demo"] : []),
      ...input.installation.restricted.map((restriction) => `restricted:${restriction}`),
    ],
  };
}
