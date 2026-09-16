/**
 * Oikonomia frontend domain contracts.
 *
 * These are PROTOTYPE view-model / service contracts only. They deliberately
 * mirror the product's own vocabulary (source object, discussion,
 * attention, access/audience) so presentation never re-invents the domain.
 * They are NOT backend contracts, schema or persistence decisions.
 */

/**
 * An access role's id.
 *
 * The four the product ships are named for readability and autocompletion.
 * The open end is deliberate: a church may define its own bundle of
 * capabilities and give it a name nobody here could have guessed. Nothing may
 * branch on one of these — see `roles-are-not-permissions.test.ts`.
 */
export type PersonaId = "leader" | "ministry-head" | "bishop" | "admin" | (string & {});

export type Capability = "campus-oversight" | "cross-ministry-oversight" | "administration";

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: string;
  campusId: string;
  ministryIds: string[];
  /**
   * Still part of this church.
   *
   * People leave, and their records stay: a report they wrote is still a
   * report somebody wrote. An inactive person is not **offered** — not for a
   * new team, a new reporting line, or a new group — and resolves by name
   * everywhere they are already named. Nothing about this decides who may
   * read anything.
   */
  active?: boolean;
  /**
   * Responsibility groups this person belongs to.
   *
   * Separate from `ministryIds` on purpose: sitting on the leadership team is
   * not the same fact as serving in the music ministry, and the two were
   * conflated while groups were constants stored in the ministry list.
   */
  groupIds?: string[];
}

export interface Persona {
  id: PersonaId;
  personId: string;
  label: string;
  focus: string;
  capabilities: Capability[];
}

export interface Campus {
  id: string;
  name: string;
  city: string;
  /**
   * Still one of the places this church meets.
   *
   * An inactive campus is not offered anywhere new and stays readable
   * everywhere it is already named — deactivating is not deleting, and never
   * decides who may read anything.
   */
  active?: boolean;
}

export interface Ministry {
  id: string;
  name: string;
  purpose: string;
  campusId: string;
  /** The ministry exists independently of whoever currently leads it. */
  leadId: string;
  teamIds: string[];
  /** People given access to this ministry's information without joining it. */
  sharedWithIds?: string[];
  /** Still running. An inactive ministry is not offered; its records remain. */
  active?: boolean;
}

/**
 * How a person stands in relation to a ministry. Drives what they can do, and
 * what the landing page tells them.
 */
export type MinistryRelationship = "lead" | "participate" | "shared" | "none";

/* ------------------------------------------------------------------ access */

/**
 * Content classification is a policy input, never a decorative tag.
 */
export type Classification =
  "open" | "context-restricted" | "leadership-confidential" | "pastoral-private";

export interface AudiencePolicy {
  classification: Classification;
  ownerId: string;
  /** Explicit named share. */
  audience?: string[];
  /** Explicit addressable groups (ministry ids, leadership group keys). */
  audienceGroups?: string[];
  /** Explicit exclusion wins over ordinary contextual grants. */
  excluded?: string[];
  campusId?: string;
  ministryId?: string;
  reviewers?: string[];
  participants?: string[];
  /** Sections stricter than the object overall. */
  restrictedSections?: string[];
}

export type AccessLevel = "full" | "limited" | "metadata" | "denied";

export interface AccessDecision {
  level: AccessLevel;
  rationale: string;
  restrictedSections: string[];
}

/* -------------------------------------------------------- source artifacts */

export type ArtifactProvider = "google-sheets" | "google-docs" | "google-drive";

export interface WorkingArtifact {
  id: string;
  title: string;
  provider: ArtifactProvider;
  authoritative: boolean;
  updated: string;
  updatedBy: string;
  /** Meaningful sheet/section references a discussion may point at. */
  sections: string[];
  url: string;
}

/* ----------------------------------------------- discussion / decision log */

export interface Comment {
  id: string;
  authorId: string;
  at: string;
  body: string;
  /** Section/row reference this comment targets, when relevant. */
  target?: string;
  system?: boolean;
  restricted?: boolean;
}

export interface Decision {
  id: string;
  summary: string;
  decidedById: string;
  at: string;
  state: "recorded" | "requested";
}

export interface ActivityEntry {
  id: string;
  at: string;
  actorId?: string;
  kind:
    | "submitted"
    | "assigned"
    | "comment"
    | "decision"
    | "artifact"
    | "status"
    | "review"
    | "resolution";
  summary: string;
}

/* ------------------------------------------------ work / review contexts */

export type WorkKind =
  "report" | "concern" | "decision" | "review" | "gathering-follow-up" | "development-record";

export type WorkStatus =
  | "draft"
  | "submitted"
  | "in-review"
  | "changes-requested"
  | "acknowledged"
  | "open"
  | "resolved"
  | "closed";

export interface WorkContext {
  id: string;
  kind: WorkKind;
  /**
   * Whether this record goes through a formal review before it progresses.
   *
   * **Off by default, deliberately.** Most of what leaders write is
   * information: it is published, read, and that is the end of it. A review
   * cycle — picked up, changes requested, acknowledged — exists where a
   * process genuinely calls for one, and it is turned on for that record
   * rather than inherited by everything that gets written.
   */
  reviewRequired?: boolean;
  subject: string;
  /** Where the work lives: breadcrumb into its owning source context. */
  contextLabel: string;
  contextPath: string;
  status: WorkStatus;
  /** Short answer to "what is the current state?" — never make people reread. */
  currentState: string;
  ministryId?: string;
  campusId: string;
  ownerId: string;
  assigneeIds: string[];
  reviewerIds: string[];
  participantIds: string[];
  due?: string;
  period?: string;
  reportType?: string;
  /** Report/journal body sections; may include stricter sections. */
  sections?: { title: string; body: string; sensitive?: boolean }[];
  artifactIds: string[];
  openQuestions: string[];
  decisions: Decision[];
  comments: Comment[];
  activity: ActivityEntry[];
  policy: AudiencePolicy;
}

