import { format } from "date-fns";

import { fromISO } from "./schedule";
import type { Comment, ReachOutReport } from "./types";

/**
 * Reach-Out logic.
 *
 * Almost nothing, on purpose. The module knows that a report is a report, who
 * wrote it, when it belongs, what it says and what was said about it. It does
 * not know whether the leader was visiting a family, walking a park, calling
 * people or handing out invitations — and it must not learn, because the moment
 * it does, every ministry practice that does not fit the vocabulary becomes
 * awkward to record.
 */

/** Newest first: a leader opens Reach-Out to see what was written recently. */
export function reportsNewestFirst(reports: ReachOutReport[]): ReachOutReport[] {
  return [...reports].sort(
    (a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt),
  );
}

export function reportById(reports: ReachOutReport[], id: string): ReachOutReport | undefined {
  return reports.find((report) => report.id === id);
}

/**
 * The first line or so, for the list.
 *
 * Cut on a word boundary so the preview does not end mid-word, and never
 * reformat the content — the list is a way in, not a summary.
 */
export function preview(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Free-text search across the things a leader would actually remember: the
 * title, who wrote it, and the words in the report.
 */
export function searchReports(
  reports: ReachOutReport[],
  query: string,
  nameOf: (personId: string) => string,
): ReachOutReport[] {
  const q = query.trim().toLowerCase();
  if (!q) return reports;
  return reports.filter(
    (report) =>
      report.title.toLowerCase().includes(q) ||
      report.content.toLowerCase().includes(q) ||
      nameOf(report.authorId).toLowerCase().includes(q),
  );
}

/**
 * Whether this leader may work on this report.
 *
 * Reach-Out is shared leadership work: one leader may lead an effort, another
 * write it up, and a third add what they saw. **Authorship is provenance, not
 * exclusive ownership**, so writing a report first does not make it private
 * property, and no leader has to be assigned to Reach-Out before contributing.
 *
 * This is kept as a named seam rather than inlined as `true`. Report-level
 * visibility is an open design decision (see `modules/REACH-OUT.md`); when real
 * rules exist, this is the one place they attach.
 */
export function canContribute(_report: ReachOutReport, _personId: string): boolean {
  return true;
}

/**
 * Everyone who has worked on the report, the first author first.
 *
 * Shown so a reader knows whose account this is, without implying that any of
 * them owns it.
 */
export function contributorsOf(report: ReachOutReport): string[] {
  return [...new Set([report.authorId, ...(report.contributorIds ?? [])])];
}

/** Leaders other than the first author who have added to it. */
export function laterContributors(report: ReachOutReport): string[] {
  return contributorsOf(report).filter((id) => id !== report.authorId);
}

/** A report is untouched when nobody has come back to it since writing. */
export const wasEdited = (report: ReachOutReport): boolean =>
  report.updatedAt.slice(0, 10) !== report.createdAt.slice(0, 10);

export function commentCount(report: ReachOutReport): number {
  return report.comments.filter((comment) => !comment.system).length;
}

export function commentsInOrder(report: ReachOutReport): Comment[] {
  return [...report.comments].sort((a, b) => a.at.localeCompare(b.at));
}

/** A report with no title yet still needs something to call it in a list. */
export const displayTitle = (report: ReachOutReport): string =>
  report.title.trim() || "Untitled report";

export const reportDateLabel = (iso: string) => format(fromISO(iso), "d MMMM yyyy");

export const shortDateLabel = (iso: string) => format(fromISO(iso), "d MMM");
