import type { BinderDocument, LeadershipReport, MeetingNote, Person } from "@/domain/types";

/**
 * Volume fixtures.
 *
 * The hand-written fixtures in `fixtures.ts` carry the product's narrative: the
 * particular reports, notes and documents that demonstrate access, ownership
 * and audience. They are deliberately few, and while a screen holds four
 * records it cannot show whether the screen works.
 *
 * These records exist to answer the second question. A church of this size has
 * a roster in the dozens and a filing cabinet in the hundreds, and paging,
 * filtering, sorting and search all behave differently at that size than at
 * four. They are generated from fixed tables — no randomness, so a screenshot
 * taken twice is the same screenshot — and they are ordinary on purpose: no
 * record here is the interesting one.
 *
 * Two things they are NOT. They are not seed data for a backend: nothing here
 * has been reviewed as a persistence decision. And they are not permission
 * fixtures — every generated record uses a plainly-visible audience, so a test
 * about who may read what still has to use the narrative fixtures, where the
 * intent was written down deliberately.
 */

const YEAR = 2026;

/* A small deterministic sequence, so "varied" never means "different on each run". */
function cycle<T>(table: readonly T[], i: number): T {
  return table[i % table.length]!;
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Counting back from September 2026, the month the shipped fixtures sit in. */
function monthOf(monthsBack: number): { year: number; month: number } {
  const index = 9 - 1 - monthsBack;
  const year = YEAR + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  return { year, month: month + 1 };
}

function isoDate(monthsBack: number, day: number): string {
  const { year, month } = monthOf(monthsBack);
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;
}

/**
 * The period a report covers, read off the same clock as its dates.
 *
 * Kept as one derivation rather than two tables, because a report titled
 * "March" and dated January is the kind of detail that quietly teaches a
 * reviewer to distrust every date on the screen.
 */
function periodLabel(monthsBack: number): string {
  const { year, month } = monthOf(monthsBack);
  return `${monthNames[month - 1]} ${year}`;
}

/* ------------------------------------------------------------------ people */

const givenNames = [
  "Abigail",
  "Benjamin",
  "Carmela",
  "Dario",
  "Elena",
  "Ferdinand",
  "Grace",
  "Hector",
  "Imelda",
  "Jericho",
  "Karina",
  "Lorenzo",
  "Marisol",
  "Noel",
  "Ophelia",
  "Paolo",
  "Quintin",
  "Rosalie",
  "Samuel",
  "Teresa",
  "Ulysses",
  "Veronica",
  "Wilfredo",
  "Ximena",
  "Yolanda",
  "Zacarias",
] as const;

const familyNames = [
  "Abad",
  "Bautista",
  "Cabrera",
  "Domingo",
  "Escalante",
  "Fajardo",
  "Gutierrez",
  "Hidalgo",
  "Ibarra",
  "Jimenez",
  "Katigbak",
  "Lorenzana",
  "Mendoza",
  "Navarro",
  "Oquendo",
  "Pineda",
  "Quilala",
  "Ramirez",
  "Salazar",
  "Tolentino",
  "Urbano",
  "Villanueva",
  "Wong",
  "Yabut",
] as const;

/**
 * A role a person holds where they serve nothing in particular.
 *
 * Roles that name a ministry are derived from the ministries the person is
 * actually in — see `roleFor`. A directory row that says "Serving team ·
 * Victuals" beside "Music Ministry" is worse than one that says nothing.
 */
const unaffiliatedRoles = [
  "Member",
  "Usher",
  "Youth volunteer",
  "Guest · invited by a LifeGroup",
  "LifeGroup Leader",
] as const;

const ministryRole: Record<string, string> = {
  "min-music": "Serving team · Music",
  "min-victuals": "Serving team · Victuals",
  "min-transport": "Driver · Transportation",
  "min-reachout": "Reach-Out volunteer",
};

function roleFor(ministryIds: readonly string[], i: number): string {
  if (ministryIds.length === 0) return cycle(unaffiliatedRoles, i);
  if (ministryIds.length > 1) return "Serving team";
  return ministryRole[ministryIds[0]!] ?? "Serving team";
}

const campusCycle = ["cmp-scarborough", "cmp-scarborough", "cmp-markham", "cmp-central"] as const;

const ministryCycle = [
  ["min-music"],
  ["min-victuals"],
  ["min-transport"],
  [],
  ["min-reachout"],
  ["min-music", "min-victuals"],
  [],
  ["min-transport"],
] as const;

/*
 * Note what is absent: no generated person belongs to a leadership group.
 * Membership of `grp-campus-leaders` is what makes a person an audience for
 * every `leadership`-visibility report, and quietly handing that to 76 invented
 * members would widen the audience of real fixtures by accident.
 */

/**
 * The rest of the roster.
 *
 * A campus directory is mostly people who are not leaders, which is the point:
 * a leader searching for someone is searching a long list of ordinary members,
 * not a short list of colleagues.
 */
export const bulkPeople: Person[] = Array.from({ length: 76 }, (_, i) => {
  const given = cycle(givenNames, i * 7 + 3);
  const family = cycle(familyNames, i * 5 + 1);
  return {
    id: `p-r${String(i + 1).padStart(3, "0")}`,
    name: `${given} ${family}`,
    initials: `${given[0]}${family[0]}`,
    role: roleFor(cycle(ministryCycle, i), i),
    campusId: cycle(campusCycle, i),
    ministryIds: [...cycle(ministryCycle, i)],
  };
});

/* ------------------------------------------------------- leadership reports */

const authorCycle = ["p-maria", "p-joel", "p-esther", "p-daniel", "p-john", "p-mark"] as const;

const bulkReportTypes = [
  "progress-report",
  "ministry-operations",
  "leadership-development",
  "general",
  "Camp Debrief",
] as const;

const reportSubjects = [
  "Serving rota",
  "Attendance",
  "Volunteer training",
  "Equipment and supplies",
  "Follow-up on new members",
  "Sunday set-up",
  "Budget line",
  "Camp preparation",
  "Midweek prayer",
  "Youth night",
] as const;

const reportTagCycle = [
  ["monthly"],
  ["training"],
  ["camp"],
  ["monthly", "attendance"],
  [],
  ["budget"],
  ["worship"],
  ["followup"],
  ["monthly", "training"],
  ["planning"],
] as const;

/**
 * A year and a half of ordinary reporting.
 *
 * This is the 150-plus scenario. Everything here is `leadership` visibility and
 * either published or shared — ordinary reporting traffic — so the narrative
 * fixtures remain the only place where a restricted or private audience is
 * asserted.
 */
export const bulkLeadershipReports: LeadershipReport[] = Array.from({ length: 158 }, (_, i) => {
  const author = cycle(authorCycle, i);
  const subject = cycle(reportSubjects, i * 3);
  const monthsBack = Math.floor(i / 10);
  const created = isoDate(monthsBack, (i % 10) * 3 + 2);
  const published = isoDate(monthsBack, (i % 10) * 3 + 4);
  const isPublished = i % 7 !== 0;

  return {
    id: `lr-v${String(i + 1).padStart(3, "0")}`,
    title: `${subject} — ${periodLabel(monthsBack)}`,
    reportType: cycle(bulkReportTypes, i),
    authorId: author,
    reportingPeriod: periodLabel(monthsBack),
    status: isPublished ? "published" : "shared",
    visibility: "leadership",
    audienceIds: [],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      { id: `lrb-v${i}-1`, type: "heading-2", html: "What happened" },
      {
        id: `lrb-v${i}-2`,
        type: "paragraph",
        html: `${subject} ran as planned for most of the period. Two weeks needed a stand-in.`,
      },
      { id: `lrb-v${i}-3`, type: "heading-2", html: "What needs attention" },
      {
        id: `lrb-v${i}-4`,
        type: "paragraph",
        html: "Cover for the last Sunday of the month is still unresolved.",
      },
    ],
    relatedDocumentIds: [],
    links: [],
    tags: [...cycle(reportTagCycle, i)],
    comments: [],
    activity: [
      {
        id: `lra-v${i}-1`,
        at: created,
        actorId: author,
        kind: "submitted",
        summary: "created this report",
      },
    ],
    revisions: [],
    createdAt: created,
    updatedAt: isPublished ? published : created,
    ...(isPublished ? { publishedAt: published } : {}),
  };
});

