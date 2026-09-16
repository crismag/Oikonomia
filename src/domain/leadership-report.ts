import { resolveAccess } from "./access";
import { newBlockId } from "./meeting";
import { monthLabel, weekLabel, weekOf } from "./schedule";
import { accessStrategies, config } from "@/config";
import type { AccessStrategy, StatusBehavior } from "@/config";
import type {
  AudiencePolicy,
  BinderLinkKind,
  MeetingBlock,
  ContentSource,
  DiscussionPolicy,
  LeadershipReport,
  Person,
  Persona,
  ReportCapabilities,
  ReportStatus,
  ReportType,
  ReportVisibility,
} from "./types";

/**
 * Leadership Reports logic.
 *
 * Authorization lives here, above every route and component, so no consumer can
 * reach a report the viewer may not have. Lists, counts, search, tags, related
 * views, comments, activity and print all pass through the same gate.
 *
 * **These rules are now enforced on the server**, by
 * `server/services/leadership-report-service.ts`, which applies `canDiscover`
 * before anything is returned and demands the specific capability before
 * anything is written. They still live here rather than being restated in SQL,
 * because there should be exactly one statement of the subtlest rule in the
 * application.
 *
 * They are *also* evaluated in the browser, over reports the viewer already
 * has. That is not the enforcement — it is so the interface can decline to draw
 * a control that would be refused. A hidden button is a courtesy, never a rule,
 * which is precisely what this module used to rely on.
 *
 * What is still not enforced here: there is no separate confidential storage
 * model, and ordinary reads are not audited. Identity itself *is* verified —
 * the viewer comes from a session the server issued, which this comment went
 * on denying long after it had stopped being true.
 */

/* ------------------------------------------------------------------ labels */

/**
 * Report types the church already uses.
 *
 * Suggestions, not a schema. A leader may type any type they need; these are
 * offered first because most reports are one of them. Adding a type here is a
 * convenience, never a requirement — nothing breaks if a report carries a type
 * that appears nowhere in this list.
 *
 * A `template` marks a type whose form the church has actually defined. Types
 * without one get ordinary narrative reporting, which is the right default: a
 * prescribed form should exist only where the church has prescribed one.
 */
export interface KnownReportType {
  /** Stable id stored on the report. */
  id: string;
  label: string;
  /** Suggest related records of this kind first. */
  relatedKind?: BinderLinkKind;
  /** Whether "about" is usually the point of this kind of report. */
  subjectMatters?: boolean;
  /** Set when the church has a defined form for this type. */
  template?: () => MeetingBlock[];
  hint?: string;
}

export const knownReportTypes: KnownReportType[] = [
  {
    id: "leadership-development",
    label: "Leadership & Personal Development",
    hint: "Flexible narrative reporting.",
  },
  {
    id: "progress-report",
    label: "Leader's Progress Report",
    template: () => progressReportTemplate(),
    hint: "The monthly progress form.",
  },
  {
    id: "evaluation",
    label: "Evaluation / Assessment",
    subjectMatters: true,
    hint: "Usually written about another leader.",
  },
  {
    id: "ministry-operations",
    label: "Ministry / Operations",
    relatedKind: "ministry",
    hint: "Relates to a ministry.",
  },
  { id: "leadership-update", label: "Leadership Update" },
  { id: "pastoral-concern", label: "People / Pastoral Concern" },
  { id: "general", label: "General Leadership Report" },
];

export const knownType = (type: ReportType): KnownReportType | undefined =>
  knownReportTypes.find((known) => known.id === type);

/**
 * What to call a type on screen.
 *
 * A known type shows its label; anything else shows exactly what the leader
 * typed. There is no "unknown type" state, because a type the church invented
 * is not an error.
 */
export const reportTypeLabel = (type: ReportType): string => knownType(type)?.label ?? type;

/** Known types matching what is being typed, for the combobox. */
export function suggestReportTypes(partial: string): KnownReportType[] {
  const q = partial.trim().toLowerCase();
  if (!q) return knownReportTypes;
  return knownReportTypes.filter(
    (known) => known.label.toLowerCase().includes(q) || known.id.includes(q),
  );
}

/** Whether this kind of report is usually about somebody. */
export const subjectMattersFor = (type: ReportType): boolean =>
  knownType(type)?.subjectMatters ?? false;

/** The kind of binder record this type's "related to" should suggest first. */
export const relatedKindFor = (type: ReportType): BinderLinkKind | undefined =>
  knownType(type)?.relatedKind;