/* ------------------------------------------------------------- attention */

/**
 * Attention used to be a projection: every record that named a leader became
 * an item in their inbox, with its own read / saved / done state.
 *
 * It was removed, along with the inbox it fed. What needs a leader is what
 * somebody **asked** of them — see `src/domain/escalation.ts` — and what they
 * have read is a reading state, which is not a queue and cannot become one.
 *
 * The fixture data that used these types is kept for tests; the application
 * has nothing that reads it.
 */
export type AttentionReason =
  | "assigned"
  | "participating"
  | "mentioned"
  | "group-mentioned"
  | "review-requested"
  | "follow-up"
  | "decision-requested"
  | "due-soon";

export type AttentionState = "inbox" | "saved" | "done";

export interface AttentionItem {
  id: string;
  workId: string;
  reason: AttentionReason;
  recipients: PersonaId[];
  routedById?: string;
  at: string;
  unread: boolean;
  state: AttentionState;
  group?: string;
}

/* --------------------------------------------------------------- calendar */

export interface EventContext {
  id: string;
  name: string;
  depth: "recurring" | "project";
  when: string;
  campusId: string;
  ministryIds: string[];
  organiserId: string;
  readiness: string;
  summary: string;
  artifactIds: string[];
  workIds: string[];
  roles?: { role: string; personId?: string; note?: string }[];
  milestones?: { label: string; when: string; done: boolean }[];
  policy: AudiencePolicy;
}

/**
 * A body of people with a shared responsibility.
 *
 * A leadership team, a deacons' board, a pastoral team, a safeguarding panel.
 * A record the church creates — not a constant, and not a ministry: sitting on
 * the leadership team is a different fact from serving in the music ministry,
 * and the two were conflated while groups were ids kept in `ministryIds`.
 */
export interface ResponsibilityGroup {
  id: string;
  name: string;
  description: string;
  campusId?: string;
  /** Whether a report set to the leadership audience reaches this group. */
  leadershipAudience: boolean;
  active: boolean;
  memberIds: string[];
  /**
   * What kind of body this is — a committee, a team, a leadership body.
   *
   * Vocabulary the church configures. **Nothing behaves differently because of
   * it**: what a group does is decided by `leadershipAudience` and `campusId`,
   * so a church renaming its kinds, or adding one, changes no access.
   */
  groupType: string;
  /**
   * The group this one sits under, where a church's structure nests.
   *
   * Optional, and **structure rather than policy**: nothing is inherited
   * through it. A member of the music team is not thereby a member of the
   * worship ministry, because that would make nesting a silent grant.
   */
  parentGroupId?: string;
}

/* -------------------------------------------------------------- lifegroup */

/**
 * LifeGroup: a binder area whose primary record is the **gathering**.
 *
 * LifeGroup is not a container of people. A gathering is a date and time at a
 * venue, with the leaders who were assigned to that occurrence, the people who
 * actually came, and what the leader recorded afterwards. Members choose a
 * gathering they can attend — currently through a Messenger poll — and that
 * choice is intended attendance for one occasion, never membership.
 *
 * The anchor relationship is:
 *
 *     Leader -> Gathering -> Attendance + Exhortation + Sharing + Report
 *
 * An earlier model had `Lifegroup` with a permanent `members[]` roster, a
 * single owning `leaderId`, and gatherings hanging off the group. All three
 * were wrong: they turned a venue label into an organizational group, made
 * repeated attendance look like membership, and gave one leader a group
 * indefinitely. None of them survive.
 */

export type VenueType = "residence" | "church" | "park" | "public-place" | "other";

/**
 * Where a gathering meets.
 *
 * Names like "Baronia Residence" or "Thomson Park" describe the place — often
 * the household hosting it — and are reused across many gatherings. A venue is
 * never an organizational group, and never carries a roster.
 */
export interface Venue {
  id: string;
  name: string;
  type: VenueType;
  /** The household or person who hosts here, when there is one. */
  hostId?: string;
  campusId?: string;
  area?: string;
  /** Street address. Held apart from the name because it is often restricted. */
  address?: string;
  notes?: string;
}

export const venueTypeLabel: Record<VenueType, string> = {
  residence: "Residence",
  church: "Church",
  park: "Park",
  "public-place": "Public place",
  other: "Other",
};

/**
 * `planned` is scheduled but not yet open for signup, `open` is taking signups
 * or in progress, `completed` has a report, `cancelled` did not happen.
 */
/**
 * Where a row on the LifeGroup schedule has got to.
 *
 * The schedule is a **shared roster** several leaders maintain together, so the
 * stages describe the row's readiness rather than a workflow anyone is marched
 * through:
 *
 * ```
 * planned → assigned → confirmed → open → completed
 *   ▲          ▲           ▲         ▲        ▲
 * a row     someone     details    it is   written
 * exists    claimed     settled   happening   up
 * ```
 *
 * Nothing forces the sequence. A leader may add a row that is confirmed from
 * the start, and a row may go back to `planned` if whoever claimed it steps
 * away. The table is the operational truth; these say what each row still
 * needs.
 */
export type GatheringStatus =
  "planned" | "assigned" | "confirmed" | "open" | "completed" | "cancelled";

/**
 * One gathering occurrence.
 *
 * Everything fluid about LifeGroup lives here: venue, leaders and attendance
 * all vary by occasion. `venueName` is a snapshot so a gathering stays readable
 * if a venue record is later renamed or removed.
 */
