import { config } from "@/config";
import type {
  BinderLink,
  MeetingBlock,
  MeetingBlockType,
  MeetingNote,
  MeetingNoteType,
  MeetingTask,
  MeetingType,
} from "./types";

/**
 * Meeting Notes logic.
 *
 * The document is blocks; structure emerges from writing rather than being
 * demanded up front. Everything here operates on that block list.
 */

export const meetingTypeLabel = config.labels("meetings.types") as Record<MeetingType, string>;

export const meetingTypes = Object.keys(meetingTypeLabel) as MeetingType[];

/* ----------------------------------------------------------- note types */

export const noteTypeLabel = config.labels("meetings.noteTypes") as Record<MeetingNoteType, string>;

/**
 * What each kind is for, in the leader's words.
 *
 * Shown once, when choosing — the distinction matters and is not obvious from
 * two words alone.
 */
export const noteTypeHint: Record<MeetingNoteType, string> = {
  personal: "Your own working record. Write as much or as little as you like.",
  minutes: "The meeting's record for the people it concerned.",
};

export const isMinutes = (note: MeetingNote) => note.noteType === "minutes";

/**
 * Who can read this note, as a sentence.
 *
 * A **statement, not a setting.** Readership follows from the note's type:
 * a personal note is its author's, minutes are for the people the meeting
 * concerned, and `authorize.ts` is the only thing that decides. Offering a
 * dropdown would be offering a choice the application does not honour.
 *
 * There used to be a second field. `meeting_note.visibility` was written on
 * every note, accepted from the API, and read by **nothing** — so a caller
 * could set a personal note to "leaders", be answered with success, and
 * reasonably believe it had been shared. Migration 027 removed it. The type is
 * the whole of the rule.
 *
 * When real sharing arrives, this sentence is what becomes a control — with a
 * field that is actually consulted behind it.
 */
export function readership(note: Pick<MeetingNote, "noteType">): string {
  return note.noteType === "personal"
    ? "Your own note. Only you can read it."
    : "Minutes. Readable by whoever was at the meeting.";
}

/* ----------------------------------------------------------------- tags */

/**
 * Tags describe the note. They never carry an organizational relationship —
 * that is what a context link is for.
 */
export const normalizeTag = (raw: string): string =>
  raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase().slice(0, 32);

export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (!tag || tags.includes(tag)) return tags;
  return [...tags, tag];
}

export const removeTag = (tags: string[], tag: string): string[] =>
  tags.filter((existing) => existing !== tag);

/**
 * Every tag in use, most used first.
 *
 * Suggesting what already exists is how spelling converges without anybody
 * defining a taxonomy in advance.
 */