/** The defined form for this type, when the church has defined one. */
export const templateFor = (type: ReportType): MeetingBlock[] | undefined =>
  knownType(type)?.template?.();

export const hasTemplate = (type: ReportType): boolean => !!knownType(type)?.template;

/**
 * The monthly Leader's Progress Report.
 *
 * Its six sections come from the church's established form: weekly tracking,
 * CHAT dates, Bible reading, ministry monthly schedule, struggles and
 * victories. Nothing beyond those six is invented here — where the physical
 * form's finer structure is unknown, the section is left as writing space
 * rather than guessed at.
 *
 * These are ordinary editable blocks. A leader may reorder or remove them; a
 * form that cannot be edited would be the wrong thing for a binder.
 */
export function progressReportTemplate(): MeetingBlock[] {
  const heading = (text: string): MeetingBlock => ({
    id: newBlockId(),
    type: "heading-2",
    html: text,
  });
  const line = (type: MeetingBlock["type"], html = ""): MeetingBlock => ({
    id: newBlockId(),
    type,
    html,
    ...(type === "checklist" ? { checked: false } : {}),
  });

  return [
    heading("Weekly tracking"),
    line("bullet", "Week 1 —"),
    line("bullet", "Week 2 —"),
    line("bullet", "Week 3 —"),
    line("bullet", "Week 4 —"),

    heading("CHAT dates"),
    line("paragraph"),

    heading("Bible reading"),
    line("paragraph"),

    heading("Ministry monthly schedule"),
    line("paragraph"),

    heading("Struggles"),
    line("paragraph"),

    heading("Victories"),
    line("paragraph"),
  ];
}

export const reportStatusLabel = config.labels("reports.statuses") as Record<ReportStatus, string>;

/**
 * What each audience choice is called.
 *
 * A lookup rather than a fixed map, because the choices are configured: an
 * administrator may rename one or add another, and an id nothing recognises
 * renders as itself rather than as blank.
 */
export const visibilityLabel = new Proxy({} as Record<string, string>, {
  get: (_target, key: string) => config.label("reports.visibility", key),
});

/** Said once, where the leader chooses. Confidentiality must be legible. */
export const visibilityHint: Record<ReportVisibility, string> = {
  private: "Only you.",
  restricted: "Only the people you name.",
  leadership: "Authorized members of leadership.",
  shared: "The people you share it with.",
};

export const discussionPolicyLabel: Record<DiscussionPolicy, string> = {
  disabled: "No discussion",
  viewers: "Viewers can comment",
  selected: "Selected people can comment",
};

export const contentSourceLabel: Record<ContentSource, string> = {
  native: "Written here",
  "linked-document": "Linked document",
};

/* ------------------------------------------------------------------ policy */

/**
 * The audience policy a report's visibility implies.
 *
 * Derived rather than stored, so the label the leader chose and the rule the
 * resolver applies cannot drift apart. The classification ceilings do the real
 * work: `pastoral-private` is what stops an administrator reading a private
 * report, and that rule already exists and is already tested in `access.ts`.
 */
export function policyFor(
  report: LeadershipReport,
  /**
   * The groups the leadership audience currently means.
   *
   * Passed in rather than looked up, because this module decides rules and a
   * module that reaches for its own copy of the organisation ends up deciding
   * them against a different one than the caller saw. Empty is meaningful and
   * safe: a church that has marked no group as a leadership audience has none,
   * and a report set to it reaches only its author.
   */
  leadershipGroupIds: string[] = [],
): AudiencePolicy {
  const named = [
    ...new Set([...report.audienceIds, ...(report.subjectId ? [report.subjectId] : [])]),
  ];

  /*
   * The strategy comes from configuration; what each strategy *does* is here.
   *
   * That split is the whole design. A church may add an audience choice called
   * "Pastoral team" and say it works like `named-people`; it may not invent
   * what `named-people` means. Configuration chooses among capabilities the
   * application implements — it never writes one.
   */
  const strategy = accessStrategyOf(report.visibility);

  switch (strategy) {
    case "owner-only":
      return { classification: "pastoral-private", ownerId: report.authorId };

    case "named-people":
      return {
        classification: "pastoral-private",
        ownerId: report.authorId,
        audience: named,
      };

    case "leadership-groups":
      return {
        classification: "leadership-confidential",
        ownerId: report.authorId,
        audienceGroups: leadershipGroupIds,
        ...(named.length > 0 ? { audience: named } : {}),
      };

    case "organization":
      return {
        classification: "leadership-confidential",
        ownerId: report.authorId,
        audience: named,
      };
  }
}

