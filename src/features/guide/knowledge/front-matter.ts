/**
 * Front matter, in the small subset of YAML knowledge files need.
 *
 * Supported: `key: value`, `key: [a, b]`, and a key followed by `- item` lines.
 * Values are strings; surrounding quotes are removed. Anything else is an
 * error, reported with its line — a knowledge file is product data, and a
 * field that silently fails to parse is a topic that silently disappears.
 *
 * Deliberately not a YAML dependency: the format is ours to keep simple.
 */

export type FrontMatterValue = string | string[];

export interface FrontMatterResult {
  data: Record<string, FrontMatterValue>;
  body: string;
  errors: string[];
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

export function parseFrontMatter(raw: string): FrontMatterResult {
  const text = raw.replace(/\r\n/g, "\n");
  const errors: string[] = [];
  if (!text.startsWith("---\n")) {
    return {
      data: {},
      body: text,
      errors: ["missing front matter (the file must start with ---)"],
    };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, body: text, errors: ["front matter is not closed with ---"] };
  }

  /* A flow list may be spread over several lines, as formatters write long
     ones — `keywords:\n  [\n    a,\n    b,\n  ]` — so those lines are joined
     back onto their key before parsing. */
  const lines: string[] = [];
  for (const line of text.slice(4, end).split("\n")) {
    const previous = lines[lines.length - 1];
    const open = previous !== undefined && previous.includes("[") && !previous.includes("]");
    if (open) lines[lines.length - 1] = `${previous} ${line.trim()}`;
    else if (previous !== undefined && /:\s*$/.test(previous) && line.trim().startsWith("[")) {
      lines[lines.length - 1] = `${previous} ${line.trim()}`;
    } else lines.push(line);
  }
  const body = text.slice(end + 4).replace(/^\n/, "");
  const data: Record<string, FrontMatterValue> = {};
  let listKey: string | null = null;

  lines.forEach((line, index) => {
    const at = `front matter line ${index + 2}`;
    if (!line.trim() || line.trim().startsWith("#")) return;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!listKey) {
        errors.push(`${at}: list item without a key`);
        return;
      }
      (data[listKey] as string[]).push(unquote(item[1]!));
      return;
    }

    const pair = /^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/.exec(line);
    if (!pair) {
      errors.push(`${at}: expected "key: value", found "${line.trim()}"`);
      listKey = null;
      return;
    }
    const key = pair[1]!;
    const value = (pair[2] ?? "").trim();
    if (key in data) errors.push(`${at}: "${key}" appears twice`);

    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[")) {
      if (!value.endsWith("]")) errors.push(`${at}: "${key}" list is not closed with ]`);
      data[key] = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((part) => part.trim())
        .map(unquote)
        .filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  });

  return { data, body, errors };
}