export interface Gathering {
  id: string;
  /** ISO date. */
  date: string;
  startTime?: string;
  endTime?: string;
  /**
   * Where it meets, once that is known.
   *
   * Optional because a schedule row exists before its details do — "somewhere
   * in Markham, leader needed" is a real state of the roster, and requiring a
   * venue to add a row is what turned this into a form.
   */
  venueId?: string;
  venueName?: string;
  /** Overrides the venue's usual host for this occasion. */
  hostId?: string;
  campusId?: string;
  /**
   * Leaders responsible for *this occurrence*. Several, and different each week.
   *
   * Being assigned grants responsibility and the right to maintain this row.
   * It does not transfer ownership: the row belongs to the shared LifeGroup
   * schedule before, during and after, which is what lets somebody else pick it
   * up when a leader steps away.
   */
  assignedLeaderIds: string[];
  /**
   * Whoever is carrying it, when the leaders have said.
   *
   * Optional and informational. Several leaders share a gathering; naming one
   * says who to ask, not who owns it.
   */
  primaryLeaderId?: string;
  /**
   * Who said they were coming — transcribed from the signup poll. Intended
   * attendance, kept separate from who actually came.
   */
  expectedAttendeeIds?: string[];
  status: GatheringStatus;
  createdBy?: string;
  updatedBy?: string;
}

export type AttendanceStatus = "present" | "absent" | "excused";

/**
 * One person at one gathering.
 *
 * Belongs to the gathering, never to a roster. `personId` links the canonical
 * People record; `name` alone is enough for someone not in People yet, so a
 * leader is never blocked from recording who was actually in the room.
 */
export interface GatheringAttendance {
  id: string;
  gatheringId: string;
  personId?: string;
  name?: string;
  status: AttendanceStatus;
  /** True when this person signed up beforehand. */
  expected?: boolean;
  /** First time at any gathering, as far as the leader knows. */
  firstTime?: boolean;
}

/**
 * Who may read one entry or report section.
 *
 * `leaders` is the ordinary case and the default: LifeGroup reporting is
 * normal leadership material, not private by default. The stricter values
 * exist so one pastoral line can be held back without pushing the whole
 * gathering into a separate confidential workflow.
 */
/**
 * A gathering entry's audience choice.
 *
 * The four the product ships are named for readability. The open end is the
 * point: a church may add a choice, and what it permits is the **entry
 * strategy** it names — a closed set the application owns. Nothing branches on
 * one of these ids; `entryStrategyOf` is the only reader.
 */
export type EntryVisibility =
  "leaders" | "assigned-leaders" | "selected-viewers" | "private" | (string & {});

/**
 * Categories organize the record. They never gate it: a leader may use
 * "general" for everything, or classify everything, and both must work.
 */
export type LifegroupEntryCategory =
  "general" | "highlight" | "concern" | "prayer" | "follow-up" | "visitor" | "decision" | "action";

/**
 * A line the leader wrote about a gathering — sharing, a follow-up, a note.
 *
 * Cumulative entries rather than a large form: an entry needs only text.
 */
export interface LifegroupEntry {
  id: string;
  gatheringId: string;
  authorId: string;
  body: string;
  /** Optional. An uncategorized entry is a perfectly good entry. */
  category?: LifegroupEntryCategory;
  /** Defaults to `leaders` when absent. */
  visibility?: EntryVisibility;
  /** Named readers, for `selected-viewers`. */
  viewerIds?: string[];
  createdAt: string;
  /* ---- progressive enrichment, none of it required at capture ---- */
  personId?: string;
  assignedTo?: string;
  dueDate?: string;
  completed?: boolean;
  reportable?: boolean;
}

/**
 * What was taught at a gathering.
 *
 * A topic is enough. Scripture and notes are there when the leader wants them
 * and never required — finishing an ordinary report must not depend on them.
 */
export interface Exhortation {
  gatheringId: string;
  topic: string;
  scripture?: string;
  notes?: string;
  /** Whoever gave it, when that is not the assigned leader. */
  givenById?: string;
}

/**
 * The leader's closing summary. The records above it already say most of it,
 * so this is optional by design.
 */
export interface GatheringReport {
  gatheringId: string;
  summary?: string;
  completedAt?: string;
  completedById?: string;
}

/* --------------------------------------------------------------- schedule */

/**
 * The Binder Schedule: a month calendar and a weekly agenda.
 *
 * Two deliberately lightweight concepts, mirroring the physical binder:
 *   ScheduleEntry — something that HAPPENS at a date.
 *   AgendaItem    — something the leader INTENDS TO DO.
 *
 * Neither carries workflow state. A leader writes "Ministry meeting 7:30 PM"
 * without creating a management record, and nothing here requires an owner,
 * reviewer, status or resolution. Where a schedule item genuinely becomes
 * accountable work, it links out to a WorkContext — it never becomes one.
 */

export type ScheduleCategory =
  | "prayer-fasting"
  | "chat"
  | "lifegroup"
  | "potbless"
  | "victuals"
  | "seed"
  | "mentorship"
  | "ministry-meeting"
  | "service"
  | "celebration"
  | "other";

/**
 * Deliberately not an RFC 5545 rule set. The binder's rhythms are weekly, so
 * weekly-on-a-weekday covers them; anything more is deferred until evidence
 * requires it.
 */
export type RecurrenceFrequency = "daily" | "weekly" | "fortnightly" | "monthly" | "yearly";

/**
 * A repeating rhythm.
 *
 * Church life is full of them — Sunday service, Prayer & Fasting, CHAT, a
 * monthly ministry meeting — and none of them should have to be typed in every
 * week. `from` anchors the rhythm and supplies the weekday or day-of-month, so
 * the pattern is read off a real date rather than configured twice.
 */