/**
 * Which strategy a visibility value uses — **failing closed**.
 *
 * A visibility the registry does not recognise resolves to `owner-only`, the
 * narrowest thing the application can do. This used to fall through to the
 * *widest*: an unrecognised value was treated as ordinary organisational
 * reading, so a typo, a stale row or a future configuration mistake would have
 * opened a report rather than closing it.
 *
 * Configuration must never widen access. When in doubt, nobody but the author.
 */
export function accessStrategyOf(visibility: string): AccessStrategy {
  const option = config.option("reports.visibility", visibility) as
    { accessStrategy?: AccessStrategy } | undefined;

  const strategy = option?.accessStrategy;
  return strategy && accessStrategies.includes(strategy) ? strategy : "owner-only";
}

/* ------------------------------------------------------------ capabilities */

const NOTHING: ReportCapabilities = {
  discover: false,
  view: false,
  comment: false,
  edit: false,
  manageAccess: false,
  publish: false,
  archive: false,
};

/**
 * What a status means, asked of configuration rather than of its name.
 *
 * `status === "published"` was the coupling this replaces: it turned a word an
 * administrator may rename into application protocol. Code asks whether the
 * content is still editable, not what the stage is called.
 *
 * An unrecognised status is treated as **not editable and not current** —
 * closed rather than open, for the same reason as `accessStrategyOf`.
 */
export function statusBehavior(status: string): StatusBehavior {
  const option = config.option("reports.statuses", status) as
    { behaviors?: StatusBehavior } | undefined;

  return (
    option?.behaviors ?? { editable: false, final: true, current: false, visibleToAudience: false }
  );
}

/** Content is frozen once submitted; discussion may continue. */
const isFinal = (status: ReportStatus) => statusBehavior(status).final;

/**
 * The report has been filed — its content is the record now.
 *
 * The question counters, heatmaps and "unread" ask. It used to be spelled
 * `status === "published"` in four services, which is how a renamed stage
 * became a silently wrong number.
 */
export const isFiled = (status: string) => statusBehavior(status).final;

/** Still part of what is going on, rather than kept. */
export const isCurrent = (status: string) => statusBehavior(status).current;

/**
 * What this person may do with this report.
 *
 * The audience resolver decides *whether* they are an audience at all; the
 * rules below decide what being that audience permits. Two deliberate
 * departures from the resolver's ordinary behaviour:
 *
 * - a `metadata` decision — "you may know this exists" — becomes **no
 *   discovery** here. For leadership reporting, knowing that a confidential
 *   report about you exists is itself disclosure.
 * - `limited` is treated as view without discovery of restricted sections,
 *   never as edit.
 */
export function reportCapabilities(
  report: LeadershipReport,
  persona: Persona,
  person: Person,
  /** What the leadership audience means right now. See `policyFor`. */
  leadershipGroupIds: string[] = [],
): ReportCapabilities {
  const me = persona.personId;
  const decision = resolveAccess(persona, person, policyFor(report, leadershipGroupIds));

  if (decision.level === "denied" || decision.level === "metadata") return NOTHING;

  const isAuthor = report.authorId === me;
  const isSubject = report.subjectId === me;
  const view = true;

  const canComment = (() => {
    if (report.discussionPolicy === "disabled") return false;
    if (report.discussionPolicy === "selected") {
      return isAuthor || isSubject || (report.commenterIds ?? []).includes(me);
    }
    return view;
  })();

  /*
   * Only the author edits, and only while the report is still being worked on.
   * A subject reading an evaluation about themselves must never be able to
   * change it — that is the whole point of an accountability record.
   */
  const canEdit = isAuthor && !isFinal(report.status);

  return {
    discover: true,
    view,
    comment: canComment,
    edit: canEdit,
    /* Who may read it stays the author's to set while the report is still
       current — an archived report's audience is history, not a setting. */
    manageAccess: isAuthor && statusBehavior(report.status).current,
    /* Publishing means making the content the submitted record, which is only
       meaningful from a stage whose content is still editable. */
    publish: isAuthor && statusBehavior(report.status).editable,
    archive: isAuthor && statusBehavior(report.status).current,
  };
}

