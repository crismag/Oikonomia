import { format } from "date-fns";

import { config, entryStrategies, type EntryStrategy } from "@/config";
import { categoriesFor } from "./categories";
import { fromISO } from "./schedule";
import type {
  AttendanceStatus,
  EntryVisibility,
  Exhortation,
  Gathering,
  GatheringAttendance,
  GatheringReport,
  GatheringStatus,
  LifegroupEntry,
  LifegroupEntryCategory,
  Venue,
} from "./types";

/**
 * LifeGroup logic.
 *
 * Everything here hangs off a gathering. There is no roster to consult, no
 * group to look up a person's membership in, and no leader who owns anything
 * beyond the occurrences they were assigned. Where a question sounds like it
 * needs membership — "is this person in the group?" — the honest answer is a
 * history: which gatherings they came to.
 */

/* ---------------------------------------------------------------- venues */

export function venueFor(venues: Venue[], gathering: Gathering): Venue | undefined {
  return gathering.venueId ? venues.find((venue) => venue.id === gathering.venueId) : undefined;
}

/**
 * What to call the place.
 *
 * Falls back to the snapshot taken when the gathering was created, so a
 * gathering never loses its identity because a venue record changed.
 */
export function venueName(venues: Venue[], gathering: Gathering): string {
  return venueFor(venues, gathering)?.name ?? gathering.venueName ?? "Venue not set";
}

/**
 * How a gathering is named in lists and in print.
 *
 * Venue and date together — "Baronia Residence · 9 Sep" — because the venue
 * alone is a place that hosts many gatherings, not the name of a group.
 */
export function gatheringLabel(venues: Venue[], gathering: Gathering): string {
  return `${venueName(venues, gathering)} · ${format(fromISO(gathering.date), "d MMM")}`;
}

/**
 * What to call a gathering when the date is already shown beside it.
 *
 * The venue is the gathering's name — a home or a room, not a group. When
 * there is no venue yet, the title has to say what is still needed rather
 * than reading as a place called "Venue not set".
 */
export function gatheringHeadline(venues: Venue[], gathering: Gathering): string {
  const name = venueFor(venues, gathering)?.name ?? gathering.venueName?.trim();
  if (name) return name;
  return gathering.assignedLeaderIds.length > 0 ? "Set the venue" : "Unclaimed gathering";
}

/** Gatherings that have met at a venue. A venue is reused, never owned. */
export function gatheringsAtVenue(gatherings: Gathering[], venueId: string): Gathering[] {
  return byDateDescending(gatherings.filter((g) => g.venueId === venueId));
}

/* ------------------------------------------------------------- gatherings */

/* Words come from configuration; this module decides what they mean. */
export const gatheringStatusLabel = config.labels("lifegroup.gatheringStatuses") as Record<
  GatheringStatus,
  string
>;

const byDateDescending = (list: Gathering[]) =>
  [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.startTime ?? "").localeCompare(a.startTime ?? ""),
  );

const byDateAscending = (list: Gathering[]) =>
  [...list].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""),
  );

/** Leadership is per occurrence — this is the only sense in which a leader "has" a gathering. */
export function leadsGathering(gathering: Gathering, personId: string): boolean {
  return gathering.assignedLeaderIds.includes(personId);
}

/**
 * The leader's own list: gatherings still to lead, soonest first.
 *
 * Cancelled ones drop out; a gathering already reported on belongs in the
 * recent list instead.
 */
export function assignedToMe(
  gatherings: Gathering[],
  personId: string,
  today: string,
): Gathering[] {
  return byDateAscending(
    gatherings.filter(
      (g) =>
        leadsGathering(g, personId) &&
        g.status !== "cancelled" &&
        (g.date >= today || g.status !== "completed"),
    ),
  );
}

/** Gatherings this person led that are finished, newest first. */
export function recentlyLed(gatherings: Gathering[], personId: string, today: string): Gathering[] {
  return byDateDescending(
    gatherings.filter(
      (g) => leadsGathering(g, personId) && g.date < today && g.status !== "cancelled",
    ),
  );
}

/**
 * Everything else on the church's schedule.
 *
 * Shown so a leader can see what is happening, and deliberately without an
 * action: seeing a gathering implies no claim on it.
 */
export function otherScheduled(
  gatherings: Gathering[],
  personId: string,
  today: string,
): Gathering[] {
  return byDateAscending(
    gatherings.filter(
      (g) => !leadsGathering(g, personId) && g.date >= today && g.status !== "cancelled",
    ),
  );
}

