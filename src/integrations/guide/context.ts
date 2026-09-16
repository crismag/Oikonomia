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
    topics: [
      "home.page",
      "home.open-your-work",
      "planning.plan-week.walkthrough",
      "getting-started.overview",
      "getting-started.binder-and-leadership",
    ],
  },
  {
    pattern: "/my-progress",
    module: "home",
    page: "my-progress",
    topics: ["my-progress.page", "my-progress.why-not-done", "home.open-your-work"],
  },
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
    topics: [
      "weekly-agenda.page",
      "weekly-agenda.add-item",
      "weekly-agenda.change-item",
      "planning.not-on-week",
      "weekly-agenda.find-and-print",
      "planning.plan-week.walkthrough",
      "asks.put-on-week",
      "planning.google-calendar",
    ],
  },
  {
    pattern: "/monthly-calendar",
    module: "planning",
    page: "monthly-calendar",
    topics: [
      "monthly-calendar.page",
      "monthly-calendar.add-event",
      "weekly-agenda.change-item",
      "planning.repeating-entry",
      "planning.cannot-edit-entry",
      "planning.google-calendar",
    ],
  },
  {
    pattern: "/meeting-notes",
    module: "meetings",
    page: "meeting-notes",
    topics: [
      "meeting-notes.page",
      "meeting-notes.write",
      "meeting-notes.tasks",
      "meeting-notes.decisions-follow-ups",
      "meeting-notes.personal-vs-minutes",
      "meeting-notes.find",
      "meeting-notes.record.walkthrough",
    ],
  },
  {
    pattern: "/reach-out",
    module: "reach-out",
    page: "reach-out",
    topics: [
      "reach-out.page",
      "reach-out.add-report",
      "reach-out.find",
      "reach-out.sharing",
      "reach-out.write.walkthrough",
    ],
  },
  {
    pattern: "/reach-out/$",
    module: "reach-out",
    page: "reach-out-report",
    topics: [
      "reach-out.page",
      "reach-out.contribute",
      "reach-out.asks",
      "reach-out.add-report",
      "reach-out.sharing",
    ],
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
      "reports.delete",
      "reports.follow-ups",
      "asks.raise",
    ],
    entityType: "leadership-report",
  },
  {
    pattern: "/goals",
    module: "goals",
    page: "goals",
    topics: ["goals.page", "goals.scope"],
  },
  {
    pattern: "/goals/$",
    module: "goals",
    page: "goal",
    topics: ["goals.scope", "goals.progress"],
    entityType: "goal",
  },
  {
    pattern: "/lifegroups",
    module: "lifegroup",
    page: "lifegroups",
    topics: [
      "lifegroup.page",
      "lifegroup.add-gathering",
      "lifegroup.claim",
      "lifegroup.venue",
      "lifegroup.names",
      "lifegroup.lead.walkthrough",
    ],
  },
  {
    pattern: "/lifegroups/$",
    module: "lifegroup",
    page: "gathering",
    topics: [
      "lifegroup.gathering-page",
      "lifegroup.record-attendance",
      "lifegroup.write-up",
      "lifegroup.entry-visibility",
      "lifegroup.gathering-report",
      "lifegroup.cannot-record",
      "asks.raise",
    ],
    entityType: "gathering",
  },
  {
    pattern: "/ministries",
    module: "ministries",
    page: "ministries",
    topics: ["ministries.page", "ministries.relationship", "ministries.working-on.walkthrough"],
  },
  {
    pattern: "/ministries/$",
    module: "ministries",
    page: "ministry",
    topics: [
      "ministries.page",
      "ministries.add-goal",
      "ministries.find-documents",
      "documents.drive",
      "ministries.add-link",
      "ministries.relationship",
      "goals.scope",
    ],
    entityType: "ministry",
  },
  {
    pattern: "/documents",
    module: "documents",
    page: "documents",
    topics: ["documents.page", "documents.register", "documents.drive"],
  },
  {
    pattern: "/documents/$",
    module: "documents",
    page: "document",
    topics: [
      "documents.registered-document",
      "documents.edit-unfile",
      "documents.document-page",
      "documents.register",
      "ministries.find-documents",
    ],
    entityType: "document",
  },
  {
    pattern: "/forms",
    module: "documents",
    page: "forms",
    topics: ["forms.page", "forms.fill-record", "forms.retire"],
  },
  {
    pattern: "/forms/$",
    module: "documents",
    page: "form",
    topics: ["forms.page", "forms.fill-record", "forms.retire"],
  },
  {
    pattern: "/records/$",
    module: "documents",
    page: "form-record",
    topics: ["forms.fill-record", "forms.page"],
  },
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
    topics: [
      "inbox.page",
      "inbox.respond",
      "asks.put-on-week",
      "inbox.respond.walkthrough",
      "inbox.troubleshooting",
    ],
  },
  {
    pattern: "/team",
    module: "leadership",
    page: "team",
    topics: ["team.page", "team.follow-up"],
  },
  {
    pattern: "/reports",
    module: "leadership",
    page: "reports-to-you",
    topics: [
      "reports-to-you.page",
      "reports-to-you.find",
      "reports.confidential",
      "inbox.troubleshooting",
    ],
  },
  {
    pattern: "/work/$",
    module: "leadership",
    page: "work",
    topics: ["work.record-page", "inbox.respond", "asks.put-on-week", "asks.raise"],
    entityType: "work",
  },
  {
    pattern: "/people",
    module: "people",
    page: "people",
    topics: ["people.page", "people.troubleshooting"],
  },
  {
    pattern: "/people/$",
    module: "people",
    page: "person",
    topics: ["people.person-page", "people.troubleshooting", "permissions.not-found"],
    entityType: "person",
  },
  {
    pattern: "/attendance",
    module: "lifegroup",
    page: "attendance",
    topics: ["lifegroup.attendance-page", "lifegroup.record-attendance"],
  },
  {
    pattern: "/leadership",
    module: "journal",
    page: "leadership-journal",
    topics: ["journal.page", "journal.write-entry", "journal.share-entry", "journal.walkthrough"],
  },
  {
    pattern: "/leadership/$",
    module: "journal",
    page: "journal-entry",
    topics: ["journal.write-entry", "journal.share-entry", "journal.delete-entry", "journal.page"],
    entityType: "journal-entry",
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
    topics: ["account.appearance", "account.email-notices", "account.password", "account.sign-in"],
  },
];

const matches = (pattern: string, pathname: string) => {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  return want.length === have.length && want.every((part, i) => part === "$" || part === have[i]);
};

/** "Where do I do…?" — offered on every page. */
export const FINDER = "getting-started.where-to";

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
    /* Finding where to do something is the question a leader brings to every
       page, so every page offers it — last, after the page's own help. */
    topics: [...(route?.topics ?? []).filter((id) => id !== FINDER), FINDER],
    ...(route
      ? {
          module: route.module,
          page: route.page,
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
