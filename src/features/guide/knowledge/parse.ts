import {
  knowledgeTypes,
  type KnowledgeItem,
  type KnowledgeType,
  type WalkthroughStep,
} from "../core/types";
import { parseFrontMatter, type FrontMatterValue } from "./front-matter";
import { parseMarkdown } from "./markdown";

/**
 * One knowledge file → one knowledge item, or errors.
 *
 * A walkthrough's steps are its `## ` sections, in order. Inside a step, a line
 * `Destination: <id>` says where the step happens; it is metadata, not text.
 * Anything before the first step is the walkthrough's introduction.
 */

export interface ParsedKnowledge {
  item?: KnowledgeItem;
  errors: string[];
  /** Every destination the file refers to, for the host to check. */
  destinations: string[];
  /** Every topic the file links to in its text. */
  topicLinks: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

const LIST_FIELDS = [
  "modules",
  "pages",
  "keywords",
  "aliases",
  "capabilities",
  "hideWhen",
  "related",
  "destinations",
] as const;
const SCALAR_FIELDS = ["id", "title", "type", "summary", "category"] as const;
const KNOWN = new Set<string>([...LIST_FIELDS, ...SCALAR_FIELDS]);

export function parseKnowledge(raw: string, source: string): ParsedKnowledge {
  const errors: string[] = [];
  const front = parseFrontMatter(raw);
  errors.push(...front.errors);

  const scalar = (key: (typeof SCALAR_FIELDS)[number]): string => {
    const value = front.data[key];
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`"${key}" is required`);
      return "";
    }
    return value.trim();
  };
  const list = (key: (typeof LIST_FIELDS)[number]): string[] => {
    const value: FrontMatterValue | undefined = front.data[key];
    if (value === undefined) return [];
    if (typeof value === "string") return [value];
    return value;
  };

  for (const key of Object.keys(front.data)) {
    if (!KNOWN.has(key)) errors.push(`unknown field "${key}"`);
  }

  const id = scalar("id");
  const title = scalar("title");
  const summary = scalar("summary");
  const category = scalar("category");
  const type = scalar("type");
  if (id && !ID.test(id)) errors.push(`id "${id}" must be lower-case words joined by dots`);
  if (type && !knowledgeTypes.includes(type as KnowledgeType)) {
    errors.push(`type "${type}" is not one of ${knowledgeTypes.join(", ")}`);
  }

  const destinations = [...list("destinations")];
  const topicLinks: string[] = [];

  let intro = front.body;
  const steps: WalkthroughStep[] = [];

  if (type === "walkthrough") {
    const sections = front.body.split(/^## /m);
    intro = sections.shift() ?? "";
    for (const section of sections) {
      const newline = section.indexOf("\n");
      const stepTitle = (newline === -1 ? section : section.slice(0, newline)).trim();
      let text = newline === -1 ? "" : section.slice(newline + 1);
      let destination: string | undefined;
      text = text.replace(/^Destination:\s*(\S+)\s*$/m, (_line, value: string) => {
        destination = value;
        return "";
      });
      const parsed = parseMarkdown(text);
      errors.push(...parsed.errors.map((e) => `step "${stepTitle}": ${e}`));
      topicLinks.push(...parsed.topicLinks);
      destinations.push(...parsed.destinationLinks);
      if (destination) destinations.push(destination);
      if (!stepTitle) errors.push("a step has no title");
      if (parsed.blocks.length === 0) errors.push(`step "${stepTitle}" has no text`);
      steps.push({
        title: stepTitle,
        body: parsed.blocks,
        ...(destination ? { destination } : {}),
      });
    }
    if (steps.length === 0) errors.push("a walkthrough needs at least one step (## sections)");
  }

  const body = parseMarkdown(intro);
  errors.push(...body.errors);
  topicLinks.push(...body.topicLinks);
  destinations.push(...body.destinationLinks);
  if (type !== "walkthrough" && body.blocks.length === 0) errors.push("the body is empty");

  if (errors.length > 0) {
    return { errors: errors.map((e) => `${source}: ${e}`), destinations, topicLinks };
  }

  return {
    item: {
      id,
      title,
      type: type as KnowledgeType,
      summary,
      category,
      modules: list("modules"),
      pages: list("pages"),
      keywords: list("keywords"),
      aliases: list("aliases"),
      capabilities: list("capabilities"),
      hideWhen: list("hideWhen"),
      related: list("related"),
      destinations: list("destinations"),
      body: body.blocks,
      steps,
      source,
    },
    errors: [],
    destinations: [...new Set(destinations)],
    topicLinks: [...new Set(topicLinks)],
  };
}
