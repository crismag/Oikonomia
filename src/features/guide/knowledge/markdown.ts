import type { GuideBlock, GuideInline } from "../core/types";

/**
 * The Markdown subset knowledge is written in, parsed to structure.
 *
 * Output is data (`GuideBlock`), rendered by React as text — there is no HTML
 * path, so nothing in a knowledge file can inject markup or script.
 *
 * Blocks: paragraphs, `### headings`, `- ` and `1. ` lists, `> ` notes.
 * Inline: `**strong**`, `*emphasis*` or `_emphasis_`, `` `code` ``, and two kinds of link:
 *
 *   [text](topic:reports.visibility)       another knowledge item
 *   [text](destination:leadership-reports) a place in the host application
 *
 * Any other link target — `https:`, `javascript:`, `data:`, a bare path — is
 * reported as an error and rendered as plain text.
 */

export interface MarkdownResult {
  blocks: GuideBlock[];
  errors: string[];
  topicLinks: string[];
  destinationLinks: string[];
}

export function parseMarkdown(source: string): MarkdownResult {
  const errors: string[] = [];
  const topicLinks: string[] = [];
  const destinationLinks: string[] = [];
  const inline = (text: string) => parseInline(text, { errors, topicLinks, destinationLinks });

  const blocks: GuideBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let note: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", content: inline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(inline) });
      list = null;
    }
    if (note.length) {
      blocks.push({ kind: "note", content: inline(note.join(" ")) });
      note = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{2,4}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1]!.trim() });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (paragraph.length || note.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      if (paragraph.length || list) flush();
      note.push(quote[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(rawLine)) {
      /* A wrapped list item continues the last one. */
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list || note.length) flush();
    paragraph.push(line.trim());
  }
  flush();

  return { blocks, errors, topicLinks, destinationLinks };
}

interface InlineSink {
  errors: string[];
  topicLinks: string[];
  destinationLinks: string[];
}

/* A link target runs to the `)` that ends the link — the one followed by a
   space, punctuation or the end — so `javascript:alert(1)` is read whole and
   refused whole, rather than leaving its tail behind as text. */
const INLINE =
  /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[([^\]]+)\]\((\S*?)\)(?=[\s.,;:!?]|$))|((?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9]))/;

export function parseInline(text: string, sink: InlineSink): GuideInline[] {
  const out: GuideInline[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ kind: "text", text: rest.slice(0, match.index) });

    if (match[1]) {
      out.push({ kind: "strong", children: parseInline(match[2]!, sink) });
    } else if (match[3]) {
      out.push({ kind: "code", text: match[4]! });
    } else if (match[5]) {
      out.push({ kind: "em", children: parseInline(match[6]!, sink) });
    } else if (match[10]) {
      out.push({ kind: "em", children: parseInline(match[11]!, sink) });
    } else if (match[7]) {
      const label = parseInline(match[8]!, sink);
      const target = match[9]!;
      const link = /^(topic|destination):([a-z0-9][a-z0-9.-]*)$/.exec(target);
      if (link?.[1] === "topic") {
        sink.topicLinks.push(link[2]!);
        out.push({ kind: "topic", id: link[2]!, children: label });
      } else if (link?.[1] === "destination") {
        sink.destinationLinks.push(link[2]!);
        out.push({ kind: "destination", id: link[2]!, children: label });
      } else {
        sink.errors.push(`link "${target}" is not allowed — use topic:<id> or destination:<id>`);
        out.push(...label);
      }
    }
    rest = rest.slice(match.index + match[0].length);
  }

  return out;
}

/** Plain text of blocks, for search and future indexing. */
export function blocksText(blocks: GuideBlock[]): string {
  const inlineText = (content: GuideInline[]): string =>
    content
      .map((node) =>
        node.kind === "text" || node.kind === "code" ? node.text : inlineText(node.children),
      )
      .join("");
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "heading":
          return block.text;
        case "paragraph":
        case "note":
          return inlineText(block.content);
        case "list":
          return block.items.map(inlineText).join(" ");
      }
    })
    .join(" ");
}