export function knownTags(notes: MeetingNote[]): string[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** Existing tags matching what is being typed, minus those already on the note. */
export function suggestTags(notes: MeetingNote[], partial: string, already: string[]): string[] {
  const q = normalizeTag(partial);
  return knownTags(notes)
    .filter((tag) => !already.includes(tag))
    .filter((tag) => (q ? tag.includes(q) : true))
    .slice(0, 6);
}

/* -------------------------------------------------------- context links */

/**
 * The organizational entity a meeting belongs to.
 *
 * Deliberately a link to the real record rather than a name string or a
 * hashtag, so Music Ministry can list its own meetings and the note stays a
 * single artifact seen from several places.
 */
export type ContextKind = Extract<BinderLink["kind"], "ministry">;

export function contextLink(note: MeetingNote, kind: ContextKind): BinderLink | undefined {
  return note.links.find((link) => link.kind === kind);
}

export const ministryContextId = (note: MeetingNote): string | undefined =>
  contextLink(note, "ministry")?.id;

/** Replaces the note's context of this kind, or clears it when `id` is absent. */
export function setContext(links: BinderLink[], kind: ContextKind, id?: string): BinderLink[] {
  const rest = links.filter((link) => link.kind !== kind);
  return id ? [...rest, { kind, id }] : rest;
}

/** Blocks that hold writing, as opposed to dividers. */
export const isTextBlock = (type: MeetingBlockType) => type !== "divider";

let counter = 0;
export const newBlockId = () => `blk-${Date.now().toString(36)}-${(counter += 1)}`;

export function emptyBlock(type: MeetingBlockType = "paragraph"): MeetingBlock {
  return {
    id: newBlockId(),
    type,
    html: "",
    ...(type === "checklist" ? { checked: false } : {}),
    ...(type === "follow-up" ? { state: "open" as const } : {}),
  };
}

/**
 * The document a new set of minutes opens with.
 *
 * **Starter content, not required fields.** Every heading here is an ordinary
 * block: the note taker may rename it, delete it, reorder it or add their own,
 * because meetings differ and a template that cannot be edited is a form.
 *
 * A personal note gets none of this — it opens on one empty paragraph, so the
 * first interaction is "start writing".
 */
export function minutesTemplate(): MeetingBlock[] {
  const heading = (text: string) => ({ ...emptyBlock("heading-2"), html: text });

  return [
    heading("Attendees"),
    emptyBlock("paragraph"),
    heading("Agenda"),
    emptyBlock("bullet"),
    heading("Discussion"),
    emptyBlock("paragraph"),
    heading("Decisions"),
    emptyBlock("decision"),
    heading("Action items"),
    emptyBlock("checklist"),
    heading("Follow-up and next meeting"),
    emptyBlock("paragraph"),
  ];
}

export const startingBlocks = (noteType: MeetingNoteType): MeetingBlock[] =>
  noteType === "minutes" ? minutesTemplate() : [emptyBlock("paragraph")];

/* ------------------------------------------------------------ sanitizing */

/**
 * Inline HTML allowlist.
 *
 * Editor content is user input rendered back as markup, so it is sanitized
 * rather than trusted. Only inline marks survive; anything structural is
 * stripped, because structure belongs to the block, not to the markup.
 */
const ALLOWED = /^(b|strong|i|em|u|br|a)$/i;

export function sanitizeInline(html: string): string {
  if (typeof document === "undefined") return stripTags(html);

  const template = document.createElement("template");
  template.innerHTML = html;

  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;

      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }

      const el = child as HTMLElement;
      if (!ALLOWED.test(el.tagName)) {
        /* Unwrap rather than drop, so the words survive the tag — but clean the
           subtree *first*. Promoting children straight into the parent moved
           them out of the list this loop is walking, so they were never
           visited: `<div><b onmouseover=…>` came back with its handler intact
           and needed a second pass to lose it. */
        walk(el);
        el.replaceWith(...el.childNodes);
        continue;
      }

      for (const attr of [...el.attributes]) {
        const keep =
          el.tagName.toLowerCase() === "a" &&
          attr.name === "href" &&
          /^(https?:|mailto:|\/)/i.test(attr.value);
        if (!keep) el.removeAttribute(attr.name);
      }

      if (el.tagName.toLowerCase() === "a") {
        el.setAttribute("rel", "noreferrer");
        el.setAttribute("target", "_blank");
      }

      walk(el);
    }
  };

  walk(template.content);
  return template.innerHTML;
}

/** Server-safe fallback and the basis for search and print. */
export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/* ------------------------------------------------- the server's own check */

/**
 * Whether inline HTML is within the allowlist — decidable without a DOM.
 *
 * ## Why this exists
 *
 * `sanitizeInline` needs `document`, so it runs only in the browser, and the
 * browser is the one participant in this exchange that an attacker controls.
 * A block posted straight to the server function was stored exactly as sent
 * and later written into another leader's page with `innerHTML`. `<script>`
 * does not run that way, but `<img src=x onerror=…>` does: a note shared with
 * the leadership team was a way to run script in every reader's session.
 *
 * ## Why it refuses rather than sanitizes
 *
 * Rewriting on the server would mean a second allowlist implementation that
 * could drift from the first. This shares the allowlist and answers only
 * yes or no. An honest client sanitizes before sending, so it never trips;
 * anything that does trip was not written by the editor.
 */
export function inlineHtmlIsSafe(html: string): boolean {
  if (!html) return true;

  /* Any attribute that is an event handler, wherever it appears. */
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) return false;

  for (const [, closing, tag, attributes] of html.matchAll(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g,
  )) {
    if (!ALLOWED.test(tag!)) return false;
    if (closing) continue;

    /* Only `a` carries attributes: a safe `href`, plus the `rel` and `target`
       the sanitizer itself adds to every link it keeps. */
    const rest = (attributes ?? "").replace(/\/\s*$/, "").trim();
    if (!rest) continue;
    if (tag!.toLowerCase() !== "a") return false;

    let seenHref = false;
    for (const [, attribute, quoted, single, bare] of rest.matchAll(
      /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g,
    )) {
      const name = attribute!.toLowerCase();
      const value = (quoted ?? single ?? bare ?? "").trim();

      if (name === "href") {
        if (!/^(https?:|mailto:|\/)/i.test(value)) return false;
        seenHref = true;
        continue;
      }
      if (name === "rel" || name === "target") continue;
      return false;
    }

    /* An anchor whose href the sanitizer removed keeps `rel` and `target` and
       is no longer a link, which is harmless — and is exactly what
       `sanitizeInline` produces for `javascript:`. Refusing it here would
       refuse the sanitizer's own output. */
    void seenHref;
  }

  return true;
}