/**
 * Home's LifeGroup card: this leader's gatherings, then any still needing one.
 *
 * Home is personal, so another leader's gathering does not belong here —
 * listing it beside this leader's own reads as theirs to do. Gatherings led
 * earlier this week stay (one led last night may still need writing up).
 * Unclaimed rows follow only where there is room, from today on, and
 * `needsLeader` lets the card say plainly that nobody has taken them.
 */
export function homeGatherings(
  gatherings: Gathering[],
  personId: string,
  weekStart: string,
  today: string,
  limit = 3,
): { gathering: Gathering; needsLeader: boolean }[] {
  const mine = byDateAscending(
    gatherings.filter(
      (g) => leadsGathering(g, personId) && g.date >= weekStart && g.status !== "cancelled",
    ),
  ).map((gathering) => ({ gathering, needsLeader: false }));
  const open = needingLeaders(gatherings, today).map((gathering) => ({
    gathering,
    needsLeader: true,
  }));
  return [...mine, ...open].slice(0, limit);
}

export function upcoming(gatherings: Gathering[], today: string): Gathering[] {
  return byDateAscending(gatherings.filter((g) => g.date >= today && g.status !== "cancelled"));
}

/* ------------------------------------------------------------- attendance */

export const attendanceStatusLabel = config.labels("lifegroup.attendance") as Record<
  AttendanceStatus,
  string
>;

export function attendanceFor(
  records: GatheringAttendance[],
  gatheringId: string,
): GatheringAttendance[] {
  return records.filter((record) => record.gatheringId === gatheringId);
}

export function attendeeLabel(
  record: GatheringAttendance,
  nameOf: (personId: string) => string,
): string {
  if (record.personId) return nameOf(record.personId);
  return record.name ?? "Unnamed";
}

/**
 * Signed up versus actually came.
 *
 * Ten people choose a slot and seven turn up: both numbers are true and the
 * leader needs to see both, so they are counted from different sources —
 * `expectedAttendeeIds` on the gathering, and the attendance records.
 */
export function attendanceTally(gathering: Gathering, records: GatheringAttendance[]) {
  const mine = attendanceFor(records, gathering.id);
  const present = mine.filter((r) => r.status === "present");
  const signedUp = new Set(gathering.expectedAttendeeIds ?? []);

  /*
   * `expectedPresent` answers "of the ten who chose this slot, how many came?"
   * and `walkIn` covers everybody else in the room — the leaders themselves,
   * and anyone who simply turned up. Collapsing the two would stop the signup
   * numbers reconciling, which is exactly what a leader checks.
   */
  return {
    expected: signedUp.size,
    expectedPresent: present.filter((r) => r.personId && signedUp.has(r.personId)).length,
    present: present.length,
    walkIn: present.filter((r) => !r.personId || !signedUp.has(r.personId)).length,
    absent: mine.filter((r) => r.status === "absent").length,
    excused: mine.filter((r) => r.status === "excused").length,
    firstTime: present.filter((r) => r.firstTime).length,
  };
}

/**
 * Who signed up but has no attendance record yet — the leader's working list
 * when the gathering starts.
 */
export function awaitingMark(gathering: Gathering, records: GatheringAttendance[]): string[] {
  const marked = new Set(
    attendanceFor(records, gathering.id)
      .map((r) => r.personId)
      .filter((id): id is string => !!id),
  );
  return (gathering.expectedAttendeeIds ?? []).filter((id) => !marked.has(id));
}

/**
 * One person's attendance across gatherings, newest first.
 *
 * This replaces the question "which group is this person in?". Someone may
 * appear at several venues in a month; that is ordinary, and it produces a
 * history, never a group assignment.
 */
export function attendanceHistory(
  gatherings: Gathering[],
  records: GatheringAttendance[],
  personId: string,
): { gathering: Gathering; record: GatheringAttendance }[] {
  return records
    .filter((record) => record.personId === personId)
    .map((record) => ({ record, gathering: gatherings.find((g) => g.id === record.gatheringId) }))
    .filter(
      (pair): pair is { gathering: Gathering; record: GatheringAttendance } => !!pair.gathering,
    )
    .sort((a, b) => b.gathering.date.localeCompare(a.gathering.date));
}

/**
 * Venues a person has actually been to, most frequent first.
 *
 * Offered as a convenience — "you usually see Juan at SC Church" — and never
 * as an assignment. Attending the same place twenty times still creates no
 * membership.
 */
