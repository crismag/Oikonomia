import { describe, expect, it } from "vitest";

import type { GuideEvent } from "./types";
import { createGuideService } from "./service";
import { createMemoryKnowledgeProvider } from "../knowledge/repository";
import { createDeterministicRetriever } from "../retrieval/deterministic";
import { moveWalkthrough, startWalkthrough, stepLabel } from "../walkthrough/engine";
import { fixtureCategories, fixtureContext, fixtureHost, fixtureItems } from "../test-support";

/**
 * Guide Core, without any host application: retrieval, walkthrough progress,
 * and the service the panel talks to.
 */

const knowledge = createMemoryKnowledgeProvider(fixtureItems(), fixtureCategories);
const retriever = createDeterministicRetriever(knowledge);

const retrieve = (query: string, over = {}) =>
  retriever.retrieve({ query, context: fixtureContext(over) });

describe("deterministic retrieval", () => {
  it("answers an exact title confidently", async () => {
    const result = await retrieve("Make a widget");
    expect(result.hits[0]?.item.id).toBe("widgets.create");
    expect(result.confident).toBe(true);
  });

  it("matches a question by its alias, in the reader's own words", async () => {
    const result = await retrieve("Who can see my widgets?");
    expect(result.hits[0]?.item.id).toBe("widgets.sharing");
    expect(result.hits[0]?.reasons.join()).toContain("alias");
  });

  it("matches keywords", async () => {
    const result = await retrieve("visibility");
    expect(result.hits.map((h) => h.item.id)).toContain("widgets.sharing");
  });

  it("lets the current page break ties, but never invent a match", async () => {
    const onList = await retrieve("widgets", { page: "widget-list", module: "widgets" });
    const elsewhere = await retrieve("widgets", { page: "other", module: "other", topics: [] });
    expect(onList.hits[0]!.score).toBeGreaterThan(elsewhere.hits[0]!.score);

    const unrelated = await retrieve("banana bread recipe", { page: "widget-list" });
    expect(unrelated.hits).toEqual([]);
  });

  it("does not find what the reader's capabilities hide", async () => {
    const without = await retrieve("change the settings");
    expect(without.hits.map((h) => h.item.id)).not.toContain("admin.settings");
    const withCapability = await retrieve("change the settings", { capabilities: ["manage-site"] });
    expect(withCapability.hits[0]?.item.id).toBe("admin.settings");
  });

  it("hides items while a context flag says so", async () => {
    expect((await retrieve("invitation email")).hits[0]?.item.id).toBe("help.invite-email");
    expect((await retrieve("invitation email", { flags: ["demo"] })).hits).toEqual([]);
  });
});

describe("walkthrough progress", () => {
  it("moves forward, back, completes and restarts", () => {
    let progress = startWalkthrough("w", 3);
    expect(stepLabel(progress)).toBe("Step 1 of 3");
    progress = moveWalkthrough(progress, "back");
    expect(progress.step).toBe(0);
    progress = moveWalkthrough(moveWalkthrough(progress, "next"), "next");
    expect(stepLabel(progress)).toBe("Step 3 of 3");
    expect(progress.completed).toBe(false);
    progress = moveWalkthrough(progress, "next");
    expect(progress.completed).toBe(true);
    expect(moveWalkthrough(progress, "back")).toMatchObject({ step: 1, completed: false });
    expect(moveWalkthrough(progress, "restart")).toMatchObject({ step: 0, completed: false });
  });
});

describe("the Guide service", () => {
  const make = (over = {}, events: GuideEvent[] = []) => {
    const context = fixtureContext(over);
    const { host, navigated } = fixtureHost(() => context, events);
    return { service: createGuideService({ host, knowledge, retriever }), navigated, events };
  };

  it("opens on this page's help, with its walkthroughs apart", async () => {
    const home = await make({ topics: ["widgets.sharing"] }).service.home();
    if (home.kind !== "home") throw new Error(home.kind);
    expect(home.title).toBe("Widgets");
    expect(home.suggestions.map((s) => s.id)).toEqual([
      "widgets.page",
      "widgets.sharing",
      "widgets.create",
    ]);
    expect(home.walkthroughs.map((s) => s.id)).toEqual(["widgets.tour"]);
  });

  it("shows a topic with related topics and only destinations the reader may open", async () => {
    const topic = await make().service.topic("widgets.page");
    if (topic.kind !== "article") throw new Error(topic.kind);
    expect(topic.related.map((r) => r.id)).toEqual(["widgets.create", "widgets.sharing"]);
    expect(topic.destinations).toEqual([{ id: "widget-list", label: "Open Widgets" }]);
    expect(topic.sourceIds).toEqual(["widgets.page"]);

    const settings = await make({ capabilities: ["manage-site"] }).service.topic("admin.settings");
    if (settings.kind !== "article") throw new Error(settings.kind);
    expect(settings.destinations.map((d) => d.id)).toEqual(["settings"]);
  });

  it("answers a hidden topic as if it were not there", async () => {
    const hidden = await make().service.topic("admin.settings");
    expect(hidden.kind).toBe("fallback");
    expect(JSON.stringify(hidden)).not.toContain("Change the settings");
  });

  it("answers a confident question directly, with other matches beside it", async () => {
    const response = await make().service.ask("how do I add a widget");
    if (response.kind !== "results") throw new Error(response.kind);
    expect(response.answer?.item.id).toBe("widgets.create");
    expect(response.sourceIds[0]).toBe("widgets.create");
  });

  it("says it could not find an answer rather than inventing one, and records the miss", async () => {
    const events: GuideEvent[] = [];
    const response = await make({}, events).service.ask("what is the meaning of life");
    if (response.kind !== "fallback") throw new Error(response.kind);
    expect(response.suggestions.length).toBeGreaterThan(0);
    expect(response.sourceIds).toEqual([]);
    expect(events).toContainEqual({
      type: "guide_search_no_result",
      query: "what is the meaning of life",
      route: "/widgets",
    });
  });

  it("browses only what the reader may see, by category", async () => {
    const browse = await make().service.browse();
    if (browse.kind !== "browse") throw new Error(browse.kind);
    expect(browse.categories.map((c) => c.id)).toEqual(["start", "admin"]);
    expect(JSON.stringify(browse)).not.toContain("admin.settings");
  });

  it("keeps a walkthrough step's destination only when the reader may open it", async () => {
    const walkthrough = await make().service.topic("widgets.tour");
    if (walkthrough.kind !== "walkthrough") throw new Error(walkthrough.kind);
    expect(walkthrough.steps[0]?.destination).toBe("widget-list");
  });
});