export const blockText = (block: MeetingBlock) => stripTags(block.html);

/** Plain text of the whole note, for search. */
export function noteText(note: MeetingNote): string {
  return [note.title, ...note.blocks.map(blockText)].join(" ").toLowerCase();
}

/* -------------------------------------------------------------- activity */

/**
 * What the meeting produced. Counted from the document itself, so it can never
 * drift from what the leader actually wrote.
 */
export function meetingActivity(note: MeetingNote, tasks: MeetingTask[]) {
  const own = tasks.filter((task) => task.meetingId === note.id);
  return {
    tasks: own.length,
    openTasks: own.filter((task) => task.status === "open").length,
    decisions: note.blocks.filter((b) => b.type === "decision" && blockText(b)).length,
    followUps: note.blocks.filter((b) => b.type === "follow-up" && blockText(b)).length,
    openFollowUps: note.blocks.filter(
      (b) => b.type === "follow-up" && b.state === "open" && blockText(b),
    ).length,
    checklist: note.blocks.filter((b) => b.type === "checklist" && blockText(b)).length,
  };
}

export function tasksFor(tasks: MeetingTask[], meetingId: string): MeetingTask[] {
  return tasks.filter((task) => task.meetingId === meetingId);
}

/* ------------------------------------------------------------ continuity */

/**
 * Meetings of the same type form a series, without asking anyone to configure
 * a recurring-meeting structure. The previous meeting in the series is simply
 * the most recent earlier one of that type.
 */
export function previousInSeries(notes: MeetingNote[], note: MeetingNote): MeetingNote | undefined {
  if (!note.type) return undefined;
  return notes
    .filter((other) => other.id !== note.id && other.type === note.type)
    .filter((other) => other.date < note.date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export interface UnresolvedItem {
  kind: "follow-up" | "task";
  id: string;
  text: string;
  fromMeetingId: string;
}

/** What was left open last time, so the next meeting can pick it up. */
export function unresolvedFrom(note: MeetingNote, tasks: MeetingTask[]): UnresolvedItem[] {
  const followUps: UnresolvedItem[] = note.blocks
    .filter((b) => b.type === "follow-up" && b.state === "open" && blockText(b))
    .map((b) => ({
      kind: "follow-up" as const,
      id: b.id,
      text: blockText(b),
      fromMeetingId: note.id,
    }));

  const open: UnresolvedItem[] = tasksFor(tasks, note.id)
    .filter((task) => task.status === "open")
    .map((task) => ({
      kind: "task" as const,
      id: task.id,
      text: task.title,
      fromMeetingId: note.id,
    }));

  return [...followUps, ...open];
}

/* ----------------------------------------------------------------- lists */

export function sortNotes(notes: MeetingNote[]): MeetingNote[] {
  return [...notes].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Notes carrying a given tag.
 *
 * Used by the filter bar and by clicking a tag on a note, which are the same
 * question asked two ways.
 */
export const notesTagged = (notes: MeetingNote[], tag: string): MeetingNote[] =>
  notes.filter((note) => note.tags.includes(tag));

export function searchNotes(notes: MeetingNote[], query: string): MeetingNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  /* Tags are searchable with or without the hash a leader would type. */
  const tag = normalizeTag(q);
  return notes.filter(
    (note) => noteText(note).includes(q) || (!!tag && note.tags.some((t) => t.includes(tag))),
  );
}

/* --------------------------------------------------------------- filters */

export interface NoteFilter {
  noteType?: MeetingNoteType | undefined;
  tag?: string | undefined;
  ministryId?: string | undefined;
  query?: string | undefined;
}

/**
 * The list, narrowed.
 *
 * One place so the filter bar, a clicked tag and a ministry's own view of its
 * meetings all agree — and so none of them can quietly diverge.
 */
export function filterNotes(notes: MeetingNote[], filter: NoteFilter): MeetingNote[] {
  let out = notes;
  if (filter.noteType) out = out.filter((note) => note.noteType === filter.noteType);
  if (filter.tag) out = notesTagged(out, filter.tag);
  if (filter.ministryId) out = out.filter((note) => ministryContextId(note) === filter.ministryId);
  if (filter.query) out = searchNotes(out, filter.query);
  return sortNotes(out);
}