export function venuesAttended(
  gatherings: Gathering[],
  records: GatheringAttendance[],
  personId: string,
): { venueId: string; times: number }[] {
  const counts = new Map<string, number>();
  for (const { gathering, record } of attendanceHistory(gatherings, records, personId)) {
    if (record.status !== "present") continue;
    /* A gathering whose venue was never set says nothing about where somebody
       has been, so it is left out rather than counted as an unknown place. */
    if (!gathering.venueId) continue;
    counts.set(gathering.venueId, (counts.get(gathering.venueId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([venueId, times]) => ({ venueId, times }))
    .sort((a, b) => b.times - a.times);
}

/* -------------------------------------------------------------- the record */

/*
 * Categories come from `domain/categories.ts`, which is the one place the
 * product says what kinds of information exist and which of them ask for
 * attention. LifeGroup used to keep its own list; two lists meant two answers
 * to "what does follow-up mean?".
 */
export const entryCategoryLabel: Record<LifegroupEntryCategory, string> = Object.fromEntries(
  categoriesFor("entry").map((category) => [category.id, category.label]),
) as Record<LifegroupEntryCategory, string>;

/** Offered in the filter bar. Order follows the shared configuration. */
export const entryCategories: LifegroupEntryCategory[] = categoriesFor("entry").map(
  (category) => category.id as LifegroupEntryCategory,
);

/**
 * What each audience choice is called.
 *
 * A proxy rather than a snapshot: a church may rename a choice or add one at
 * any time, and a map captured when this module loaded would keep answering
 * with the name it had then.
 */
export const visibilityLabel = new Proxy({} as Record<string, string>, {
  get: (_target, key: string) => config.label("lifegroup.entryVisibility", key),
});

/** Ordinary LifeGroup reporting is leadership material, not private material. */
export const DEFAULT_VISIBILITY: EntryVisibility = "leaders";

export const visibilityOf = (entry: LifegroupEntry): EntryVisibility =>
  entry.visibility ?? DEFAULT_VISIBILITY;

/**
 * How an audience choice is enforced, asked of configuration.
 *
 * An unrecognised choice resolves to **author-only**, the narrowest there is.
 * A value that arrived any other way than through this code used to fall
 * through to `leaders` — the widest of the four — which opened a pastoral line
 * to every leader instead of closing it.
 */
export function entryStrategyOf(visibility: string): EntryStrategy {
  const option = config.option("lifegroup.entryVisibility", visibility) as
    { entryStrategy?: EntryStrategy } | undefined;

  const strategy = option?.entryStrategy;
  return strategy && entryStrategies.includes(strategy) ? strategy : "author-only";
}

/**
 * Whether one viewer may read one entry.
 *
 * Deliberately small and local: the binder-wide access resolver decides who may
 * open the gathering at all, and this decides whether a stricter line inside it
 * opens too. An author always reads their own entry.
 *
 * What each choice *means* is a strategy the application implements; which
 * strategy a choice uses is the church's. So a church may add "This gathering's
 * leaders only, during the term" and say it behaves like `gathering-leaders`;
 * it may not say what `gathering-leaders` means.
 */
export function canReadEntry(
  entry: LifegroupEntry,
  viewerId: string,
  context: { isLeader: boolean; isAssignedLeader: boolean },
): boolean {
  if (entry.authorId === viewerId) return true;

  switch (entryStrategyOf(visibilityOf(entry))) {
    case "all-leaders":
      return context.isLeader;
    case "gathering-leaders":
      return context.isAssignedLeader;
    case "named-viewers":
      return entry.viewerIds?.includes(viewerId) ?? false;
    case "author-only":
    default:
      return false;
  }
}

/**
 * The entries a viewer may see, in the order they were written.
 *
 * Every list, preview and printed page goes through this. Filtering at the
 * point of rendering is how restricted material leaks; filtering here is how
 * it does not.
 */
export function readableEntries(
  entries: LifegroupEntry[],
  gatheringId: string,
  viewerId: string,
  context: { isLeader: boolean; isAssignedLeader: boolean },
): LifegroupEntry[] {
  return entries
    .filter((entry) => entry.gatheringId === gatheringId)
    .filter((entry) => canReadEntry(entry, viewerId, context))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How many entries a viewer cannot see — shown as a count, never as content. */
export function withheldCount(
  entries: LifegroupEntry[],
  gatheringId: string,
  viewerId: string,
  context: { isLeader: boolean; isAssignedLeader: boolean },
): number {
  const all = entries.filter((entry) => entry.gatheringId === gatheringId);
  return all.length - readableEntries(entries, gatheringId, viewerId, context).length;
}

/** Which categories actually appear, so the filter bar shows no dead chips. */
export function usedCategories(entries: LifegroupEntry[]): LifegroupEntryCategory[] {
  const present = new Set(
    entries.filter((entry) => entry.category).map((entry) => entry.category!),
  );
  return entryCategories.filter((category) => present.has(category));
}

/* ---------------------------------------------------------- exhortation */

export function exhortationFor(
  exhortations: Exhortation[],
  gatheringId: string,
): Exhortation | undefined {
  return exhortations.find((item) => item.gatheringId === gatheringId);
}

/* -------------------------------------------------------------- report */

export function reportFor(
  reports: GatheringReport[],
  gatheringId: string,
): GatheringReport | undefined {
  return reports.find((report) => report.gatheringId === gatheringId);
}

export const isReported = (gathering: Gathering, reports: GatheringReport[]): boolean =>
  !!reportFor(reports, gathering.id)?.completedAt;

/**
 * What a leader still owes on a gathering.
 *
 * Attendance is the only thing genuinely required — a leader must be able to
 * finish an ordinary report without an exhortation topic or a single entry.
 */
export function outstanding(
  gathering: Gathering,
  attendance: GatheringAttendance[],
  exhortations: Exhortation[],
): string[] {
  const missing: string[] = [];
  if (attendanceFor(attendance, gathering.id).length === 0) missing.push("Attendance");
  if (!exhortationFor(exhortations, gathering.id)?.topic) missing.push("Exhortation");
  return missing;
}

/**
 * Everything the printed page needs, already filtered for this viewer.
 *
 * Composed rather than retyped: the leader wrote these records once during the
 * gathering, and the report is a view over them.
 */
export function composeReport(
  gathering: Gathering,
  venues: Venue[],
  attendance: GatheringAttendance[],
  entries: LifegroupEntry[],
  exhortations: Exhortation[],
  reports: GatheringReport[],
  viewerId: string,
  context: { isLeader: boolean; isAssignedLeader: boolean },
) {
  const readable = readableEntries(entries, gathering.id, viewerId, context);

  return {
    gathering,
    venue: venueName(venues, gathering),
    tally: attendanceTally(gathering, attendance),
    attendance: attendanceFor(attendance, gathering.id),
    exhortation: exhortationFor(exhortations, gathering.id),
    entries: readable,
    withheld: withheldCount(entries, gathering.id, viewerId, context),
    report: reportFor(reports, gathering.id),
  };
}

export const dayLabel = (iso: string) => format(fromISO(iso), "EEEE · d MMMM");

/* ------------------------------------------------- the shared schedule */

/**
 * What this leader may do about a row, right now.
 *
 * `claim` and `join` are deliberately different operations on the same button:
 * one takes a gathering nobody is leading, the other adds you beside leaders
 * who already are. And both are different again from adding a row — "add a
 * schedule" makes another gathering, "add me" joins this one, and conflating
 * them is how a roster fills up with duplicates.
 */
export type MyRowAction = "claim" | "join" | "leave" | "none";

export function myAction(gathering: Gathering, personId: string, mayJoin: boolean): MyRowAction {
  if (gathering.assignedLeaderIds.includes(personId)) return mayJoin ? "leave" : "none";
  if (!mayJoin) return "none";
  return gathering.assignedLeaderIds.length === 0 ? "claim" : "join";
}

export const myActionLabel: Record<MyRowAction, string> = {
  claim: "Assign to me",
  join: "Add me",
  leave: "You're assigned",
  none: "—",
};

/**
 * What a row's stage becomes when its leaders change.
 *
 * Derived, so the roster cannot drift into saying "Assigned" with nobody's name
 * against it. Stages a leader set on purpose — confirmed, open, completed — are
 * left alone: the schedule may tell you a row needs a leader, and it may not
 * un-confirm a gathering behind somebody's back.
 */
export function statusForLeaders(
  current: GatheringStatus,
  assignedLeaderIds: string[],
): GatheringStatus {
  if (current === "confirmed" || current === "open" || current === "completed") return current;
  if (current === "cancelled") return current;
  return assignedLeaderIds.length > 0 ? "assigned" : "planned";
}

/** Rows a leader can still volunteer for, soonest first. */
export function needingLeaders(gatherings: Gathering[], fromIso: string): Gathering[] {
  return byDateAscending(
    gatherings.filter(
      (g) => g.date >= fromIso && g.status === "planned" && g.assignedLeaderIds.length === 0,
    ),
  );
}