/* ----------------------------------------------------------- meeting notes */

/**
 * A recurring meeting, and the ministry it belongs to.
 *
 * Paired for the same reason the documents are: a note titled "Victuals
 * planning" filed under Transportation Ministry makes the context column look
 * arbitrary, and a leader who learns to ignore one column ignores the rest.
 * Meetings that belong to no single ministry carry no context link at all,
 * because an invented one would be worse than none.
 */
const meetings = [
  { title: "Leaders Meeting", ministryId: null, tags: ["leadership"] },
  { title: "Music Ministry Meeting", ministryId: "min-music", tags: ["worship", "planning"] },
  { title: "Victuals planning", ministryId: "min-victuals", tags: ["planning", "budget"] },
  { title: "Transportation check-in", ministryId: "min-transport", tags: ["follow-up"] },
  { title: "LifeGroup leaders huddle", ministryId: null, tags: ["leadership", "training"] },
  { title: "Camp committee", ministryId: null, tags: ["camp", "planning"] },
  { title: "Reach-Out coordination", ministryId: "min-reachout", tags: ["follow-up"] },
  { title: "Youth planning", ministryId: null, tags: ["planning"] },
] as const;

/** Eighteen months of meetings, minutes and personal notes alike. */
export const bulkMeetingNotes: MeetingNote[] = Array.from({ length: 64 }, (_, i) => {
  const monthsBack = Math.floor(i / 4);
  const date = isoDate(monthsBack, (i % 4) * 7 + 3);
  const isMinutes = i % 3 !== 0;
  const meeting = cycle(meetings, i);

  return {
    id: `mn-v${String(i + 1).padStart(3, "0")}`,
    title: isMinutes ? meeting.title : `${meeting.title} — my notes`,
    noteType: isMinutes ? "minutes" : "personal",
    date,
    participantIds: isMinutes ? ["p-maria", "p-joel", "p-esther"] : ["p-maria"],
    blocks: [
      {
        id: `mnb-v${i}-1`,
        type: "paragraph",
        html: "Went through the standing items. Nothing outstanding from last time.",
      },
      { id: `mnb-v${i}-2`, type: "decision", html: "Keep the current rota until the camp." },
    ],
    status: "complete",
    tags: [...meeting.tags],
    links: meeting.ministryId ? [{ kind: "ministry" as const, id: meeting.ministryId }] : [],
    createdAt: date,
    updatedAt: date,
    ...(isMinutes
      ? { facilitatorId: "p-ruth", noteTakerId: "p-maria", visibility: "leaders" as const }
      : { authorId: "p-maria", visibility: "private" as const }),
  };
});

