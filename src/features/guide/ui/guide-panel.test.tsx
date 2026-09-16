/**
 * @vitest-environment jsdom
 *
 * The Guide panel in a browser-like DOM, with a host that is not Oikonomia:
 * opening it, this page's help, asking, following results and related topics,
 * a walkthrough, the honest fallback, and closing with focus returned.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryKnowledgeProvider } from "../knowledge/repository";
import { fixtureCategories, fixtureContext, fixtureHost, fixtureItems } from "../test-support";
import { GuidePanel, GuideToggle } from "./guide-panel";
import { GuideProvider } from "./guide-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let navigated: string[];

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const text = () => container.textContent ?? "";
const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim().startsWith(label),
  );
  if (!found) throw new Error(`no button "${label}" in: ${text().slice(0, 300)}`);
  return found;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
  await flush();
};
const ask = async (query: string) => {
  const input = container.querySelector<HTMLInputElement>("#guide-query")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.form!.requestSubmit());
  await flush();
};

beforeEach(async () => {
  /* Wide: the Guide is a rail beside the page. */
  vi.stubGlobal(
    "matchMedia",
    () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
  window.localStorage.clear();
  const knowledge = createMemoryKnowledgeProvider(fixtureItems(), fixtureCategories);
  const fixture = fixtureHost(() => fixtureContext());
  navigated = fixture.navigated;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <GuideProvider host={fixture.host} loadKnowledge={async () => knowledge} routeKey="/widgets">
        <GuideToggle />
        <GuidePanel />
      </GuideProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the Guide panel", () => {
  it("opens on this page's help and closes back to the button", async () => {
    expect(container.querySelector("aside")).toBeNull();
    await click("Open the Guide");
    expect(container.querySelector('aside[aria-label="Guide"]')).not.toBeNull();
    expect(text()).toContain("Help for this page");
    expect(text()).toContain("Make a widget");
    expect(text()).toContain("Walk me through");
    expect(document.activeElement?.id).toBe("guide-query");

    await act(async () => {
      container
        .querySelector("aside")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(container.querySelector("aside")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Open the Guide");
  });

  it("answers a question from curated help, and follows related topics", async () => {
    await click("Open the Guide");
    await ask("how do I add a widget");
    expect(text()).toContain("You asked: “how do I add a widget”");
    expect(text()).toContain("Choose New widget");

    await click("Who can see a widget");
    expect(text()).toContain("Who can see a widget");
    expect(text()).toContain("Some text.");
    await click("Previous help");
    expect(text()).toContain("You asked");
  });

  it("says plainly when it has no answer", async () => {
    await click("Open the Guide");
    await ask("what is the meaning of life");
    expect(text()).toContain("I couldn't find an answer to that.");
    expect(text()).toContain("Browse all help");
  });

  it("asks the host to navigate, and never does anything else", async () => {
    await click("Open the Guide");
    await click("Widgets");
    await click("Open Widgets");
    expect(navigated).toEqual(["widget-list"]);
  });

  it("walks through steps with back, next and finish", async () => {
    await click("Open the Guide");
    await click("Make your first widget");
    expect(text()).toContain("Step 1 of 3");
    expect(text()).toContain("Open the list");
    await click("Open Widgets");
    expect(navigated).toEqual(["widget-list"]);
    await click("Next");
    expect(text()).toContain("Step 2 of 3");
    await click("Back");
    expect(text()).toContain("Step 1 of 3");
    await click("Next");
    await click("Next");
    await click("Finish");
    expect(text()).toContain("Done — Make your first widget");
  });

  it("browses all help by category", async () => {
    await click("Open the Guide");
    await click("Browse all help");
    expect(text()).toContain("All help");
    expect(text()).toContain("Getting started");
    expect(text()).not.toContain("Change the settings");
  });
});