export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** 0 = Sunday … 6 = Saturday. Weekly and fortnightly rhythms. */
  weekday?: number;
  /** ISO date (yyyy-mm-dd). Inclusive start of the rhythm. */
  from: string;
  /** ISO date. Optional end of the rhythm. */
  until?: string;
  /** Occurrences removed from the series — a cancelled week, a moved date. */
  skip?: string[];
}

/** How far an edit or deletion of a recurring entry reaches. */
export type RecurrenceScope = "occurrence" | "following" | "series";

/** How long before the entry the leader wants to be reminded. */
export type ReminderOffset = "at-time" | "10m" | "30m" | "1h" | "1d";

/**
 * Where a schedule entry came from.
 *
 * The calendar naturally contains items created elsewhere in the binder — a
 * ministry meeting, a LifeGroup gathering, the church's own rhythms. Source is
 * provenance and is deliberately separate from `category`, which says what kind
 * of thing it is. Neither should be inferred from the other.
 */
export type ScheduleSource = "leader" | "ministry" | "lifegroup" | "church" | "event";

export interface ScheduleEntry {
  id: string;
  title: string;
  /** ISO date for a one-off. Absent when the entry recurs. */
  date?: string;
  /** Present instead of `date` for a recurring rhythm. */
  recurrence?: Recurrence;
  /** Optional: Prayer & Fasting has no clock time. */
  startTime?: string;
  endTime?: string;
  /** A birthday or a whole-day responsibility has no clock time at all. */
  allDay?: boolean;
  category: ScheduleCategory;
  ministryId?: string;
  /**
   * Where or how it happens. Not assumed to be physical — a phone call, a
   * Messenger conversation and a room in the church are all ordinary here.
   */
  location?: string;
  meetingUrl?: string;
  note?: string;
  /** Reminders, independent of when the entry itself starts. */
  reminders?: ReminderOffset[];
  tags?: string[];
  organizerId?: string;
  /** Optional. Much of a leader's schedule involves nobody else. */
  participantIds?: string[];
  /** References to binder records — reference, never copy. */
  related?: BinderLink[];
  /** Provenance, not classification. */
  source?: ScheduleSource;
  createdBy?: string;
  /** Optional forward link to a Binder record. Never required. */
  relatedWorkId?: string;
}

/** One occurrence of an entry on a specific day, after recurrence expansion. */
export interface ScheduleOccurrence {
  /** Stable per day+entry, so a UI key survives re-expansion. */
  key: string;
  entry: ScheduleEntry;
  date: string;
  recurring: boolean;
}

/**
 * A task on the leader's week — the binder's checklist.
 *
 * Distinct from a `ScheduleEntry` by purpose: an entry is something scheduled,
 * a task is something to *do*. Ticking one means the leader did it. It raises
 * no report, requests no approval and starts no workflow, and it must never
 * come to.
 *
 * A simple personal item needs only text. Due date and assignee exist for the
 * cases that want them and are never required.
 */
export interface AgendaItem {
  id: string;
  text: string;
  /** ISO date when the item belongs to a day. */
  date?: string;
  /**
   * ISO date of the week's Monday when the item belongs to the week but no
   * particular day — the binder's NOTES area. Never invent a date to file one.
   */
  weekOf?: string;
  completed: boolean;
  category?: ScheduleCategory;
  ministryId?: string;
  /** Optional tie to something scheduled that day. */
  relatedEntryId?: string;
  /**
   * The ask this item was put on the week for, when it came from one. How
   * "Put on my week" knows it has already been done — never by matching text.
   */
  escalationId?: string;
  /** The leadership report, and its follow-up line, this was put on the week for. */
  reportId?: string;
  reportBlockId?: string;
  dueAt?: string;
  assigneeId?: string;
  completedAt?: string;
  /**
   * The leader whose agenda this is. An agenda is personal: an item is seen by
   * whoever wrote it and whoever it is for, and by nobody else.
   */
  createdBy?: string;
}

/* ----------------------------------------------------- leadership reports */

/**
 * Leadership Reports — binder section 7.
 *
 * The leader's workspace for creating, sharing, receiving, discussing and
 * retaining leadership reporting. It spans ordinary leadership updates and
 * highly confidential evaluations, so **confidentiality is part of this domain
 * model, not a later presentation concern**.
 *
 * Four rules shape everything here:
 *
 * - **Type and access are independent.** What kind of report this is never
 *   determines who may read it. Do not encode security into type names.
 * - **Author is not always the subject.** An evaluation is written by one
 *   leader about another, and both must be representable.
 * - **A report is not a document.** A report is an application record; its
 *   content may live here or in an externally managed document, and either way
 *   the record, its access and its discussion belong to the binder.
 * - **Relationships do not inherit access.** A restricted report about Music
 *   Ministry is not visible to everyone who can see Music Ministry.
 *
 * This supersedes the narrower "Leader Progress Report" page, which becomes a
 * report *type* and, once the physical form is supplied, a template.
 */

/**
 * What kind of report this is.
 *
 * **Deliberately a free string, not a union.** The church may need a kind of
 * report nobody anticipated, and adding one must never require a code change.
 * `knownReportTypes` supplies suggestions and, where a type has a defined form,
 * a template — but a leader may type anything.
 *
 * Type still never determines who may read a report. That is `visibility`.
 */
export type ReportType = string;

/**
 * A report's life, which is not the same axis as a reviewer's queue.
 *
 * `shared` is deliberately between draft and published: intentionally shared
 * while still an active working process.
 */
export type ReportStatus = "draft" | "shared" | "published" | "archived";