/* --------------------------------------------------------------- documents */

/**
 * What the document is, and one line saying so.
 *
 * Kept as pairs rather than two tables read at different offsets: a packing
 * list described as "the rota as it stands" teaches a leader that the
 * descriptions on this screen are decoration.
 */
const documentKinds = [
  { title: "Serving rota", note: "The rota as it stands, with stand-ins marked." },
  { title: "Song list", note: "Set for the month, with keys and who is leading." },
  { title: "Supplies checklist", note: "What runs out first, and who restocks it." },
  { title: "Driver schedule", note: "Pick-up times and the vehicle assigned to each run." },
  { title: "Camp packing list", note: "What to bring and who is bringing it." },
  { title: "Volunteer sign-up", note: "Open slots for the month. Two still unfilled." },
  { title: "Setup diagram", note: "Where the stage, tables and cabling go." },
  { title: "Budget worksheet", note: "Numbers only; the write-up is in the monthly report." },
  { title: "Training handout", note: "Given out at the last session. Reusable." },
  { title: "Contact sheet", note: "Phone numbers for the serving team." },
] as const;

const ownerCycle = [
  { kind: "ministry", ministryId: "min-music" },
  { kind: "ministry", ministryId: "min-victuals" },
  { kind: "ministry", ministryId: "min-transport" },
  { kind: "reach-out" },
] as const;

const originCycle = ["binder", "drive", "file", "link"] as const;
const docTypeCycle = ["plan", "checklist", "spreadsheet", "schedule", "document"] as const;

/** The filing cabinet, at the size a filing cabinet actually reaches. */
export const bulkBinderDocuments: BinderDocument[] = Array.from({ length: 72 }, (_, i) => {
  const monthsBack = Math.floor(i / 6);
  const updated = isoDate(monthsBack, (i % 6) * 4 + 2);
  const origin = cycle(originCycle, i);
  const owner = cycle(ownerCycle, i);
  const kind = cycle(documentKinds, i * 3);

  return {
    id: `doc-v${String(i + 1).padStart(3, "0")}`,
    title: `${kind.title} — ${monthNames[monthOf(monthsBack).month - 1]}`,
    owner: { ...owner },
    preparedById: cycle(authorCycle, i * 2),
    type: cycle(docTypeCycle, i),
    origin,
    updatedAt: updated,
    /* A row a leader cannot recognize is a row they have to open. */
    description: kind.note,
    permission: "view",
    ...(origin === "drive" || origin === "link"
      ? { url: `https://example.org/oikonomia/${i + 1}` }
      : {}),
    ...(origin === "file" ? { fileName: `document-${i + 1}.pdf`, fileSize: "1.2 MB" } : {}),
  };
});
