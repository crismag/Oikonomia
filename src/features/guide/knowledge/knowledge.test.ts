import { describe, expect, it } from "vitest";

import { file, fixtureSources } from "../test-support";
import { parseFrontMatter } from "./front-matter";
import { blocksText, parseMarkdown } from "./markdown";
import { parseKnowledge } from "./parse";
import { buildCorpus } from "./validate";

/**
 * Knowledge is product data. A file that fails to parse, a relationship that
 * goes nowhere, or a link that could run script must be caught before it ships.
 */

describe("front matter", () => {
  it("reads scalars, inline lists and dash lists", () => {
    const { data, body, errors } = parseFrontMatter(
      '---\nid: a.b\nmodules: [one, two]\naliases:\n  - how do i\n  - "quoted one"\n---\nBody',
    );
    expect(errors).toEqual([]);
    expect(data).toEqual({
      id: "a.b",
      modules: ["one", "two"],
      aliases: ["how do i", "quoted one"],
    });
    expect(body).toBe("Body");
  });

  it("reads a flow list a formatter spread over several lines", () => {
    const { data, errors } = parseFrontMatter(
      "---\nid: a.b\nkeywords:\n  [\n    one,\n    two words,\n  ]\nrelated: [x.y]\n---\nBody",
    );
    expect(errors).toEqual([]);
    expect(data).toEqual({ id: "a.b", keywords: ["one", "two words"], related: ["x.y"] });
  });

  it("reports malformed front matter with its line", () => {
    expect(parseFrontMatter("no front matter").errors[0]).toContain("missing front matter");
    expect(parseFrontMatter("---\nid: a\n").errors[0]).toContain("not closed");
    expect(parseFrontMatter("---\nthis is not a pair\n---\n").errors[0]).toContain("line 2");
  });
});

describe("markdown", () => {
  it("parses paragraphs, headings, lists, notes and inline marks", () => {
    const { blocks, errors } = parseMarkdown(
      "### Heading\n\nA **bold** and *soft* `code` line.\n\n- one\n- two\n\n1. first\n\n> careful",
    );
    expect(errors).toEqual([]);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "note"]);
    expect(blocksText(blocks)).toContain("A bold and soft code line.");
  });

  it("reads underscore emphasis without touching words that contain underscores", () => {
    const { blocks } = parseMarkdown("Add them under _Also visible to_ in snake_case_name.");
    expect(JSON.stringify(blocks)).toContain('"kind":"em"');
    expect(blocksText(blocks)).toBe("Add them under Also visible to in snake_case_name.");
  });

  it("keeps topic and destination links as structure", () => {
    const { blocks, topicLinks, destinationLinks } = parseMarkdown(
      "See [sharing](topic:widgets.sharing) or [the list](destination:widget-list).",
    );
    expect(topicLinks).toEqual(["widgets.sharing"]);
    expect(destinationLinks).toEqual(["widget-list"]);
    expect(JSON.stringify(blocks)).toContain('"kind":"topic"');
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "https://example.com",
    "/admin",
    "topic:Not_Valid",
  ])("refuses a link to %s and renders its text only", (target) => {
    const { blocks, errors } = parseMarkdown(`Click [here](${target}) now.`);
    expect(errors[0]).toContain("is not allowed");
    expect(JSON.stringify(blocks)).not.toContain(target);
    expect(blocksText(blocks)).toBe("Click here now.");
  });

  it("treats raw HTML as text, never markup", () => {
    const { blocks } = parseMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: '<img src=x onerror="alert(1)"> <script>alert(1)</script>' },
        ],
      },
    ]);
  });
});

describe("parsing an item", () => {
  it("reads a walkthrough's steps and their destinations", () => {
    const { item, errors } = parseKnowledge(fixtureSources[3]!.raw, "tour.md");
    expect(errors).toEqual([]);
    expect(item?.steps.map((s) => [s.title, s.destination])).toEqual([
      ["Open the list", "widget-list"],
      ["Choose New widget", undefined],
      ["Save", undefined],
    ]);
    expect(blocksText(item!.steps[0]!.body)).toBe("It is in the menu.");
  });

  it("refuses a walkthrough with no steps", () => {
    const raw = file(
      "id: x.tour\ntitle: T\ntype: walkthrough\ncategory: start\nsummary: S",
      "Intro only.",
    );
    expect(parseKnowledge(raw, "x.md").errors.join()).toContain("at least one step");
  });

  it("refuses missing fields, unknown fields, bad ids and bad types", () => {
    const raw = file("id: Bad Id\ntitle: T\ntype: essay\ncategory: start\ncolour: blue");
    const errors = parseKnowledge(raw, "x.md").errors.join("\n");
    expect(errors).toContain('"summary" is required');
    expect(errors).toContain('unknown field "colour"');
    expect(errors).toContain("must be lower-case words");
    expect(errors).toContain('type "essay"');
  });
});

describe("building a corpus", () => {
  const rules = {
    categories: ["start", "admin"],
    destinations: (id: string) => ["widget-list", "settings"].includes(id),
    capabilities: (c: string) => c === "manage-site",
  };

  it("accepts a valid pack", () => {
    const { items, errors } = buildCorpus(fixtureSources, rules);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(fixtureSources.length);
  });

  it("catches duplicate ids and relationships that go nowhere", () => {
    const { errors } = buildCorpus(
      [
        ...fixtureSources,
        { path: "dup.md", raw: fixtureSources[0]!.raw },
        {
          path: "broken.md",
          raw: file(
            "id: broken.related\ntitle: T\ntype: concept\ncategory: start\nsummary: S\nrelated: [widgets.does-not-exist]",
            "See [nothing](topic:also.missing).",
          ),
        },
      ],
      rules,
    );
    expect(errors.join("\n")).toContain('id "widgets.page" is already used');
    expect(errors.join("\n")).toContain('related "widgets.does-not-exist" does not exist');
    expect(errors.join("\n")).toContain('link to topic "also.missing" goes nowhere');
  });

  it("catches unknown categories, destinations and capabilities", () => {
    const { errors } = buildCorpus(
      [
        {
          path: "odd.md",
          raw: file(
            "id: odd.item\ntitle: T\ntype: concept\ncategory: nowhere\nsummary: S\ncapabilities: [fly]\ndestinations: [moon]",
          ),
        },
      ],
      rules,
    );
    expect(errors.join("\n")).toContain('category "nowhere"');
    expect(errors.join("\n")).toContain('destination "moon"');
    expect(errors.join("\n")).toContain('capability "fly"');
  });
});