/**
 * Who the report is for, in the leader's words.
 *
 * The authoritative field. `AudiencePolicy` is derived from it plus the named
 * audience, so the label a leader chose and the rule the resolver applies can
 * never drift apart.
 */
/**
 * Which audience choice a report uses.
 *
 * **Not a closed union.** The four Oikonomia ships with are named because most
 * code reads better for it, but an administrator may add a choice — it names
 * one of the application's access strategies, and `accessStrategyOf` is what
 * decides anything. A frozen union here would have been the API rejecting a
 * value the configuration screen had just offered.
 */
export type ReportVisibility = "private" | "restricted" | "leadership" | "shared" | (string & {});

/** Where the report's authoritative content lives. */
export type ContentSource = "native" | "linked-document";

/** Not every report wants comments; an evaluation may want them and no edits. */
export type DiscussionPolicy = "disabled" | "viewers" | "selected";

/** One preserved version of a report's content. */
export interface ReportRevision {
  revision: number;
  blocks: MeetingBlock[];
  actorId: string;
  at: string;
  note?: string;
}

/** Where a report was written. Metadata — never an audience. */
export type ReportContextType =
  "lifegroup-gathering" | "ministry" | "meeting-note" | "reach-out" | "leadership";

export interface LeadershipReport {
  id: string;
  title: string;
  reportType: ReportType;
  /** Who wrote it. */
  authorId: string;
  /**
   * Who or what the report is about. Optional, and free text.
   *
   * `subjectText` is what the leader typed; `subjectId` is set only when that
   * resolved to a known person, so the structured relationship survives while
   * arbitrary text stays permitted. A report about "the Thursday team" is
   * perfectly valid and resolves to nobody.
   */
  subjectText?: string;
  subjectId?: string;
  /** "September 2026", "Q3" — free text, because periods vary. */
  reportingPeriod?: string;

  /**
   * Where this was written, and what kind of thing it is.
   *
   * Three separate dimensions, and keeping them apart is the point: context is
   * **metadata** that opens the source and filters a list; category says what
   * kind of information it is and may ask for attention; `visibility` and
   * `audienceIds` — and only those — decide who may read it.
   *
   * A confidential pastoral concern written after a LifeGroup gathering has
   * context `lifegroup-gathering`, category `attention-required`, and an
   * audience of two people. None of the three implies either of the others.
   */
  contextType?: ReportContextType;
  contextId?: string;
  category?: string;

