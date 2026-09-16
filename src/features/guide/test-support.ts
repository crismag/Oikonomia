import type { GuideHostAdapter } from "./core/contracts";
import type { GuideContext, GuideEvent, KnowledgeItem } from "./core/types";
import { buildCorpus } from "./knowledge/validate";

/**
 * A small, host-free knowledge pack and host for Guide Core's own tests.
 *
 * Guide Core is tested without Oikonomia: these fixtures use invented modules
 * and capabilities on purpose, so nothing in the core can quietly depend on
 * the application that happens to host it.
 */

export const file = (front: string, body = "Some text.") => `---\n${front.trim()}\n---\n${body}`;

export const fixtureSources = [
  {
    path: "widgets/page.md",
    raw: file(
      `
id: widgets.page
title: Widgets
type: page
category: start
summary: Where widgets are listed and made.
modules: [widgets]
pages: [widget-list]
keywords: [widgets, widget list]
related: [widgets.create, widgets.sharing]
destinations: [widget-list]
`,
      "Widgets are listed here. [Make one](topic:widgets.create) or open the [list](destination:widget-list).",
    ),
  },
  {
    path: "widgets/create.md",
    raw: file(
      `
id: widgets.create
title: Make a widget
type: procedure
category: start
summary: How to make a new widget.
modules: [widgets]
pages: [widget-list]
keywords: [new widget, make widget]
aliases:
  - how do i add a widget
related: [widgets.sharing]
`,
      "1. Choose **New widget**.\n2. Give it a name.",
    ),
  },
  {
    path: "widgets/sharing.md",
    raw: file(
      `
id: widgets.sharing
title: Who can see a widget
type: permission
category: start
summary: Widgets are visible to their owner and the people they share with.
modules: [widgets]
keywords: [sharing, visibility, private]
aliases:
  - who can see my widget
`,
    ),
  },
  {
    path: "widgets/tour.md",
    raw: file(
      `
id: widgets.tour
title: Make your first widget
type: walkthrough
category: start
summary: Three steps to a widget.
pages: [widget-list]
`,
      "An introduction.\n\n## Open the list\nDestination: widget-list\n\nIt is in the menu.\n\n## Choose New widget\nAt the top.\n\n## Save\nPress Save.",
    ),
  },
  {
    path: "admin/settings.md",
    raw: file(
      `
id: admin.settings
title: Change the settings
type: procedure
category: admin
summary: Settings are changed by people who manage the site.
modules: [admin]
keywords: [settings, configure]
capabilities: [manage-site]
destinations: [settings]
`,
    ),
  },
  {
    path: "help/email-off.md",
    raw: file(
      `
id: help.invite-email
title: Invitations by email
type: procedure
category: admin
summary: How invitations are emailed.
keywords: [invite, invitation, email]
hideWhen: [demo]
`,
    ),
  },
];

export function fixtureItems(): KnowledgeItem[] {
  const { items, errors } = buildCorpus(fixtureSources);
  if (errors.length) throw new Error(errors.join("\n"));
  return items;
}

export const fixtureCategories = [
  { id: "start", title: "Getting started" },
  { id: "admin", title: "Administration" },
];

export function fixtureContext(over: Partial<GuideContext> = {}): GuideContext {
  return {
    route: "/widgets",
    module: "widgets",
    page: "widget-list",
    capabilities: [],
    flags: [],
    ...over,
  };
}

export function fixtureHost(context: () => GuideContext, events: GuideEvent[] = []) {
  const navigated: string[] = [];
  const host: GuideHostAdapter = {
    getContext: context,
    hasCapability: (c) => context().capabilities.includes(c),
    canNavigate: (id) =>
      id === "widget-list" || (id === "settings" && context().capabilities.includes("manage-site")),
    destinationLabel: (id) => (id === "widget-list" ? "Open Widgets" : "Open Settings"),
    navigate: (id) => navigated.push(id),
    onEvent: (event) => events.push(event),
  };
  return { host, navigated, events };
}