export const canDiscover = (
  report: LeadershipReport,
  persona: Persona,
  person: Person,
  leadershipGroupIds: string[] = [],
) => reportCapabilities(report, persona, person, leadershipGroupIds).discover;

/* ------------------------------------------------------------------- gate */

/**
 * The only way to get a list of reports.
 *
 * Everything downstream — the landing page, search, tag counts, a ministry's
 * related reports, the documents view — starts from this. Filtering after
 * retrieval is how restricted material leaks; filtering here is how it does
 * not. Never map over the raw array in a component.
 */
/**
 * Whether a report may be **found by searching**.
 *
 * Stricter than reading, and deliberately so. Search is the widest surface in
 * the product: somebody types a name or a word and the application answers
 * from everything it holds. A confidential report surfacing there — even by
 * title, even to somebody who could have reached it another way — is the
 * failure that matters most, because nobody went looking for that record and
 * the application volunteered it.
 *
 * So for a **private** or **restricted** report the rule is the narrow one:
 * its author, or somebody it was **explicitly** shared with. No oversight
 * path, no campus seniority, no administration. Reports at ordinary
 * leadership or shared visibility are searchable by whoever may read them.
 *
 * This does not replace `canDiscover` — a search result set must already have
 * passed it. It is the second, narrower gate that search alone applies, and it
 * is stated here rather than left implicit in the access model so that adding
 * a new search surface cannot quietly widen it.
 */
export function searchableBy(report: LeadershipReport, person: Person): boolean {
  if (report.authorId === person.id) return true;

  /* Private means private. A name left in `audienceIds` from before the author
     narrowed it is not a sharing decision, and search must not read it as one. */
  if (report.visibility === "private") return false;

  if (report.visibility === "restricted") return report.audienceIds.includes(person.id);

  return true;
}

export function readableReports(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
  leadershipGroupIds: string[] = [],
): LeadershipReport[] {
  return reports.filter((report) => canDiscover(report, persona, person, leadershipGroupIds));
}

/**
 * How many reports were withheld from this viewer.
 *
 * A count, never a list. That something exists may be said in aggregate; which
 * report, about whom, and what it is called may not.
 */
export function withheldCount(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
): number {
  return reports.length - readableReports(reports, persona, person).length;
}

/* ------------------------------------------------------------------ views */

const byUpdated = (a: LeadershipReport, b: LeadershipReport) =>
  b.updatedAt.localeCompare(a.updatedAt);

/** Reports this leader wrote. Authorized first, then narrowed. */
export function myReports(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
): LeadershipReport[] {
  return readableReports(reports, persona, person)
    .filter((report) => report.authorId === persona.personId)
    .sort(byUpdated);
}

/**
 * Reports somebody else made available to this leader.
 *
 * Includes reports where they are the *subject* — receiving an evaluation about
 * yourself is the case this view exists for.
 */
export function sharedWithMe(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
): LeadershipReport[] {
  return readableReports(reports, persona, person)
    .filter((report) => report.authorId !== persona.personId)
    .sort(byUpdated);
}

/* -------------------------------------------------------------- discussion */

/**
 * The comments this viewer may read.
 *
 * Gated on the report, so a comment can never become the way an unauthorized
 * person learns a report exists.
 */
export function readableComments(
  report: LeadershipReport,
  persona: Persona,
  person: Person,
): LeadershipReport["comments"] {
  return reportCapabilities(report, persona, person).view ? report.comments : [];
}

export function readableActivity(
  report: LeadershipReport,
  persona: Persona,
  person: Person,
): LeadershipReport["activity"] {
  return reportCapabilities(report, persona, person).view ? report.activity : [];
}

/* ------------------------------------------------------------------- tags */

/**
 * Tags across the reports this viewer may discover, most used first.
 *
 * Counted from the authorized set, never from all reports — a tag count is a
 * disclosure channel, and `#evaluation (3)` when you may see one of them says
 * more than it should.
 */