  status: ReportStatus;
  visibility: ReportVisibility;
  /** Named readers beyond the author, for `restricted` and `shared`. */
  audienceIds: string[];
  /** Named leaders who may comment when the policy is `selected`. */
  commenterIds?: string[];
  discussionPolicy: DiscussionPolicy;
  contentSource: ContentSource;
  /** Authoritative when `contentSource` is `native`. */
  blocks?: MeetingBlock[];
  /** Identifies the external content when `contentSource` is `linked-document`. */
  primaryDocumentId?: string;
  /** Supporting artifacts, independent of the primary content source. */
  relatedDocumentIds: string[];
  /**
   * What the report relates to, as free text. Kept alongside `links` for the
   * same reason as `subjectText`: the church's world is larger than the
   * entities this application happens to model.
   */
  relatedText?: string;
  /** Ministry, LifeGroup, meeting and other binder records. Grants nothing. */
  links: BinderLink[];
  tags: string[];
  comments: Comment[];
  activity: ActivityEntry[];
  /** Preserved content from before each publish. */
  revisions: ReportRevision[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  archivedAt?: string;
  /**
   * Marked confidential by its author. Changes handling, not access: for
   * anyone but the author the content is not sent with lists, is fetched when
   * the report is opened, and every such opening is audited.
   */
  confidential?: boolean;
  /**
   * Set on a confidential report sent without its content — in a list, to
   * someone other than its author. Open it (`fetchReport`) to read it.
   */
  contentWithheld?: boolean;
}

/**
 * What one person may do with one report.
 *
 * Seven capabilities rather than a `canView` boolean, because the interesting
 * cases need them: a leader receiving a published evaluation about themselves
 * gets `view` and `comment` but never `edit` or `manageAccess`.
 *
 * `discover` is the strictest and the most important. A report a person cannot
 * discover must not appear in their lists, counts, tags, search results or
 * previews — its very existence is withheld.
 */
export interface ReportCapabilities {
  discover: boolean;
  view: boolean;
  comment: boolean;
  edit: boolean;
  manageAccess: boolean;
  publish: boolean;
  archive: boolean;
}

/* -------------------------------------------------------------- reach-out */

/**
 * A Reach-Out report.
 *
 * Reach-Out is a leader's reporting workspace, not a contact system. **The
 * report itself is the record.** It may describe named people, unnamed people,
 * families, places, conversations, visits, efforts or outcomes, and the
 * application deliberately does not try to classify any of that: those details
 * belong in the writing.
 *
 * Reach-Out is **common leadership work**, not an owned ministry or a permanent
 * team. Leaders take part every week; who leads an effort, who writes it up and
 * who adds to it later all vary. So there is no Reach-Out team, no membership,
 * and no assigned leader — those would be organizational entities invented to
 * support reporting.
 *
 * An earlier model had `ReachOutAction` with a required `personId`, a
 * `new-guest → contacted → visiting → connected → stalled` pipeline, an owning
 * leader and a `next` step. That was a CRM. It assumed outreach is always aimed
 * at one identified person and always advances through stages, and neither is
 * true of how Reach-Out is actually used.
 *
 * Structure the artifact, not the ministry activity described inside it.
 */
export interface ReachOutReport {
  id: string;
  /** Short identifying text. "Weekly reach-out" is a perfectly good title. */
  title: string;
  /** ISO date the report is *about*, which is not when it was typed up. */
  reportDate: string;
  /** Free-form. The leader decides what matters. */
  content: string;
  /**
   * Who wrote it first. Provenance, **not** ownership — Reach-Out is shared
   * leadership work and any leader may contribute to any report.
   */
  authorId: string;
  /** Other leaders who have since worked on it, oldest contribution first. */
  contributorIds?: string[];
  createdAt: string;
  updatedAt: string;
  /** Discussion around the report, never a second reporting form. */
  comments: Comment[];
  /**
   * Increments on every write.
   *
   * Two leaders continuing one report is the expected use of Reach-Out, so a
   * save states the version it was editing and a stale one is refused.
   */
  version?: number;
  /**
   * Reserved for the binder-wide audience model.
   *
   * Sharing rules for Reach-Out are an **open design decision** — see
   * `modules/REACH-OUT.md`. This field exists so access control can be added
   * later without reshaping the record, and is deliberately unused today
   * rather than filled in with a guess.
   */
  policy?: AudiencePolicy;
}

export interface AttendanceRecord {
  id: string;
  occasion: string;
  when: string;
  campusId: string;
  present: number;
  guests: number;
  recordedById: string;
  source: "lifegroup" | "event" | "service";
}

/* ------------------------------------------------------------------ goals */

/**
 * Binder goals: what a ministry said it wanted to improve this year, and where
 * it stands now.
 *
 * The physical page is a numbered annual list with handwritten annotations in
 * the margin. Those annotations are the progress record, so `GoalUpdate` is
 * first-class rather than a comment thread. A goal needs only a title — "More
 * communication via GC" is a valid goal — and nothing here carries assignment,
 * approval, estimation or percent-complete.
 */

export type GoalStatus = "active" | "completed" | "on-hold" | "carried-forward";

/**
 * What a goal belongs to — chosen when it is set, never inferred.
 *
 * - `personal`: a leader's own goal (`ownerId`). A `ministryId` on it is only
 *   what it relates to.
 * - `ministry`: the ministry's goal (`ministryId`).
 * - `other`: a goal of another group the church has named (`groupId`).
 */
export type GoalScope = "personal" | "ministry" | "other";

/**
 * The binder writes "June", "target July" and "May 2026" interchangeably.
 * Month-precision is modelled explicitly rather than faked as the 1st, so a
 * month target never renders as a spurious day.
 */
export type GoalTarget =
  | { precision: "month"; value: string } // yyyy-MM
  | { precision: "date"; value: string }; // yyyy-MM-dd

export type GoalUpdateKind = "note" | "status" | "completion";

export interface GoalUpdate {
  id: string;
  goalId: string;
  /** ISO date. */
  date: string;
  text: string;
  authorId?: string;
  kind: GoalUpdateKind;
}

/**
 * A pointer from one binder record to another. Deliberately generic so Meeting
 * Notes and later sections reuse it rather than inventing their own.
 * Relationships are always optional: a goal needs no evidence to be a goal.
 */
export type BinderLinkKind =
  | "schedule-entry"
  | "work"
  | "artifact"
  | "meeting-note"
  | "form-record"
  | "form-definition"
  | "ministry"
  | "leadership-report";

export interface BinderLink {
  kind: BinderLinkKind;
  id: string;
  /** Shown when the target module cannot resolve a label itself. */
  label?: string;
}

export interface Goal {
  id: string;
  /** Annual position — the binder's "01", "02". Stable once written. */
  number: number;
  year: number;
  title: string;
  description?: string;
  /** Whose goal this is. Decides where it is listed and who may change it. */
  scope: GoalScope;
  ministryId?: string;
  /** The responsibility group an `other` goal belongs to. */
  groupId?: string;
  campusId?: string;
  ownerId?: string;
  target?: GoalTarget;
  status: GoalStatus;
  createdAt: string;
  /** ISO date; month precision is fine here too. */
  completedAt?: string;
  completionNote?: string;
  holdSince?: string;
  holdReason?: string;
  /** Set when this goal was carried into a later year from an earlier one. */
  carriedFromGoalId?: string;
  links: BinderLink[];
  /** Absent means ordinary organizational visibility. */
  policy?: AudiencePolicy;
}

/**
 * Something a leader might legitimately put in a report, derived from binder
 * records rather than retyped each cycle. Generic on purpose: Goals produce
 * these now, Meeting Notes will produce them later.
 */
export interface ReportableItem {
  id: string;
  source: { kind: "goal" | "form-record"; id: string; label: string };
  date: string;
  text: string;
  ministryId?: string;
  /** Completions read differently from ordinary progress in a report. */
  emphasis: "completed" | "progress" | "on-hold";
}

/* ------------------------------------------------------------------ forms */

/**
 * Binder Forms.
 *
 * Ministry leaders write their own operational documents — weekly checklists,
 * setup sheets, attendance forms. We cannot hard-code one per ministry, so the
 * leader builds the form visually and Binder stores its structure.
 *
 * Three concepts that must never collapse into one:
 *   FormDefinition — the reusable design (the master).
 *   FormRecord     — a filled instance (what actually happened, preserved).
 *   template       — a starting design, convenience only.
 *
 * A checklist item is a form field, not a task, ticket or work item.
 */

export type FormFieldType =
  /* display-only content */
  | "heading"
  | "instruction"
  /* response fields */
  | "checkbox"
  | "status"
  | "short-text"
  | "long-text"
  | "number"
  | "date"
  | "time"
  | "single-choice"
  | "multi-choice"
  | "person";

/** The operational states a status-capable item can hold. */
export type FormItemStatus =
  "not-started" | "in-progress" | "done" | "needs-attention" | "not-applicable";

export interface FormFieldConfig {
  /** single-choice / multi-choice options. */
  options?: string[];
  /** Checklist and status items may carry a written note beside them. */
  allowNote?: boolean;
  /** Offer this field's response as reportable material. */
  reportable?: boolean;
  placeholder?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  /** Guidance under the label — "Reheat in Air Fryer and Oven". Not a task. */
  description?: string;
  required?: boolean;
  config?: FormFieldConfig;
}

export interface FormSection {
  id: string;
  title?: string;
  /** Cadence or context line — "Before Service / Set-Up". */
  description?: string;
  fields: FormField[];
}

export type FormDefinitionStatus = "draft" | "published";

export interface FormVersionEntry {
  version: number;
  date: string;
  summary: string;
  authorId?: string;
}

export interface FormDefinition {
  id: string;
  title: string;
  description?: string;
  ministryId?: string;
  campusId?: string;
  ownerId: string;
  status: FormDefinitionStatus;
  version: number;
  sections: FormSection[];
  createdAt: string;
  updatedAt: string;
  history: FormVersionEntry[];
  policy?: AudiencePolicy;
  /**
   * Set when the form was deleted while records made from it existed. It is no
   * longer offered for new records; the records it produced stay.
   */
  archivedAt?: string;
}

export type FormRecordStatus = "in-progress" | "completed" | "archived";

export interface FormResponse {
  fieldId: string;
  /** checkbox → boolean; choice → string | string[]; others → string. */
  value?: boolean | string | string[];
  status?: FormItemStatus;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface FormRecordHistoryEntry {
  id: string;
  at: string;
  text: string;
  actorId?: string;
}

export interface FormRecord {
  id: string;
  formDefinitionId: string;
  /**
   * The definition version this record was created under. Editing the master
   * must never retroactively rewrite a completed record, so the structure is
   * captured here rather than read live.
   */
  formVersion: number;
  sections: FormSection[];
  title: string;
  period?: string;
  date?: string;
  status: FormRecordStatus;
  responses: FormResponse[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  history: FormRecordHistoryEntry[];
  links: BinderLink[];
}

/* --------------------------------------------------------- meeting notes */

/**
 * Meeting Notes: a leader's working notebook.
 *
 * The document is a list of typed blocks rather than one HTML string. That is
 * the whole architecture decision: decisions, follow-ups and tasks have to be
 * findable, countable and linkable, which a blob of markup cannot support
 * without brittle parsing. Inline marks (bold/italic/link) live inside a block
 * as a small sanitized HTML subset — contentEditable used for inline text,
 * which is what it is for, never to simulate structure.
 */

export type MeetingBlockType =
  /* ordinary writing */
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "bullet"
  | "numbered"
  | "quote"
  | "divider"
  /* lightweight document content */
  | "checklist"
  /* structured records that emerged from the writing */
  | "decision"
  | "follow-up";

export type FollowUpState = "open" | "resolved" | "converted";

export interface MeetingBlock {
  id: string;
  type: MeetingBlockType;
  /** Inline HTML, restricted to a small allowlist. Empty for a divider. */
  html: string;
  /** checklist only. A local document tick, not a tracked task. */
  checked?: boolean;
  /** follow-up only. */
  state?: FollowUpState;
  /** Set when this block produced a tracked task. */
  taskId?: string;
}

export type MeetingType =
  "leaders" | "ministry" | "lifegroup" | "planning" | "coaching" | "campus" | "other";

export type MeetingStatus = "draft" | "complete";

/**
 * What kind of artifact this note is.
 *
 * A **personal note** is the leader's own working record: observations,
 * reminders, things to raise later. It need not represent everything that
 * happened, and sharing it does **not** turn it into official minutes.
 *
 * **Minutes** are the meeting's record for the people concerned with it, so
 * the editor encourages fuller record keeping — without becoming a form.
 *
 * They are different artifacts by purpose. Neither is a stage of the other.
 */
export type MeetingNoteType = "personal" | "minutes";

/**
 * Who may read a note.
 *
 * A personal note starts private to its author; minutes are written to be
 * shared with the people the meeting concerned. Reuses the binder's vocabulary
 * rather than a Meeting-Notes-only permission system — see
 * `modules/MEETING-NOTES.md` for what remains open.
 */

export interface MeetingNote {
  id: string;
  title: string;
  /** Personal working record, or the meeting's official minutes. */
  noteType: MeetingNoteType;
  /** ISO date of the meeting, not of typing it up. */
  date: string;
  time?: string;
  /** Where or how the meeting was held. Minutes usually record this. */
  location?: string;
  type?: MeetingType;
  /** Who chaired it, and who wrote it up. Minutes usually record both. */
  facilitatorId?: string;
  noteTakerId?: string;
  participantIds: string[];
  /** Expected but absent. Only meaningful on minutes. */
  absenteeIds?: string[];
  blocks: MeetingBlock[];
  status: MeetingStatus;
  /**
   * Free tags describing the note — `#planning`, `#budget`.
   *
   * Lightweight categorization that converges through suggestion rather than
   * an administrator-defined taxonomy. A tag describes the note; it never
   * stands in for an organizational relationship.
   */
  tags: string[];
  /**
   * What the meeting related to, as free text, when it corresponds to no
   * record the application models. Kept beside `links` for the same reason
   * Leadership Reports keeps `relatedText`: the church's world is larger than
   * the entities this application happens to hold.
   */
  relatedText?: string;
  /**
   * References to other binder records, including the organizational context
   * the meeting belongs to (`kind: "ministry"` and, later, its peers).
   *
   * This is why ministries are **not** hashtags: a context link points at the
   * real entity, so Music Ministry can show its meetings and the note is never
   * copied to do it. Reference, never copy.
   */
  links: BinderLink[];
  authorId?: string;
  /**
   * Increments on every write.
   *
   * A save states the version it was editing, and a write against a stale one
   * is refused. Notes autosave behind a debounce, so two tabs or two people in
   * one note would otherwise overwrite each other silently.
   */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A task that came out of a meeting.
 *
 * Kept as its own record rather than as a block, because a task outlives the
 * document: it gets assigned, tracked and surfaced elsewhere. `meetingId` and
 * `blockId` are its provenance — the way back to where it was decided.
 */
export interface MeetingTask {
  id: string;
  meetingId: string;
  /** The block this was created from, so origin can be highlighted. */
  blockId?: string;
  title: string;
  assigneeId?: string;
  dueDate?: string;
  status: "open" | "done";
  createdAt: string;
}

/* -------------------------------------------------------------- ministry */

/**
 * A ministry document.
 *
 * **A document is not a file.** This record is the binder's managed
 * information object; its content may live in the binder itself, in an
 * uploaded file, in Google Drive, or behind a link. The metadata — who it
 * belongs to, who prepared it, what it relates to — stays with the binder
 * whatever the content does.
 *
 * `ministryId` is **belongs to**. `preparedById` is **created by**. They are
 * different, and conflating them is how a ministry loses its history when a
 * leader moves on.
 */
export type DocumentOrigin = "binder" | "file" | "drive" | "link";

export type BinderDocumentType =
  | "goals"
  | "plan"
  | "report"
  | "update"
  | "meeting-note"
  | "announcement"
  | "checklist"
  | "document"
  | "spreadsheet"
  | "form"
  | "schedule"
  | "file"
  | "link";

export type DocumentPermission = "view" | "edit";

/**
 * Which binder area a document belongs to.
 *
 * Ministry documents belong to a named ministry, which is what lets them
 * survive a change of leadership. Other areas own their documents directly:
 * Reach-Out's working materials belong to Reach-Out, not to any one report.
 */
export type DocumentOwner =
  | { kind: "ministry"; ministryId: string }
  | { kind: "reach-out" }
  | { kind: "leadership-report" }
  /** A LifeGroup document belongs to a gathering, never to a standing group. */
  | { kind: "lifegroup"; gatheringId: string };

/**
 * A managed document anywhere in the binder.
 *
 * > **A document is not a file.**
 *
 * The binder keeps the metadata — title, type, belongs-to, prepared-by, related
 * records, permission, updated — whatever the content is and wherever it lives.
 * `origin` says where that content actually is.
 *
 * This is deliberately one model shared by every binder area rather than a
 * document subsystem per section. Ministry surfaces these one way, Reach-Out
 * another; the records are the same kind of thing.
 */
export interface BinderDocument {
  id: string;
  title: string;
  /** Belongs to. Survives a change of leadership. */
  owner: DocumentOwner;
  /** Created by. Never implies ownership. */
  preparedById: string;
  type: BinderDocumentType;
  origin: DocumentOrigin;
  updatedAt: string;
  description?: string;
  /** Where the content actually is, when it is not binder-native. */
  url?: string;
  fileName?: string;
  fileSize?: string;
  /** Related binder records — reference, never copy. */
  related?: BinderLink[];
  /** What a person with access may do. Detail lives in the access model. */
  permission?: DocumentPermission;
  pinned?: boolean;
  year?: number;
}

/**
 * Something a leader did in a ministry, worth showing on the overview.
 * Deliberately coarse — not a keystroke log.
 */
export interface MinistryActivity {
  id: string;
  ministryId: string;
  at: string;
  actorId: string;
  summary: string;
}

/* ------------------------------------------------------- resource search */

/**
 * The eight binder sections, as an addressable value.
 *
 * Used to say where a resource participates in leadership work. This is the
 * organizing idea behind resource search: a leader looks for the Music Ministry
 * planning sheet, not for "the thing in Drive".
 */
export type BinderSection =
  | "weekly-agenda"
  | "monthly-calendar"
  | "meeting-notes"
  | "ministry"
  | "lifegroup"
  | "reach-out"
  | "leadership-reports"
  | "documents-forms";

/**
 * Where a resource takes part in the leadership workspace.
 *
 * `label` names the record — a ministry, a meeting, a report. `secondaryLabel`
 * carries an occurrence where one is meaningful, which is how a LifeGroup
 * association reads as "Thomson Park › 3 Sep" rather than implying a standing
 * group.
 */
export interface ResourceAssociation {
  section: BinderSection;
  label?: string;
  secondaryLabel?: string;
}

export type ResourceSort = "relevance" | "updated" | "title";

/**
 * A resource as search presents it.
 *
 * A **read projection**, not a stored record and not a backend schema. It is
 * assembled from resources the application already knows about, and search
 * neither owns nor stores any of them.
 *
 * `provider` says what will probably happen on opening. It is supporting
 * metadata and must never become the way the interface is organized.
 */
export interface ResourceSearchResult {
  id: string;
  title: string;
  description?: string;
  /** Every place it participates. One resource is never listed twice. */
  associations: ResourceAssociation[];
  tags: string[];
  kind?: string;
  provider?: string;
  /** Opens where the resource lives. */
  openUrl?: string;
  /** Opens inside the application. */
  openRoute?: string;
  /** True when opening leaves the application, and another system decides. */
  external: boolean;
  addedById?: string;
  /**
   * ISO date, when the source records one.
   *
   * Not every source does: the older working-artifact model stores a display
   * string like "Today, 06:20". Rather than fabricate a date, such resources
   * carry `updatedLabel` instead and sort last. Normalizing this is one of the
   * things a real registry would fix.
   */
  updatedAt?: string;
  /** Shown when there is no ISO date to format. */
  updatedLabel?: string;
}
