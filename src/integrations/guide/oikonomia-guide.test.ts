import { describe, expect, it } from "vitest";

import { navGroups } from "@/components/oikonomia/nav";
import { personaFor } from "@/domain/roles";
import { createGuideService } from "@/features/guide";
import { createMemoryKnowledgeProvider } from "@/features/guide/knowledge/repository";
import { createDeterministicRetriever } from "@/features/guide/retrieval/deterministic";
import type { GuideContext } from "@/features/guide";
import { guideContextFor, routeGuideFor, routeGuides } from "./context";
import { destinations, mayOpen } from "./destinations";
import { buildOikonomiaCorpus } from "./knowledge-pack";
import { oikonomiaCategories } from "./pack";

/**
 * The Oikonomia side of the Guide: its knowledge pack is valid product data,
 * its route table points at real topics, and what it offers a reader follows
 * the application's own capability rules rather than a copy of them.
 */

const corpus = buildOikonomiaCorpus();
const byId = new Map(corpus.items.map((item) => [item.id, item]));

const leader = personaFor("leader", "p-leader");
const admin = personaFor("admin", "p-admin");

describe("the Oikonomia knowledge pack", () => {
  it("validates with no errors", () => {
    expect(corpus.errors).toEqual([]);
  });

  it("covers the areas a first-time leader needs", () => {
    for (const category of oikonomiaCategories) {
      expect(
        corpus.items.some((item) => item.category === category.id),
        `category ${category.id} has no knowledge`,
      ).toBe(true);
    }
    expect(
      corpus.items.filter((item) => item.type === "walkthrough").length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("names only topics that exist in the route table", () => {
    for (const route of routeGuides) {
      for (const topic of route.topics) {
        expect(byId.has(topic), `${route.pattern} names missing topic ${topic}`).toBe(true);
      }
    }
  });

  it("keeps administration help for readers who can administer", () => {
    for (const id of ["administration.page", "administration.invite", "assignments.confirm"]) {
      expect(byId.get(id)?.capabilities).toContain("administration");
    }
  });
});

describe("context", () => {
  it("maps a route to its module, page, topics and entity", () => {
    expect(routeGuideFor("/leadership-reports/lr-1")).toMatchObject({
      module: "reports",
      page: "leadership-report",
      entityType: "leadership-report",
      entityId: "lr-1",
    });
    expect(routeGuideFor("/nowhere/at/all")).toBeUndefined();
  });

  it("carries capabilities and installation conditions, nothing more", () => {
    const context = guideContextFor({
      pathname: "/goals",
      capabilities: ["administration"],
      installation: { demo: true, restricted: ["identity", "data"] },
    });
    expect(context).toEqual({
      route: "/goals",
      module: "goals",
      page: "goals",
      topics: ["goals.page", "goals.scope", "getting-started.where-to"],
      capabilities: ["administration"],
      flags: ["demo", "restricted:identity", "restricted:data"],
    });
  });

  /* Finding where to do something is asked on every page, known or not. */
  it("offers where to do things on every page", () => {
    const none = { demo: false, restricted: [] };
    for (const pathname of ["/", "/weekly-agenda", "/nowhere/at/all"]) {
      const topics = guideContextFor({ pathname, capabilities: [], installation: none }).topics;
      expect(topics?.at(-1)).toBe("getting-started.where-to");
      expect(topics?.filter((id) => id === "getting-started.where-to")).toHaveLength(1);
    }
  });
});

describe("destinations", () => {
  it("resolve only to routes the application has", () => {
    const listed = new Set(navGroups.flatMap((group) => group.items).map((item) => item.to));
    for (const [id, destination] of Object.entries(destinations)) {
      const known =
        listed.has(destination.path as never) ||
        ["/welcome", "/forms", "/account-security"].includes(destination.path);
      expect(known, `${id} → ${destination.path}`).toBe(true);
    }
  });

  it("follow the navigation's capability filter instead of a copy of it", () => {
    expect(mayOpen("administration", leader)).toBe(false);
    expect(mayOpen("administration.people", leader)).toBe(false);
    expect(mayOpen("administration", admin)).toBe(true);
    expect(mayOpen("leadership-reports", leader)).toBe(true);
    expect(mayOpen("welcome", leader)).toBe(true);
    expect(mayOpen("no-such-place", admin)).toBe(false);
  });
});

describe("what a leader is shown", () => {
  const service = (context: GuideContext, persona = leader) => {
    const knowledge = createMemoryKnowledgeProvider(corpus.items, oikonomiaCategories);
    return createGuideService({
      host: {
        getContext: () => context,
        hasCapability: (c) => (persona.capabilities as readonly string[]).includes(c),
        canNavigate: (id) => mayOpen(id, persona),
        destinationLabel: (id) => destinations[id]?.label,
        navigate: () => {},
      },
      knowledge,
      retriever: createDeterministicRetriever(knowledge),
    });
  };
  const context = (pathname: string, persona = leader): GuideContext =>
    guideContextFor({
      pathname,
      capabilities: persona.capabilities,
      installation: { demo: false, restricted: [] },
    });

  it("opens Leadership Reports on its own help", async () => {
    const home = await service(context("/leadership-reports")).home();
    if (home.kind !== "home") throw new Error(home.kind);
    expect(home.title).toBe(byId.get("reports.page")!.title);
    expect(home.suggestions.map((s) => s.id)).toContain("reports.visibility");
    expect(home.walkthroughs.map((s) => s.id)).toContain("reports.create.walkthrough");
  });

  /* The Guide is a user guide first: the questions leaders bring about their
     own work must land on the article that answers them. */
  it("answers a leader's everyday questions on the page they are on", async () => {
    for (const [pathname, question, expected] of [
      ["/lifegroups", "how do I record attendance", "lifegroup.record-attendance"],
      ["/lifegroups/g-1", "how do I complete the gathering", "lifegroup.write-up"],
      ["/inbox", "how do I approve something", "inbox.respond"],
      ["/monthly-calendar", "how do I add an event", "monthly-calendar.add-event"],
      ["/weekly-agenda", "move something to another day", "weekly-agenda.change-item"],
      ["/weekly-agenda", "why isn't my task on my week", "planning.not-on-week"],
      ["/meeting-notes", "how do I write minutes", "meeting-notes.write"],
      ["/reach-out", "add a reach-out report", "reach-out.add-report"],
      ["/leadership", "share a journal entry", "journal.share-entry"],
      ["/ministries/m-1", "add a ministry goal", "ministries.add-goal"],
      ["/team", "who is behind", "team.follow-up"],
      ["/", "where do I record attendance", "lifegroup.record-attendance"],
    ] as const) {
      const response = await service(context(pathname)).ask(question);
      const ids =
        response.kind === "results"
          ? [response.answer?.item.id, ...response.results.map((r) => r.id)]
          : [];
      expect(ids.slice(0, 4), `${question} @ ${pathname}`).toContain(expected);
    }
  });

  it("answers ordinary questions from the corpus", async () => {
    const guide = service(context("/leadership-reports/lr-1"));
    for (const [question, expected] of [
      ["who can see my report", "reports.visibility"],
      ["what does confidential mean", "reports.confidential"],
      ["how do I put this on my week", "asks.put-on-week"],
    ] as const) {
      const response = await guide.ask(question);
      const ids =
        response.kind === "results"
          ? [response.answer?.item.id, ...response.results.map((r) => r.id)]
          : [];
      expect(ids.slice(0, 3), question).toContain(expected);
    }
  });

  it("never shows a leader administration help, or a way into Administration", async () => {
    const guide = service(context("/administration"));
    const browse = await guide.browse();
    expect(JSON.stringify(browse)).not.toContain("administration.invite");
    const asked = await guide.ask("invite a leader to oikonomia");
    expect(JSON.stringify(asked)).not.toContain("administration.invite");
    const topic = await guide.topic("administration.setup-church");
    expect(topic.kind).toBe("fallback");
  });

  it("shows an administrator how to set up the church", async () => {
    const guide = service(context("/", admin), admin);
    const topic = await guide.topic("administration.setup-church.walkthrough");
    if (topic.kind !== "walkthrough") throw new Error(topic.kind);
    expect(topic.steps.some((step) => step.destination === "administration.campuses")).toBe(true);
  });
});