export function reportTags(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const report of readableReports(reports, persona, person)) {
    for (const tag of report.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ----------------------------------------------------------- relationships */

/**
 * Reports related to another binder record.
 *
 * Authorized first, related second. A ministry surfaces only the reports this
 * viewer could already have found; participation in that ministry grants
 * nothing.
 */
export function reportsRelatedTo(
  reports: LeadershipReport[],
  persona: Persona,
  person: Person,
  target: { kind: string; id: string },
): LeadershipReport[] {
  return readableReports(reports, persona, person)
    .filter((report) =>
      report.links.some((link) => link.kind === target.kind && link.id === target.id),
    )
    .sort(byUpdated);
}

/* --------------------------------------------------------------- searching */

export function searchReports(
  reports: LeadershipReport[],
  query: string,
  nameOf: (personId: string) => string,
  /* Who is searching. Without it a confidential report could be matched by
     title on any surface that forgot to filter first. */
  person?: Person,
): LeadershipReport[] {
  const searchable = person ? reports.filter((report) => searchableBy(report, person)) : reports;
  const q = query.trim().toLowerCase();
  if (!q) return searchable;
  const bare = q.replace(/^#/, "");
  return searchable.filter(
    (report) =>
      report.title.toLowerCase().includes(q) ||
      reportTypeLabel(report.reportType).toLowerCase().includes(q) ||
      nameOf(report.authorId).toLowerCase().includes(q) ||
      (report.subjectId ? nameOf(report.subjectId).toLowerCase().includes(q) : false) ||
      report.tags.some((tag) => tag.includes(bare)),
  );
}

export interface ReportFilter {
  status?: ReportStatus | undefined;
  reportType?: ReportType | undefined;
  visibility?: ReportVisibility | undefined;
  tag?: string | undefined;
  ministryId?: string | undefined;
  query?: string | undefined;
  /** Where it was written. A dimension of the list, never of access. */
  contextType?: LeadershipReport["contextType"] | undefined;
  category?: string | undefined;
  sort?: ReportSortKey | undefined;
}

/**
 * The list, narrowed — always from an already-authorized set.
 *
 * `reports` must be the output of `readableReports`. Search runs last so it
 * can never widen what authorization already decided.
 */
export function filterReports(
  reports: LeadershipReport[],
  filter: ReportFilter,
  nameOf: (personId: string) => string,
  person?: Person,
): LeadershipReport[] {
  let out = reports;
  if (filter.status) out = out.filter((r) => r.status === filter.status);
  if (filter.reportType) out = out.filter((r) => r.reportType === filter.reportType);
  if (filter.visibility) out = out.filter((r) => r.visibility === filter.visibility);
  if (filter.tag) out = out.filter((r) => r.tags.includes(filter.tag!));
  if (filter.ministryId) {
    out = out.filter((r) =>
      r.links.some((l) => l.kind === "ministry" && l.id === filter.ministryId),
    );
  }
  if (filter.contextType) out = out.filter((r) => r.contextType === filter.contextType);
  if (filter.category) out = out.filter((r) => (r.category ?? "general") === filter.category);
  /* Searching a list is still searching: a confidential report is not found
     by typing part of its title, even in a list that legitimately holds it. */
  if (filter.query) out = searchReports(out, filter.query, nameOf, person);
  return sortReports(out, filter.sort);
}

/* ---------------------------------------------------------- sort and group */

export type ReportSortKey = "updated" | "date" | "title" | "type" | "status";

export const reportSortLabel: Record<ReportSortKey, string> = {
  updated: "Last updated",
  date: "Reporting date",
  title: "Title (A–Z)",
  type: "Report type",
  status: "Status",
};

export const reportSortKeys = Object.keys(reportSortLabel) as ReportSortKey[];

function dateOf(report: LeadershipReport): string {
  return report.publishedAt ?? report.updatedAt;
}

/** The comparison a sort key means, always falling back to recency so ties read the same way twice. */
function compareBy(sort: ReportSortKey): (a: LeadershipReport, b: LeadershipReport) => number {
  switch (sort) {
    case "date":
      return (a, b) => dateOf(b).localeCompare(dateOf(a)) || byUpdated(a, b);
    case "title":
      return (a, b) =>
        (a.title || "Untitled report").localeCompare(b.title || "Untitled report") ||
        byUpdated(a, b);
    case "type":
      return (a, b) =>
        reportTypeLabel(a.reportType).localeCompare(reportTypeLabel(b.reportType)) ||
        byUpdated(a, b);
    case "status":
      return (a, b) =>
        (reportStatusLabel[a.status] ?? a.status).localeCompare(
          reportStatusLabel[b.status] ?? b.status,
        ) || byUpdated(a, b);
    case "updated":
    default:
      return byUpdated;
  }
}

/** `reports`, ordered by the reader's chosen dimension rather than a fixed one. */
export function sortReports(
  reports: LeadershipReport[],
  sort: ReportSortKey = "updated",
): LeadershipReport[] {
  return [...reports].sort(compareBy(sort));
}

export type ReportGroupKey = "none" | "type" | "status" | "category" | "week" | "month";

export const reportGroupLabel: Record<ReportGroupKey, string> = {
  none: "No grouping",
  type: "Report type",
  status: "Status",
  category: "Category",
  week: "Week",
  month: "Month",
};

export const reportGroupKeys = Object.keys(reportGroupLabel) as ReportGroupKey[];

export interface ReportGroup {
  key: string;
  label: string;
  reports: LeadershipReport[];
}

/**
 * `reports` split into named groups, in the order they should be read.
 *
 * Grouping never reorders within a group — it is layered over whatever sort
 * the reader chose, not a replacement for it. `week`/`month` groups sort most
 * recent first, because that is how the other sort keys already read; `type`,
 * `status` and `category` groups sort alphabetically, because there is no
 * other order a reader would expect from a word.
 */
export function groupReports(reports: LeadershipReport[], group: ReportGroupKey): ReportGroup[] {
  if (group === "none") {
    return reports.length > 0 ? [{ key: "", label: "", reports }] : [];
  }

  const buckets = new Map<string, ReportGroup>();
  for (const report of reports) {
    const { key, label } = groupKeyOf(report, group);
    const existing = buckets.get(key);
    if (existing) existing.reports.push(report);
    else buckets.set(key, { key, label, reports: [report] });
  }

  const alphabetical = group === "type" || group === "status" || group === "category";
  return [...buckets.values()].sort((a, b) =>
    alphabetical ? a.label.localeCompare(b.label) : b.key.localeCompare(a.key),
  );
}

function groupKeyOf(
  report: LeadershipReport,
  group: ReportGroupKey,
): { key: string; label: string } {
  switch (group) {
    case "type":
      return { key: report.reportType, label: reportTypeLabel(report.reportType) };
    case "status":
      return { key: report.status, label: reportStatusLabel[report.status] ?? report.status };
    case "category": {
      const category = report.category ?? "general";
      return { key: category, label: category === "general" ? "General" : category };
    }
    case "week": {
      const monday = weekOf(dateOf(report).slice(0, 10));
      return { key: monday, label: `Week of ${weekLabel(monday)}` };
    }
    case "month": {
      const iso = dateOf(report).slice(0, 10);
      const monthStart = `${iso.slice(0, 7)}-01`;
      return { key: monthStart, label: monthLabel(monthStart) };
    }
    case "none":
    default:
      return { key: "", label: "" };
  }
}

/* ------------------------------------------------------------------ people */

/** Everyone who can currently reach the report, for the access panel. */
export function namedAudience(report: LeadershipReport): string[] {
  return [
    ...new Set([
      report.authorId,
      ...(report.subjectId ? [report.subjectId] : []),
      ...report.audienceIds,
    ]),
  ];
}

export const isRestricted = (report: LeadershipReport) =>
  report.visibility === "private" || report.visibility === "restricted";

/**
 * Where a report was written, in the words a leader would use.
 *
 * Context is metadata: it names the place and opens it, and it grants nothing.
 * A report written after a gathering says so; a report written from nowhere in
 * particular says nothing rather than inventing a home for itself.
 */
export function reportContextLabel(report: LeadershipReport): string {
  switch (report.contextType) {
    case "lifegroup-gathering":
      return "LifeGroup gathering";
    case "ministry":
      return "Ministry";
    case "meeting-note":
      return "Meeting";
    case "reach-out":
      return "Reach-Out";
    case "leadership":
      return "Leadership";
    default:
      return "";
  }
}

/** Where the source lives, when the report came from somewhere. */
export function reportContextPath(report: LeadershipReport): string | undefined {
  if (!report.contextId) return undefined;
  switch (report.contextType) {
    case "lifegroup-gathering":
      return `/lifegroups/${report.contextId}`;
    case "ministry":
      return `/ministries/${report.contextId}`;
    case "meeting-note":
      return `/meeting-notes?note=${report.contextId}`;
    case "reach-out":
      return `/reach-out/${report.contextId}`;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------- transitions */

/**
 * Moving a report from one status to another.
 *
 * ## What this replaces
 *
 * Four named actions — publish, share, archive, reopen — each with its own
 * branch, its own capability and its own hard-coded target id. A church could
 * rename "Published" but could not add a stage, remove one, or change what any
 * of them did, because the four names *were* the protocol.
 *
 * A move is now described by the **difference between the two statuses'
 * behaviours**, which is the only thing the application actually cared about:
 *
 * - content stops changing → the content is snapshotted and stamped, and it
 *   takes the capability to submit;
 * - content starts changing again → the stamps are cleared, the snapshot is
 *   kept, and it takes the capability that survives submission;
 * - the report stops being current → it takes the capability to retire one;
 * - it reaches its audience for the first time → it takes the capability to
 *   submit.
 *
 * Nothing here reads a status id. A church that adds "In review" between draft
 * and published gets correct behaviour for it without a line of code.
 */
export interface TransitionPlan {
  /** What the actor must be able to do. */
  capability: "edit" | "publish" | "archive" | "manageAccess";
  /** Preserve the content as it stood, because it is about to stop changing. */
  snapshot: boolean;
  /** Record when the content was finished. */
  marksFinal: boolean;
  /** Clear those stamps: the record is open again. */
  reopens: boolean;
  /** Record that it is no longer current. */
  retires: boolean;
  /** Clear that: it is current again. */
  restores: boolean;
}

export function planTransition(from: string, to: string): TransitionPlan {
  const before = statusBehavior(from);
  const after = statusBehavior(to);

  const freezes = !before.final && after.final;
  const thaws = before.final && !after.final;
  const retires = before.current && !after.current;
  const restores = !before.current && after.current;
  const reaches = !before.visibleToAudience && after.visibleToAudience;

  /*
   * A move that changes none of the four is a sideways one: two stages that
   * behave alike, which a church may well have — "Published" and "With the
   * elders" can be the same thing under two names. It is still the author's
   * move, so on a report whose content is already frozen it takes the
   * capability that survives freezing rather than the one freezing removed.
   * Without this, a sideways move would be offered to nobody at all.
   */
  const sideways = !freezes && !thaws && !retires && !restores && !reaches;

  /*
   * Order is the point. Reopening a retired report is a change to the record
   * leadership read before it is a change to what is current, so the stricter
   * of the two decides.
   */
  const capability = thaws
    ? ("manageAccess" as const)
    : freezes || reaches
      ? ("publish" as const)
      : retires
        ? ("archive" as const)
        : sideways && before.final
          ? ("manageAccess" as const)
          : ("edit" as const);

  return {
    capability,
    snapshot: freezes,
    marksFinal: freezes,
    reopens: thaws,
    retires,
    restores,
  };
}

/**
 * The statuses a report in this one may be moved to.
 *
 * Every other active status, which is deliberately permissive: what a church
 * may do with its own stages is its business, and what stops a move is the
 * capability the move turns out to need — not a graph somebody drew.
 */
export function transitionsFrom(status: string): { id: string; label: string }[] {
  return config
    .options("reports.statuses")
    .filter((option) => option.id !== status)
    .map((option) => ({ id: option.id, label: option.label }));
}

/**
 * Where a new report starts.
 *
 * The first active status whose content may still change and which nobody else
 * can see yet. Asked rather than assumed, so "Draft" is a name a church may
 * change and not a value the application writes.
 */
export function initialStatus(): string {
  const options = config.options("reports.statuses");
  const start = options.find((option) => {
    const behaviors = statusBehavior(option.id);
    return behaviors.editable && !behaviors.visibleToAudience && !behaviors.final;
  });
  return (start ?? options[0])?.id ?? "draft";
}

/**
 * The leadership reports that belong on Reports to you.
 *
 * Both lists are drawn from what the service already returned as discoverable,
 * so neither can show a report the viewer could not open from Leadership
 * Reports. **Yours** is the viewer's own, most recently touched first — a
 * shortcut, not a second library. **Shared with you** is everything else that
 * reached them — by name, through a group, or by its audience — newest first.
 */
export function reportsToYou(
  visible: readonly LeadershipReport[],
  viewerId: string,
): { yours: LeadershipReport[]; shared: LeadershipReport[] } {
  const newest = (a: LeadershipReport, b: LeadershipReport) =>
    b.updatedAt.localeCompare(a.updatedAt);
  return {
    yours: visible.filter((report) => report.authorId === viewerId).sort(newest),
    shared: visible.filter((report) => report.authorId !== viewerId).sort(newest),
  };
}
