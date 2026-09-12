import type {
  AttentionItem,
  Campus,
  EventContext,
  Ministry,
  Person,
  Persona,
  PersonaId,
  LeadershipReport,
  ReachOutReport,
  WorkContext,
  WorkingArtifact,
} from "@/domain/types";
import type { ResponsibilityGroup } from "@/domain/types";
import type { AgendaItem, Goal, GoalUpdate, ScheduleEntry } from "@/domain/types";
import type {
  Exhortation,
  Gathering,
  GatheringAttendance,
  GatheringReport,
  LifegroupEntry,
  MeetingNote,
  MeetingTask,
  MinistryActivity,
  BinderDocument,
  Venue,
} from "@/domain/types";
import {
  bulkBinderDocuments,
  bulkLeadershipReports,
  bulkMeetingNotes,
  bulkPeople,
} from "./fixtures.bulk";
import { toISO, weekOf } from "@/domain/schedule";

/**
 * Coherent relational fixtures for the prototype. One interconnected church
 * scenario — Scarborough campus, Summer Camp 2027, Sunday Worship Service,
 * Lifegroups, reports and leadership development — so every screen references
 * the same people, ministries, artifacts and work.
 */

export const campuses: Campus[] = [
  { id: "cmp-scarborough", name: "Scarborough", city: "Scarborough, ON" },
  { id: "cmp-markham", name: "Markham", city: "Markham, ON" },
  { id: "cmp-central", name: "Central", city: "Toronto, ON" },
];

/**
 * Two responsibility groups, invented here.
 *
 * They used to be constants in `src/domain`, which meant the product decided
 * what a church's leadership was. They are records now, so the only place
 * these ids may live is a fixture — a church names its own.
 */
export const GROUP_CENTRAL_LEADERSHIP = "grp-central-leadership";
export const GROUP_CAMPUS_LEADERS = "grp-campus-leaders";

const narrativePeople: Person[] = [
  {
    id: "p-maria",
    name: "Maria Santos",
    initials: "MS",
    role: "LifeGroup Leader · Music Ministry",
    campusId: "cmp-scarborough",
    ministryIds: ["min-music", GROUP_CAMPUS_LEADERS],
  },
  {
    id: "p-joel",
    name: "Joel Tan",
    initials: "JT",
    role: "Ministry Head · Transportation",
    campusId: "cmp-scarborough",
    ministryIds: ["min-transport", GROUP_CAMPUS_LEADERS],
  },
  {
    id: "p-esther",
    name: "Esther Lim",
    initials: "EL",
    role: "Ministry Head · Victuals",
    campusId: "cmp-scarborough",
    ministryIds: ["min-victuals"],
  },
  {
    id: "p-daniel",
    name: "Daniel Reyes",
    initials: "DR",
    role: "Ministry Head · Music",
    campusId: "cmp-scarborough",
    ministryIds: ["min-music"],
  },
  {
    id: "p-ruth",
    name: "Ruth Nakpil",
    initials: "RN",
    role: "Campus Leader · Scarborough",
    campusId: "cmp-scarborough",
    ministryIds: ["min-reachout", GROUP_CAMPUS_LEADERS],
  },
  {
    id: "p-bishop",
    name: "Bishop Andrew Villareal",
    initials: "AV",
    role: "Bishop",
    campusId: "cmp-scarborough",
    ministryIds: [GROUP_CENTRAL_LEADERSHIP],
  },
  {
    id: "p-admin",
    name: "Grace Chua",
    initials: "GC",
    role: "Administrator",
    campusId: "cmp-central",
    ministryIds: [],
  },
  {
    id: "p-mark",
    name: "Mark Delos Reyes",
    initials: "MR",
    role: "LifeGroup Leader",
    campusId: "cmp-scarborough",
    ministryIds: ["min-reachout"],
  },
  {
    id: "p-nathan",
    name: "Nathan Ilagan",
    initials: "NI",
    role: "Youth Leader",
    campusId: "cmp-scarborough",
    ministryIds: ["min-music"],
  },
  {
    id: "p-peter",
    name: "Peter Ong",
    initials: "PO",
    role: "Driver · Transportation",
    campusId: "cmp-scarborough",
    ministryIds: ["min-transport"],
  },
  {
    id: "p-anna",
    name: "Anna Cruz",
    initials: "AC",
    role: "Member · Scarborough",
    campusId: "cmp-scarborough",
    ministryIds: [],
  },
  {
    id: "p-jonas",
    name: "Jonas Aquino",
    initials: "JA",
    role: "Guest · first visit 30 August",
    campusId: "cmp-scarborough",
    ministryIds: [],
  },
  {
    id: "p-lita",
    name: "Lita Bautista",
    initials: "LB",
    role: "Guest · Markham",
    campusId: "cmp-markham",
    ministryIds: [],
  },
  {
    id: "p-juan",
    name: "Juan Dela Cruz",
    initials: "JD",
    role: "Member · Scarborough",
    campusId: "cmp-scarborough",
    ministryIds: [],
  },
  {
    id: "p-john",
    name: "John Baronia",
    initials: "JB",
    role: "LifeGroup Leader · Scarborough",
    campusId: "cmp-scarborough",
    ministryIds: [],
  },
];

export const people: Person[] = [...narrativePeople, ...bulkPeople];

/**
 * The invented church's leadership bodies, as records.
 *
 * Membership is read back off the people above rather than listed twice, so a
 * fixture person and a fixture group can never disagree about who is in it.
 * The central body carries no campus — church-wide reach — and the campus one
 * does, which is how far each reaches.
 */
export const groups: ResponsibilityGroup[] = [
  {
    id: GROUP_CENTRAL_LEADERSHIP,
    name: "Central Leadership",
    description: "Answers for the whole church.",
    groupType: "leadership-body",
    leadershipAudience: true,
    active: true,
    memberIds: people
      .filter((person) => person.ministryIds.includes(GROUP_CENTRAL_LEADERSHIP))
      .map((person) => person.id),
  },
  {
    id: GROUP_CAMPUS_LEADERS,
    name: "Campus Leaders",
    description: "Answers for one campus.",
    groupType: "leadership-body",
    campusId: "cmp-scarborough",
    leadershipAudience: true,
    active: true,
    memberIds: people
      .filter((person) => person.ministryIds.includes(GROUP_CAMPUS_LEADERS))
      .map((person) => person.id),
  },
];

export const personById = (id: string) =>
  people.find((p) => p.id === id) ?? {
    id,
    name: "Unknown person",
    initials: "··",
    role: "",
    campusId: "",
    ministryIds: [],
  };

export const personas: Persona[] = [
  {
    id: "leader",
    personId: "p-maria",
    label: "Leader",
    focus: "Personal ministry, Lifegroup follow-up, reports returned to me",
    capabilities: [],
  },
  {
    id: "ministry-head",
    personId: "p-joel",
    label: "Ministry Head",
    focus: "Ministry work, team reviews, event responsibilities",
    capabilities: [],
  },
  {
    id: "bishop",
    personId: "p-bishop",
    label: "Bishop",
    focus: "Routed reviews, concerns, cross-ministry oversight",
    capabilities: ["campus-oversight", "cross-ministry-oversight"],
  },
  {
    id: "admin",
    personId: "p-admin",
    label: "Admin",
    focus: "Configuration, imports, operational setup",
    capabilities: ["administration"],
  },
];

export const personaById = (id: PersonaId): Persona =>
  personas.find((p) => p.id === id) ?? {
    id,
    personId: "p-maria",
    label: "Leader",
    focus: "Personal ministry",
    capabilities: [],
  };

export const ministries: Ministry[] = [
  {
    id: "min-music",
    name: "Music Ministry",
    purpose: "Lead the congregation in worship across services and gatherings.",
    campusId: "cmp-scarborough",
    leadId: "p-maria",
    teamIds: ["p-daniel", "p-nathan"],
  },
  {
    id: "min-transport",
    name: "Transportation Ministry",
    purpose: "Move people and resources safely for services, events and camps.",
    campusId: "cmp-scarborough",
    leadId: "p-joel",
    teamIds: ["p-peter"],
    sharedWithIds: ["p-maria"],
  },
  {
    id: "min-victuals",
    name: "Victuals Ministry",
    purpose: "Plan and serve food for gatherings, events and camps.",
    campusId: "cmp-scarborough",
    leadId: "p-esther",
    teamIds: ["p-anna", "p-maria"],
  },
  {
    id: "min-reachout",
    name: "Reach-Out Ministry",
    purpose: "Welcome guests and carry follow-up until they are connected.",
    campusId: "cmp-scarborough",
    leadId: "p-ruth",
    teamIds: ["p-mark"],
  },
];

export const artifacts: WorkingArtifact[] = [
  {
    id: "art-camp-master",
    title: "Camp 2027 Master Planning",
    provider: "google-sheets",
    authoritative: true,
    updated: "Today, 06:20",
    updatedBy: "p-ruth",
    sections: [
      "Program",
      "Participants",
      "Assignments",
      "Transportation",
      "Accommodation",
      "Food",
      "Budget",
      "Purchasing",
      "Resources",
    ],
    url: "https://docs.google.com/spreadsheets/d/oikonomia-camp-2027-master",
  },
  {
    id: "art-sws-order",
    title: "Sunday Worship Service — September order",
    provider: "google-docs",
    authoritative: true,
    updated: "Yesterday, 21:04",
    updatedBy: "p-daniel",
    sections: ["Order of service", "Song set", "Announcements"],
    url: "https://docs.google.com/document/d/oikonomia-sws-september",
  },
  {
    id: "art-music-rota",
    title: "Music Ministry rota — Q3",
    provider: "google-sheets",
    authoritative: true,
    updated: "Mon, 19:12",
    updatedBy: "p-daniel",
    sections: ["September", "October", "Availability"],
    url: "https://docs.google.com/spreadsheets/d/oikonomia-music-rota-q3",
  },
  {
    id: "art-lg-notes",
    title: "Scarborough East gathering notes",
    provider: "google-docs",
    authoritative: false,
    updated: "Sun, 22:40",
    updatedBy: "p-maria",
    sections: ["6 September", "30 August"],
    url: "https://docs.google.com/document/d/oikonomia-lg-scar-east-notes",
  },
  {
    id: "art-reachout-tracker",
    title: "Reach-Out follow-up tracker",
    provider: "google-sheets",
    authoritative: true,
    updated: "Today, 05:55",
    updatedBy: "p-mark",
    sections: ["Active", "Connected", "Stalled"],
    url: "https://docs.google.com/spreadsheets/d/oikonomia-reachout-tracker",
  },
];

export const artifactById = (id: string) => artifacts.find((a) => a.id === id);

/* ------------------------------------------------------- work / review set */

export const workContexts: WorkContext[] = [
  {
    id: "w-camp-transport",
    kind: "concern",
    subject: "Departure-day transport is 18 seats short",
    contextLabel: "Summer Camp 2027 · Transportation",
    contextPath: "/events/evt-camp",
    status: "open",
    currentState:
      "Two of three coaches confirmed. The Transportation sheet shows 18 unseated participants on 13 July. A third coach quote is in; the budget decision is open.",
    ministryId: "min-transport",
    campusId: "cmp-scarborough",
    ownerId: "p-joel",
    assigneeIds: ["p-joel"],
    reviewerIds: ["p-ruth"],
    participantIds: ["p-maria", "p-esther", "p-peter"],
    due: "Decision needed by 19 September",
    artifactIds: ["art-camp-master"],
    openQuestions: [
      "Do we add a third coach or stagger departure in two waves?",
      "Who confirms the seat count in the master sheet after registration closes?",
    ],
    decisions: [
      {
        id: "d-1",
        summary:
          "Hold two coaches; stagger youth departure only if the third coach is not approved by 19 September.",
        decidedById: "p-ruth",
        at: "Yesterday, 17:30",
        state: "recorded",
      },
    ],
    comments: [
      {
        id: "c-1",
        authorId: "p-joel",
        at: "Yesterday, 09:12",
        target: "Transportation",
        body: "Participants tab is now at 154. With two coaches we seat 136. @Transportation Ministry can anyone confirm the school bus option is still on the table?",
      },
      {
        id: "c-2",
        authorId: "p-peter",
        at: "Yesterday, 11:40",
        body: "School bus is available but not for the return trip on the 17th. Third coach quote came in at $980.",
      },
      {
        id: "c-3",
        authorId: "p-maria",
        at: "Yesterday, 15:02",
        body: "Music team travels with instruments — please keep us on the first departure whichever way this goes.",
      },
      {
        id: "c-4",
        authorId: "p-ruth",
        at: "Yesterday, 17:30",
        system: true,
        body: "Recorded a decision and set a due date of 19 September.",
      },
    ],
    activity: [
      {
        id: "a-1",
        at: "Mon, 08:00",
        actorId: "p-joel",
        kind: "status",
        summary: "Raised this concern from the Camp 2027 planning workbook",
      },
      {
        id: "a-2",
        at: "Yesterday, 09:12",
        actorId: "p-joel",
        kind: "comment",
        summary: "Group mentioned Transportation Ministry",
      },
      {
        id: "a-3",
        at: "Today, 06:20",
        kind: "artifact",
        summary: "Camp 2027 Master Planning updated · Transportation",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-joel",
      campusId: "cmp-scarborough",
      ministryId: "min-transport",
      audienceGroups: ["min-transport", "min-music", "min-victuals"],
      reviewers: ["p-ruth"],
      participants: ["p-maria", "p-esther", "p-peter"],
    },
  },
  {
    id: "w-victuals-count",
    kind: "concern",
    subject: "Catering needs a confirmed participant count",
    contextLabel: "Summer Camp 2027 · Victuals",
    contextPath: "/events/evt-camp",
    status: "open",
    currentState:
      "Food tab is still costed against 120 participants while registration shows 154. Esther needs a locked number before purchasing.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    ownerId: "p-esther",
    assigneeIds: ["p-esther"],
    reviewerIds: [],
    participantIds: ["p-ruth", "p-joel", "p-maria"],
    due: "Due 16 September",
    artifactIds: ["art-camp-master"],
    openQuestions: ["When does registration close for catering purposes?"],
    decisions: [],
    comments: [
      {
        id: "c-5",
        authorId: "p-esther",
        at: "Today, 06:02",
        target: "Food",
        body: "@Victuals Ministry @Transportation Ministry I am holding purchasing until the count is locked. Please do not edit the Food tab in the meantime.",
      },
    ],
    activity: [
      {
        id: "a-4",
        at: "Today, 06:02",
        actorId: "p-esther",
        kind: "comment",
        summary: "Group mentioned Victuals and Transportation Ministry",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-esther",
      campusId: "cmp-scarborough",
      ministryId: "min-victuals",
      audienceGroups: ["min-victuals", "min-transport", "min-music"],
      participants: ["p-ruth", "p-joel", "p-maria"],
    },
  },
  {
    id: "w-camp-budget",
    kind: "decision",
    subject: "Approve the third coach budget line ($980)",
    contextLabel: "Summer Camp 2027 · Budget",
    contextPath: "/events/evt-camp",
    status: "in-review",
    currentState:
      "Requested addition to the Budget tab. Campus leadership has seen the transport shortfall; the decision sits with central leadership review.",
    ministryId: "min-transport",
    campusId: "cmp-scarborough",
    ownerId: "p-joel",
    assigneeIds: ["p-joel"],
    reviewerIds: ["p-bishop"],
    participantIds: ["p-ruth"],
    due: "Due 19 September",
    artifactIds: ["art-camp-master"],
    openQuestions: ["Does this come from camp fees or the campus transport line?"],
    decisions: [
      {
        id: "d-2",
        summary: "Decision requested from central leadership",
        decidedById: "p-joel",
        at: "Today, 07:10",
        state: "requested",
      },
    ],
    comments: [
      {
        id: "c-6",
        authorId: "p-joel",
        at: "Today, 07:10",
        target: "Budget",
        body: "Quote attached in the Budget tab, row 41. Requesting a decision so I can confirm with the coach company this week.",
      },
    ],
    activity: [
      {
        id: "a-5",
        at: "Today, 07:10",
        actorId: "p-joel",
        kind: "decision",
        summary: "Requested a decision from central leadership",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-joel",
      campusId: "cmp-scarborough",
      ministryId: "min-transport",
      audienceGroups: ["min-transport", GROUP_CAMPUS_LEADERS],
      reviewers: ["p-bishop"],
      participants: ["p-ruth"],
    },
  },
  {
    id: "w-sws-rota",
    kind: "review",
    subject: "13 September rota has two unfilled positions",
    contextLabel: "Sunday Worship Service · Music Ministry",
    contextPath: "/events/evt-sws",
    status: "open",
    currentState:
      "Keys and second vocal are unassigned for 13 September. Maria is asked to fill both from the availability tab before Friday rehearsal.",
    ministryId: "min-music",
    campusId: "cmp-scarborough",
    ownerId: "p-daniel",
    assigneeIds: ["p-maria"],
    reviewerIds: [],
    participantIds: ["p-nathan"],
    due: "Due Friday 11 September",
    artifactIds: ["art-music-rota", "art-sws-order"],
    openQuestions: ["Is Nathan available for keys if he is not preaching support?"],
    decisions: [],
    comments: [
      {
        id: "c-7",
        authorId: "p-daniel",
        at: "Yesterday, 20:15",
        target: "September",
        body: "Assigning this to you Maria — availability tab is up to date as of Monday.",
      },
    ],
    activity: [
      {
        id: "a-6",
        at: "Yesterday, 20:15",
        actorId: "p-daniel",
        kind: "assigned",
        summary: "Assigned to Maria Santos",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-daniel",
      campusId: "cmp-scarborough",
      ministryId: "min-music",
      audienceGroups: ["min-music"],
      participants: ["p-nathan"],
    },
  },
  {
    id: "w-lg-follow-up",
    kind: "gathering-follow-up",
    subject: "Follow-up after the 6 September gathering",
    contextLabel: "Baronia Residence · 6 September",
    contextPath: "/lifegroups/lg-scar-east",
    status: "open",
    currentState:
      "One household asked for a pastoral visit. Maria is carrying the follow-up with the campus leader; nothing is shared beyond that pastoral audience.",
    campusId: "cmp-scarborough",
    ownerId: "p-maria",
    assigneeIds: ["p-maria"],
    reviewerIds: [],
    participantIds: [],
    due: "This week",
    artifactIds: ["art-lg-notes"],
    openQuestions: ["Home visit this Saturday, or a call first?"],
    decisions: [],
    sections: [
      {
        title: "Follow-up context",
        body: "The household has attended three gatherings and asked for prayer support during a family illness.",
      },
      {
        title: "Pastoral note",
        body: "Detail withheld from anyone outside the assigned pastoral audience.",
        sensitive: true,
      },
    ],
    comments: [
      {
        id: "c-8",
        authorId: "p-maria",
        at: "Sun, 22:40",
        body: "I will call this evening and offer Saturday. Ruth, may I bring you if they say yes?",
      },
    ],
    activity: [
      {
        id: "a-7",
        at: "Sun, 22:40",
        actorId: "p-maria",
        kind: "status",
        summary: "Opened follow-up from the gathering record",
      },
    ],
    policy: {
      classification: "pastoral-private",
      ownerId: "p-maria",
      campusId: "cmp-scarborough",
      audience: ["p-ruth"],
      restrictedSections: ["Pastoral note"],
    },
  },
  {
    id: "w-lead-dev-report",
    kind: "report",
    subject: "Leadership Development Report — Maria Santos",
    contextLabel: "Leadership Development · Q3 2026",
    contextPath: "/leadership",
    status: "submitted",
    currentState:
      "Submitted for review by the assigned development reviewer. Two growth areas carried over from Q2; the pastoral section is restricted to the named audience.",
    campusId: "cmp-scarborough",
    ownerId: "p-maria",
    assigneeIds: [],
    reviewerIds: ["p-bishop"],
    participantIds: [],
    period: "Q3 2026",
    reportType: "Leadership development",
    due: "Review requested by 15 September",
    artifactIds: [],
    openQuestions: ["Does the mentoring cadence stay monthly next quarter?"],
    decisions: [],
    sections: [
      {
        title: "Ministry summary",
        body: "Led 11 of 12 Lifegroup gatherings, served 6 Sunday services on keys, carried three Reach-Out follow-ups to connected.",
      },
      {
        title: "Growth areas",
        body: "Delegation inside the Lifegroup team, and preparing co-leaders to run a gathering without support.",
      },
      {
        title: "Pastoral notes",
        body: "Confidential development conversation held with the assigned reviewer.",
        sensitive: true,
      },
    ],
    comments: [
      {
        id: "c-9",
        authorId: "p-maria",
        at: "Mon, 07:45",
        body: "Submitted for Q3. Happy to talk through the delegation point in our next session.",
      },
    ],
    activity: [
      {
        id: "a-8",
        at: "Mon, 07:45",
        actorId: "p-maria",
        kind: "submitted",
        summary: "Submitted the Q3 development report",
      },
      {
        id: "a-9",
        at: "Mon, 07:46",
        kind: "review",
        summary: "Review requested from the assigned development reviewer",
      },
    ],
    policy: {
      classification: "leadership-confidential",
      ownerId: "p-maria",
      campusId: "cmp-scarborough",
      audienceGroups: [GROUP_CENTRAL_LEADERSHIP],
      reviewers: ["p-bishop"],
      restrictedSections: ["Pastoral notes"],
    },
  },
  {
    /*
     * Returned to its author. A leader's week is not all healthy records, and a
     * fixture set in which nothing has come back cannot show what "a reviewer
     * asked for changes" looks like — which is the one state the dashboard is
     * allowed to call blocked rather than merely late.
     */
    id: "w-music-report-returned",
    kind: "report",
    subject: "Music Ministry monthly report — August",
    contextLabel: "Music Ministry · August 2026",
    contextPath: "/ministries/min-music",
    status: "changes-requested",
    currentState:
      "Campus leader asked for the Christmas rehearsal plan to be attached before this is acknowledged.",
    ministryId: "min-music",
    campusId: "cmp-scarborough",
    ownerId: "p-maria",
    assigneeIds: ["p-maria"],
    reviewerIds: ["p-joel"],
    participantIds: [],
    period: "August 2026",
    reportType: "Ministry monthly",
    due: "Response due 12 September",
    artifactIds: [],
    openQuestions: ["Which Saturdays are held for Christmas rehearsals?"],
    decisions: [],
    sections: [
      {
        title: "August summary",
        body: "Four services covered, one midweek rehearsal missed for the camp weekend.",
      },
    ],
    comments: [],
    activity: [
      {
        id: "a-music-returned",
        at: "Thu, 16:20",
        actorId: "p-joel",
        kind: "review",
        summary: "Asked for the rehearsal plan",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-maria",
      campusId: "cmp-scarborough",
      ministryId: "min-music",
      audienceGroups: ["min-music"],
      reviewers: ["p-joel"],
    },
  },
  {
    id: "w-victuals-report",
    kind: "report",
    subject: "Victuals Ministry monthly report — August",
    contextLabel: "Victuals Ministry · August 2026",
    contextPath: "/ministries/min-victuals",
    status: "changes-requested",
    currentState:
      "Reviewer asked for the purchasing variance to be explained before acknowledgement. Everything else is accepted.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    ownerId: "p-esther",
    assigneeIds: ["p-esther"],
    reviewerIds: ["p-ruth"],
    participantIds: [],
    period: "August 2026",
    reportType: "Ministry monthly",
    due: "Response due 12 September",
    artifactIds: [],
    openQuestions: ["Why did purchasing run 14% over the August plan?"],
    decisions: [],
    sections: [
      {
        title: "Served gatherings",
        body: "Nine gatherings served, including two campus-wide meals and the youth night.",
      },
      {
        title: "Team",
        body: "Six volunteers active, two new volunteers onboarded in August.",
      },
      {
        title: "Purchasing variance",
        body: "Line-by-line purchasing detail, restricted to the ministry and its reviewer.",
        sensitive: true,
      },
    ],
    comments: [
      {
        id: "c-10",
        authorId: "p-ruth",
        at: "Tue, 14:20",
        body: "Everything reads well. I need one paragraph on the purchasing variance before I acknowledge.",
      },
    ],
    activity: [
      {
        id: "a-10",
        at: "Mon, 16:00",
        actorId: "p-esther",
        kind: "submitted",
        summary: "Submitted the August ministry report",
      },
      {
        id: "a-11",
        at: "Tue, 14:20",
        actorId: "p-ruth",
        kind: "review",
        summary: "Requested changes",
      },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-esther",
      campusId: "cmp-scarborough",
      ministryId: "min-victuals",
      audienceGroups: ["min-victuals"],
      reviewers: ["p-ruth"],
      restrictedSections: ["Purchasing variance"],
    },
  },
  {
    id: "w-campus-attendance-report",
    kind: "report",
    subject: "Scarborough campus attendance report — August",
    contextLabel: "Scarborough Campus · August 2026",
    contextPath: "/campuses",
    status: "acknowledged",
    currentState:
      "Acknowledged by central leadership. Guest attendance is up; Reach-Out follow-up is the noted action.",
    campusId: "cmp-scarborough",
    ownerId: "p-ruth",
    assigneeIds: [],
    reviewerIds: ["p-bishop"],
    participantIds: ["p-admin"],
    period: "August 2026",
    reportType: "Campus attendance",
    artifactIds: [],
    openQuestions: [],
    decisions: [
      {
        id: "d-3",
        summary: "Acknowledged; Reach-Out to report follow-up conversion at the end of September.",
        decidedById: "p-bishop",
        at: "Wed, 09:05",
        state: "recorded",
      },
    ],
    sections: [
      {
        title: "Attendance",
        body: "Average Sunday attendance 412 across two services, up 4% on July. Lifegroup attendance steady at 236.",
      },
      {
        title: "Guests",
        body: "31 first-time guests recorded, 19 with an active Reach-Out owner.",
      },
    ],
    comments: [
      {
        id: "c-11",
        authorId: "p-bishop",
        at: "Wed, 09:05",
        body: "Thank you Ruth. Let us see conversion at the end of the month.",
      },
    ],
    activity: [
      {
        id: "a-12",
        at: "Tue, 08:10",
        actorId: "p-ruth",
        kind: "submitted",
        summary: "Submitted the August campus attendance report",
      },
      {
        id: "a-13",
        at: "Wed, 09:05",
        actorId: "p-bishop",
        kind: "decision",
        summary: "Acknowledged the report",
      },
    ],
    policy: {
      classification: "open",
      ownerId: "p-ruth",
      campusId: "cmp-scarborough",
      reviewers: ["p-bishop"],
      participants: ["p-admin"],
    },
  },
  {
    id: "w-sept-direction",
    kind: "decision",
    subject: "September leadership direction",
    contextLabel: "Central Leadership · September",
    contextPath: "/leadership",
    status: "open",
    currentState:
      "Named leadership audience only. Campus leaders receive routed awareness of the ministry actions that concern them, not the confidential discussion.",
    campusId: "cmp-scarborough",
    ownerId: "p-bishop",
    assigneeIds: [],
    reviewerIds: [],
    participantIds: ["p-ruth"],
    artifactIds: [],
    openQuestions: [],
    decisions: [],
    sections: [
      {
        title: "Direction",
        body: "Leadership direction for September, shared with the named central leadership audience.",
      },
    ],
    comments: [
      {
        id: "c-12",
        authorId: "p-bishop",
        at: "Mon, 06:30",
        body: "Campus leaders will receive the ministry-facing actions separately.",
        restricted: true,
      },
    ],
    activity: [
      {
        id: "a-14",
        at: "Mon, 06:30",
        actorId: "p-bishop",
        kind: "status",
        summary: "Opened the September direction thread",
      },
    ],
    policy: {
      classification: "leadership-confidential",
      ownerId: "p-bishop",
      campusId: "cmp-scarborough",
      audienceGroups: [GROUP_CENTRAL_LEADERSHIP],
      participants: ["p-ruth"],
    },
  },
  {
    id: "w-admin-config",
    kind: "concern",
    subject: "Two Markham records look like the same person",
    contextLabel: "Administration · Directory",
    contextPath: "/administration",
    status: "open",
    currentState:
      "Two entries in the people directory carry the same name and campus. Until somebody who knows them says whether they are one person, ministry membership is counted twice.",
    campusId: "cmp-central",
    ownerId: "p-admin",
    assigneeIds: ["p-admin"],
    reviewerIds: [],
    participantIds: ["p-ruth"],
    due: "Due today",
    artifactIds: [],
    openQuestions: ["Are the two Markham duplicates the same person?"],
    decisions: [],
    comments: [
      {
        id: "c-13",
        authorId: "p-admin",
        at: "Today, 05:40",
        body: "Leaving both entries in place until Ruth confirms. Merging the wrong two is not undoable by hand.",
      },
    ],
    activity: [
      {
        id: "a-15",
        at: "Today, 05:40",
        actorId: "p-admin",
        kind: "status",
        summary: "Raised after the duplicate turned up in a ministry list",
      },
    ],
    policy: {
      classification: "open",
      ownerId: "p-admin",
      participants: ["p-ruth"],
    },
  },
];

export const workById = (id: string) => workContexts.find((w) => w.id === id);

export const workPath = (work: WorkContext) =>
  work.kind === "report" ? `/reports/${work.id}` : `/work/${work.id}`;

/* -------------------------------------------------------------- attention */

export const attentionItems: AttentionItem[] = [
  // Leader — Maria
  {
    id: "at-1",
    workId: "w-sws-rota",
    reason: "assigned",
    recipients: ["leader"],
    routedById: "p-daniel",
    at: "Yesterday, 20:15",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-2",
    workId: "w-camp-transport",
    reason: "mentioned",
    recipients: ["leader"],
    routedById: "p-joel",
    at: "Yesterday, 09:12",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-3",
    workId: "w-victuals-count",
    reason: "group-mentioned",
    recipients: ["leader", "ministry-head"],
    routedById: "p-esther",
    at: "Today, 06:02",
    unread: true,
    state: "inbox",
    group: "Victuals & Transportation Ministry",
  },
  {
    id: "at-4",
    workId: "w-lead-dev-report",
    reason: "participating",
    recipients: ["leader"],
    at: "Mon, 07:46",
    unread: false,
    state: "inbox",
  },
  {
    id: "at-5",
    workId: "w-lg-follow-up",
    reason: "follow-up",
    recipients: ["leader"],
    at: "Sun, 22:40",
    unread: false,
    state: "saved",
  },
  {
    id: "at-6",
    workId: "w-sept-direction",
    reason: "group-mentioned",
    recipients: ["leader"],
    at: "Mon, 06:30",
    unread: false,
    state: "inbox",
    group: "Scarborough leaders",
  },
  // Ministry Head — Joel
  {
    id: "at-7",
    workId: "w-camp-transport",
    reason: "assigned",
    recipients: ["ministry-head"],
    at: "Mon, 08:00",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-8",
    workId: "w-camp-budget",
    reason: "decision-requested",
    recipients: ["ministry-head"],
    at: "Today, 07:10",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-9",
    workId: "w-camp-transport",
    reason: "due-soon",
    recipients: ["ministry-head"],
    at: "Today, 05:00",
    unread: false,
    state: "inbox",
  },
  {
    id: "at-10",
    workId: "w-victuals-count",
    reason: "follow-up",
    recipients: ["ministry-head"],
    at: "Today, 06:05",
    unread: false,
    state: "saved",
  },
  // Bishop
  {
    id: "at-11",
    workId: "w-lead-dev-report",
    reason: "review-requested",
    recipients: ["bishop"],
    routedById: "p-maria",
    at: "Mon, 07:46",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-12",
    workId: "w-camp-budget",
    reason: "review-requested",
    recipients: ["bishop"],
    routedById: "p-joel",
    at: "Today, 07:10",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-13",
    workId: "w-victuals-report",
    reason: "participating",
    recipients: ["bishop"],
    at: "Tue, 14:20",
    unread: false,
    state: "inbox",
  },
  {
    id: "at-14",
    workId: "w-sept-direction",
    reason: "participating",
    recipients: ["bishop"],
    at: "Mon, 06:30",
    unread: false,
    state: "inbox",
  },
  {
    id: "at-15",
    workId: "w-campus-attendance-report",
    reason: "review-requested",
    recipients: ["bishop"],
    at: "Tue, 08:10",
    unread: false,
    state: "done",
  },
  // Admin
  {
    id: "at-16",
    workId: "w-admin-config",
    reason: "assigned",
    recipients: ["admin"],
    at: "Today, 05:40",
    unread: true,
    state: "inbox",
  },
  {
    id: "at-17",
    workId: "w-campus-attendance-report",
    reason: "participating",
    recipients: ["admin"],
    at: "Tue, 08:10",
    unread: false,
    state: "inbox",
  },
  {
    id: "at-18",
    workId: "w-victuals-report",
    reason: "group-mentioned",
    recipients: ["admin"],
    at: "Tue, 14:25",
    unread: false,
    state: "inbox",
    group: "Configuration owners",
  },
];

/* ----------------------------------------------------------------- events */

export const events: EventContext[] = [
  {
    id: "evt-sws",
    name: "Sunday Worship Service",
    depth: "recurring",
    when: "Every Sunday · 9:00 AM and 11:30 AM",
    campusId: "cmp-scarborough",
    ministryIds: ["min-music"],
    organiserId: "p-daniel",
    readiness: "2 rota positions unfilled for 13 September",
    summary:
      "Repeatable service workflow: schedule, serving roles, rota, attendance and predictable follow-up.",
    artifactIds: ["art-sws-order", "art-music-rota"],
    workIds: ["w-sws-rota"],
    roles: [
      { role: "Preaching", personId: "p-bishop" },
      { role: "Worship lead", personId: "p-daniel" },
      { role: "Keys", note: "Unfilled" },
      { role: "Second vocal", note: "Unfilled" },
      { role: "Sound", personId: "p-nathan" },
      { role: "Welcome desk", personId: "p-mark" },
    ],
    policy: {
      classification: "open",
      ownerId: "p-daniel",
      campusId: "cmp-scarborough",
    },
  },
  {
    id: "evt-camp",
    name: "Summer Camp 2027",
    depth: "project",
    when: "13–17 July 2027 · Camp Kawartha",
    campusId: "cmp-scarborough",
    ministryIds: ["min-transport", "min-victuals", "min-music"],
    organiserId: "p-ruth",
    readiness: "Transport shortfall and catering count are open concerns",
    summary:
      "Multi-ministry project event. One master planning workbook stays authoritative; Oikonomia adds context, discussion, decisions and history around it.",
    artifactIds: ["art-camp-master"],
    workIds: ["w-camp-transport", "w-victuals-count", "w-camp-budget"],
    milestones: [
      { label: "Registration opens", when: "1 March 2027", done: true },
      { label: "Transport confirmed", when: "19 September 2026", done: false },
      { label: "Catering purchasing", when: "1 October 2026", done: false },
      { label: "Program locked", when: "1 May 2027", done: false },
    ],
    policy: {
      classification: "context-restricted",
      ownerId: "p-ruth",
      campusId: "cmp-scarborough",
      audienceGroups: ["min-transport", "min-victuals", "min-music", GROUP_CAMPUS_LEADERS],
    },
  },
  {
    id: "evt-newcomers",
    name: "Newcomers' Welcome",
    depth: "recurring",
    when: "Saturday 19 September · 11:00 AM",
    campusId: "cmp-scarborough",
    ministryIds: ["min-reachout"],
    organiserId: "p-ruth",
    readiness: "14 guests invited, 9 confirmed",
    summary: "Light repeatable gathering for first-time guests, feeding Reach-Out follow-up.",
    artifactIds: ["art-reachout-tracker"],
    workIds: [],
    roles: [
      { role: "Host", personId: "p-ruth" },
      { role: "Follow-up", personId: "p-mark" },
      { role: "Refreshments", personId: "p-esther" },
    ],
    policy: {
      classification: "open",
      ownerId: "p-ruth",
      campusId: "cmp-scarborough",
    },
  },
];

export const eventById = (id: string) => events.find((e) => e.id === id);

/* ------------------------------------------------------------- lifegroups */

/* --------------------------------------------------------------- calendar */

/* --------------------------------------------------------------- reach-out */

/*
 * Attendance fixtures were removed deliberately.
 *
 * Participation is now read from the marks leaders actually make at
 * gatherings, so a page showing 224 people at a service nobody counted is a
 * page stating something untrue. Service and event attendance capture does
 * not exist yet; until it does, those contexts show nothing.
 */

/* --------------------------------------------------------------- schedule */

/**
 * Binder schedule fixtures.
 *
 * Anchored to the current week so the calendar is always populated when opened,
 * rather than pinned to a month that quietly goes stale. Recurring ministry
 * rhythms carry the month; one-off entries and agenda items sit on top.
 */

const today = new Date();
const thisMonday = weekOf(toISO(today));

/** Day of the current binder week (0 = Monday … 6 = Sunday). */
function day(offset: number, weeks = 0): string {
  const base = new Date(thisMonday + "T00:00:00");
  base.setDate(base.getDate() + offset + weeks * 7);
  return toISO(base);
}

/** Rhythms started well before the visible range so every month is filled. */
const rhythmStart = toISO(new Date(today.getFullYear() - 1, 0, 1));

export const scheduleEntries: ScheduleEntry[] = [
  /* ---- weekly ministry rhythms ---- */
  {
    id: "se-sws",
    title: "Worship Service",
    recurrence: { frequency: "weekly", weekday: 0, from: rhythmStart },
    startTime: "09:00",
    category: "service",
    location: "Scarborough campus",
    ministryId: "min-music",
  },
  {
    id: "se-lifegroup",
    title: "Lifegroup",
    recurrence: { frequency: "weekly", weekday: 0, from: rhythmStart },
    startTime: "18:00",
    category: "lifegroup",
    location: "Santos home",
  },
  {
    id: "se-prayer-fasting",
    title: "Prayer & Fasting",
    // Untimed on purpose: it runs all day and the binder never gives it a clock.
    recurrence: { frequency: "weekly", weekday: 3, from: rhythmStart },
    category: "prayer-fasting",
  },
  {
    id: "se-chat",
    title: "CHAT",
    recurrence: { frequency: "weekly", weekday: 5, from: rhythmStart },
    startTime: "19:30",
    category: "chat",
  },
  {
    id: "se-victuals",
    title: "Victuals serving",
    recurrence: { frequency: "weekly", weekday: 6, from: rhythmStart },
    category: "victuals",
    ministryId: "min-victuals",
  },

  /* ---- one-off entries across the current month ---- */
  {
    id: "se-seed",
    title: "SEED L2",
    date: day(1),
    startTime: "19:30",
    category: "seed",
    location: "North York",
  },
  {
    id: "se-ministry-meeting",
    title: "Ministry meeting",
    date: day(3),
    startTime: "19:30",
    category: "ministry-meeting",
    ministryId: "min-victuals",
    note: "Agenda: camp transport, September rota, potbless rotation.",
  },
  {
    id: "se-potbless",
    title: "Potbless",
    date: day(6),
    category: "potbless",
    note: "Shared meal after the second service.",
  },
  {
    id: "se-mentorship",
    title: "Mentorship session",
    date: day(2, 1),
    startTime: "10:00",
    category: "mentorship",
    location: "Campus office",
  },
  {
    id: "se-birthday",
    title: "Anna Cruz — birthday",
    date: day(4),
    category: "celebration",
  },
  {
    id: "se-anniversary",
    title: "Mark & Lita — anniversary",
    date: day(5, 1),
    category: "celebration",
  },
  {
    id: "se-camp-call",
    title: "Camp transport call",
    date: day(3),
    startTime: "12:30",
    category: "ministry-meeting",
    location: "Phone",
    relatedWorkId: "w-camp-transport",
  },
  {
    id: "se-seed-l3",
    title: "SEED L3",
    date: day(1, 2),
    startTime: "19:30",
    category: "seed",
    location: "North York",
  },
  {
    id: "se-newcomers",
    title: "Newcomers' Welcome",
    date: day(5, 1),
    startTime: "11:00",
    category: "ministry-meeting",
    ministryId: "min-reachout",
  },
];

export const agendaItems: AgendaItem[] = [
  /* Monday — a quiet day with preparation on it. */
  {
    id: "ag-appreciation",
    text: "Send group-chat appreciation message",
    date: day(0),
    completed: true,
    category: "other",
  },
  {
    id: "ag-preaching",
    text: "Watch recorded preaching and take notes",
    date: day(0),
    completed: false,
  },

  /* Tuesday — tied to the SEED session that evening. */
  {
    id: "ag-seed-reminder",
    text: "Send reminder to SEED participants",
    date: day(1),
    completed: false,
    relatedEntryId: "se-seed",
    category: "seed",
  },
  {
    id: "ag-seed-material",
    text: "Prepare L2 material",
    date: day(1),
    completed: false,
    relatedEntryId: "se-seed",
    category: "seed",
  },

  /* Wednesday. */
  {
    id: "ag-potluck",
    text: "Message potluck volunteers",
    date: day(2),
    completed: false,
    category: "potbless",
  },

  /* Thursday — the busy day. */
  {
    id: "ag-victuals-attendance",
    text: "Check Victuals attendance",
    date: day(3),
    completed: false,
    category: "victuals",
    ministryId: "min-victuals",
  },
  {
    id: "ag-inform-bishop",
    text: "Inform Bishop about the transport shortfall",
    date: day(3),
    completed: false,
    relatedEntryId: "se-camp-call",
  },
  {
    id: "ag-send-volunteers",
    text: "Send assigned volunteers for Saturday",
    date: day(3),
    completed: false,
    category: "victuals",
  },

  /* Friday. */
  {
    id: "ag-camera",
    text: "Remind Nathan to bring a camera",
    date: day(4),
    completed: false,
    category: "chat",
  },

  /* Saturday. */
  {
    id: "ag-potbless-reminder",
    text: "Remind potbless volunteers",
    date: day(5),
    completed: false,
    category: "potbless",
  },

  /* Sunday. */
  {
    id: "ag-send-word",
    text: "Send the Word / personal experience from Sunday",
    date: day(6),
    completed: false,
  },

  /* Week notes: belong to the week, not to any single day. */
  {
    id: "ag-note-schedule",
    text: "Finish next month's Victuals schedule",
    weekOf: thisMonday,
    completed: false,
    ministryId: "min-victuals",
  },
  {
    id: "ag-note-certificate",
    text: "Remind Victuals about the Safety Handling certificate",
    weekOf: thisMonday,
    completed: false,
    ministryId: "min-victuals",
  },
  {
    id: "ag-note-potbless",
    text: "Send next month's potbless update to the group",
    weekOf: thisMonday,
    completed: true,
  },
];

/* ------------------------------------------------------------------ goals */

/**
 * Annual ministry goals, modelled on the binder's numbered page.
 *
 * The year is derived from today so the current year is always populated, with
 * the prior year kept as a historical snapshot. Themes mirror the physical page
 * — training, certification, communication, facilities, fellowship, storage,
 * procedures, key-person development, equipment, uniforms, cleaning, call time —
 * without reproducing anyone's personal details.
 */

const YEAR = today.getFullYear();

/**
 * Reach-Out fixtures.
 *
 * Written to cover the range §2 says must be valid: a named family, an unnamed
 * crowd in a park, a vague "some of the visitors", a neighbourhood leaflet run,
 * and two phone calls. Not one of them is reducible to a person plus a stage,
 * which is the point.
 */
/**
 * Leadership Report fixtures.
 *
 * Written to embody the §27 authorization scenarios rather than to look busy.
 * Each report exists because some rule needs proving: a private draft nobody
 * else may discover, a supervisory report shared with exactly one person, a
 * leadership-wide update, an evaluation where author is not subject, a
 * restricted report related to Music Ministry that ministry participation must
 * not unlock, and a report whose content lives in Google Drive.
 */
const narrativeLeadershipReports: LeadershipReport[] = [
  /* A — private draft. Only Maria. */
  {
    id: "lr-a-private",
    title: "Leadership Development — September",
    reportType: "leadership-development",
    authorId: "p-maria",
    reportingPeriod: "September 2026",
    status: "draft",
    visibility: "private",
    audienceIds: [],
    discussionPolicy: "disabled",
    contentSource: "native",
    blocks: [
      { id: "lrb-a1", type: "heading-2", html: "Where I am" },
      {
        id: "lrb-a2",
        type: "paragraph",
        html: "Leading two gatherings a month is sustainable. Preparing exhortations still takes longer than it should.",
      },
      { id: "lrb-a3", type: "heading-2", html: "What I want to work on" },
      { id: "lrb-a4", type: "checklist", html: "Plan exhortations a week ahead", checked: false },
      { id: "lrb-a5", type: "checklist", html: "Ask Nathan to lead one gathering", checked: true },
    ],
    relatedDocumentIds: [],
    links: [],
    tags: ["development", "training"],
    comments: [],
    activity: [
      {
        id: "lra-a1",
        at: `${YEAR}-09-08`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-08`,
    updatedAt: `${YEAR}-09-08`,
  },

  /* B — confidential supervisory report: Maria + Joel only. */
  {
    id: "lr-b-supervisory",
    title: "Support needed on the camp rota",
    reportType: "pastoral-concern",
    authorId: "p-maria",
    status: "shared",
    visibility: "restricted",
    audienceIds: ["p-joel"],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      {
        id: "lrb-b1",
        type: "paragraph",
        html: "Two of the team have pulled out of the camp rota and I would rather raise it now than in the monthly report.",
      },
    ],
    relatedDocumentIds: [],
    links: [],
    tags: ["followup"],
    comments: [
      {
        id: "lrc-b1",
        authorId: "p-joel",
        at: "9 September",
        body: "Thank you for saying so early. Let us talk on Thursday.",
      },
    ],
    activity: [
      {
        id: "lra-b1",
        at: `${YEAR}-09-08`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
      {
        id: "lra-b2",
        at: `${YEAR}-09-09`,
        actorId: "p-maria",
        kind: "assigned",
        summary: "shared it with Joel Tan",
      },
      {
        id: "lra-b3",
        at: `${YEAR}-09-09`,
        actorId: "p-joel",
        kind: "comment",
        summary: "commented",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-08`,
    updatedAt: `${YEAR}-09-09`,
  },

  /* C — leadership-wide, published, discussion open. */
  {
    id: "lr-c-leadership",
    title: "Music Ministry Leadership Update",
    reportType: "ministry-operations",
    authorId: "p-maria",
    reportingPeriod: "September 2026",
    status: "published",
    visibility: "leadership",
    audienceIds: [],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      { id: "lrb-c1", type: "heading-2", html: "Where the ministry stands" },
      {
        id: "lrb-c2",
        type: "paragraph",
        html: "The team is settled after the move to Saturday practice. Two newer musicians need training before the Christmas presentation.",
      },
      { id: "lrb-c3", type: "heading-2", html: "What we need" },
      { id: "lrb-c4", type: "bullet", html: "A decision on the Christmas budget" },
      { id: "lrb-c5", type: "bullet", html: "Transport for the 20th" },
    ],
    relatedDocumentIds: ["md-goals"],
    links: [{ kind: "ministry", id: "min-music" }],
    tags: ["music", "training"],
    comments: [
      {
        id: "lrc-c1",
        authorId: "p-bishop",
        at: "9 September",
        body: "Noted on the budget. Bring the figures to the next leaders meeting.",
      },
    ],
    activity: [
      {
        id: "lra-c1",
        at: `${YEAR}-09-06`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
      {
        id: "lra-c2",
        at: `${YEAR}-09-08`,
        actorId: "p-maria",
        kind: "status",
        summary: "published the report",
      },
      {
        id: "lra-c3",
        at: `${YEAR}-09-09`,
        actorId: "p-bishop",
        kind: "comment",
        summary: "commented",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-06`,
    updatedAt: `${YEAR}-09-08`,
    publishedAt: `${YEAR}-09-08`,
  },

  /* D — evaluation. Author is Joel; subject is Maria. She may read, not edit. */
  {
    id: "lr-d-evaluation",
    title: "Leader Evaluation — Q3",
    reportType: "evaluation",
    authorId: "p-joel",
    subjectId: "p-maria",
    reportingPeriod: "Q3 2026",
    status: "published",
    visibility: "restricted",
    audienceIds: [],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      { id: "lrb-d1", type: "heading-2", html: "Strengths" },
      {
        id: "lrb-d2",
        type: "paragraph",
        html: "Consistent with the Lifegroup and trusted by the people she leads. Recording has improved markedly this quarter.",
      },
      { id: "lrb-d3", type: "heading-2", html: "To work on" },
      {
        id: "lrb-d4",
        type: "paragraph",
        html: "Delegation. Mark is ready to lead unsupported and should be given the chance.",
      },
    ],
    relatedDocumentIds: [],
    links: [],
    tags: ["development"],
    comments: [],
    activity: [
      {
        id: "lra-d1",
        at: `${YEAR}-09-02`,
        actorId: "p-joel",
        kind: "submitted",
        summary: "created this report",
      },
      {
        id: "lra-d2",
        at: `${YEAR}-09-05`,
        actorId: "p-joel",
        kind: "status",
        summary: "published the report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-02`,
    updatedAt: `${YEAR}-09-05`,
    publishedAt: `${YEAR}-09-05`,
  },

  /* E — restricted, related to Music Ministry. Relationship grants nothing. */
  {
    id: "lr-e-restricted-ministry",
    title: "Concern raised about a Music Ministry volunteer",
    reportType: "pastoral-concern",
    authorId: "p-maria",
    status: "shared",
    visibility: "restricted",
    audienceIds: ["p-bishop"],
    discussionPolicy: "selected",
    commenterIds: ["p-bishop"],
    contentSource: "native",
    blocks: [
      {
        id: "lrb-e1",
        type: "paragraph",
        html: "Raising this with you directly rather than in the ministry update.",
      },
    ],
    relatedDocumentIds: [],
    links: [{ kind: "ministry", id: "min-music" }],
    tags: ["followup"],
    comments: [],
    activity: [
      {
        id: "lra-e1",
        at: `${YEAR}-09-07`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-07`,
    updatedAt: `${YEAR}-09-07`,
  },

  /*
   * A type the church invented. Nothing in the code knows about it, and
   * everything still works — which is the point of an open type.
   */
  {
    id: "lr-g-custom-type",
    title: "Camp Debrief — Leaders",
    reportType: "Camp Debrief",
    authorId: "p-maria",
    reportingPeriod: "August 2026",
    status: "published",
    visibility: "leadership",
    audienceIds: [],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      {
        id: "lrb-g1",
        type: "paragraph",
        html: "Transport was the weak point again. Everything else held together better than last year.",
      },
    ],
    relatedDocumentIds: [],
    links: [],
    relatedText: "Summer Camp 2027",
    tags: ["camp"],
    comments: [],
    activity: [
      {
        id: "lra-g1",
        at: `${YEAR}-08-30`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-08-30`,
    updatedAt: `${YEAR}-08-30`,
  },

  /* A report about something that is not a person. */
  {
    id: "lr-h-progress",
    title: "Progress Report — August",
    reportType: "progress-report",
    authorId: "p-maria",
    subjectText: "The Thursday team",
    reportingPeriod: "August 2026",
    status: "draft",
    visibility: "restricted",
    audienceIds: ["p-joel"],
    discussionPolicy: "viewers",
    contentSource: "native",
    blocks: [
      { id: "lrb-h1", type: "heading-2", html: "Weekly tracking" },
      { id: "lrb-h2", type: "bullet", html: "Week 1 — two gatherings, both led" },
      { id: "lrb-h3", type: "heading-2", html: "Struggles" },
      {
        id: "lrb-h4",
        type: "paragraph",
        html: "Preparation time keeps slipping to the day before.",
      },
    ],
    relatedDocumentIds: [],
    links: [],
    tags: ["development"],
    comments: [],
    activity: [
      {
        id: "lra-h1",
        at: `${YEAR}-09-01`,
        actorId: "p-maria",
        kind: "submitted",
        summary: "created this report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-01`,
    updatedAt: `${YEAR}-09-01`,
  },

  /* Its supporting resource must not appear in anybody else's search. */
  {
    id: "lr-i-confidential",
    title: "Confidential Leadership Assessment",
    reportType: "evaluation",
    authorId: "p-joel",
    subjectId: "p-daniel",
    reportingPeriod: "Q3 2026",
    status: "published",
    visibility: "restricted",
    audienceIds: [],
    discussionPolicy: "disabled",
    contentSource: "native",
    blocks: [{ id: "lrb-i1", type: "paragraph", html: "Held between the two of us." }],
    relatedDocumentIds: ["doc-lr-development-guide"],
    links: [],
    tags: ["leadership-assessment"],
    comments: [],
    activity: [],
    revisions: [],
    createdAt: `${YEAR}-09-03`,
    updatedAt: `${YEAR}-09-03`,
  },

  /* F — content lives in Drive; the report record does not. */
  {
    id: "lr-f-linked",
    title: "Campus Leadership Review — September",
    reportType: "general",
    authorId: "p-joel",
    reportingPeriod: "September 2026",
    status: "published",
    visibility: "leadership",
    audienceIds: [],
    discussionPolicy: "viewers",
    contentSource: "linked-document",
    primaryDocumentId: "doc-lr-campus-review",
    relatedDocumentIds: [],
    links: [],
    tags: ["leadership"],
    comments: [],
    activity: [
      {
        id: "lra-f1",
        at: `${YEAR}-09-04`,
        actorId: "p-joel",
        kind: "artifact",
        summary: "linked a document as the report content",
      },
      {
        id: "lra-f2",
        at: `${YEAR}-09-04`,
        actorId: "p-joel",
        kind: "status",
        summary: "published the report",
      },
    ],
    revisions: [],
    createdAt: `${YEAR}-09-04`,
    updatedAt: `${YEAR}-09-04`,
    publishedAt: `${YEAR}-09-04`,
  },
];

export const leadershipReports: LeadershipReport[] = [
  ...narrativeLeadershipReports,
  ...bulkLeadershipReports,
];

export const reachOutReports: ReachOutReport[] = [
  {
    id: "ror-1",
    title: "Community reach-out and follow-up",
    reportDate: `${YEAR}-09-08`,
    authorId: "p-maria",
    createdAt: `${YEAR}-09-08T21:10:00`,
    updatedAt: `${YEAR}-09-09T08:15:00`,
    content: `We spent some time around Thomson Park this Saturday and spoke with several people. Two of them asked about the Sunday service and took an invitation; one had visited years ago and remembered Bishop Andrew.

Afterwards we visited the Santos family and prayed with them. They have been unwell and were glad of the company more than anything else.

We also followed up with some of the visitors from last Sunday. Not everyone was reachable, but the ones we spoke to were warm.`,
    comments: [
      {
        id: "roc-1",
        authorId: "p-peter",
        at: `${YEAR}-09-09T09:02:00`,
        body: "Thank you. Perhaps we can follow up again next week while it is still fresh.",
      },
      {
        id: "roc-2",
        authorId: "p-maria",
        at: `${YEAR}-09-09T09:40:00`,
        body: "Yes, we'll try to arrange that for Saturday afternoon.",
      },
    ],
  },
  {
    id: "ror-2",
    title: "Reach-out report",
    reportDate: `${YEAR}-09-01`,
    authorId: "p-mark",
    createdAt: `${YEAR}-09-01T20:30:00`,
    updatedAt: `${YEAR}-09-01T20:30:00`,
    content: `Visited the family we spoke with after Sunday's service. They live near the church and had questions about what the midweek gatherings are like. We stayed about an hour.

They may come to a gathering but did not want to commit to a date, so we left it with them.`,
    comments: [],
  },
  {
    id: "ror-3",
    title: "Weekly reach-out",
    reportDate: `${YEAR}-08-24`,
    authorId: "p-maria",
    /* Nathan went out too and added his part later. Neither of them owns it. */
    contributorIds: ["p-nathan"],
    createdAt: `${YEAR}-08-24T19:55:00`,
    updatedAt: `${YEAR}-08-25T08:10:00`,
    content: `Distributed invitations around the neighbourhood on Saturday morning. Four of us went out and covered most of the streets east of the church.

Several people stopped to talk with us. One older gentleman spoke with Nathan for a long while about his family.

Nathan: he asked whether we ever visit people at home. I said we do, and took down where he lives.`,
    comments: [
      {
        id: "roc-3",
        authorId: "p-ruth",
        at: `${YEAR}-08-25T07:20:00`,
        body: "Good to hear. Do we have more invitations printed, or should we arrange another batch?",
      },
    ],
  },
  {
    id: "ror-4",
    title: "Calls this week",
    reportDate: `${YEAR}-08-18`,
    authorId: "p-mark",
    createdAt: `${YEAR}-08-18T22:05:00`,
    updatedAt: `${YEAR}-08-18T22:05:00`,
    content: `Called and encouraged two families this week. Both are going through a difficult season and asked for prayer. Nothing further needed from us for now beyond keeping in touch.`,
    comments: [],
  },
];

const PRIOR = YEAR - 1;
const mm = (month: number) => `${YEAR}-${String(month).padStart(2, "0")}`;
const dd = (month: number, dayOfMonth: number) =>
  `${YEAR}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;

export const goals: Goal[] = [
  {
    id: "gl-training",
    number: 1,
    year: YEAR,
    title: "Training for excellence",
    description:
      "Establish consistency across the serving team so any volunteer can run a service well.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    ownerId: "p-esther",
    status: "active",
    createdAt: dd(1, 12),
    links: [],
  },
  {
    id: "gl-food-cert",
    number: 2,
    year: YEAR,
    title: "Food handling certification",
    description: "Get the serving team certified before the camp season.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    ownerId: "p-esther",
    target: { precision: "month", value: mm(6) },
    status: "completed",
    createdAt: dd(1, 12),
    completedAt: dd(6, 29),
    completionNote: "Six volunteers certified. Certificates filed with the ministry.",
    links: [{ kind: "artifact", id: "art-camp-master", label: "Certification roster" }],
  },
  {
    id: "gl-groupchat",
    number: 3,
    year: YEAR,
    title: "More communication via group chat",
    // No target and no description: the binder often says only this much.
    ministryId: "min-victuals",
    ownerId: "p-esther",
    status: "active",
    createdAt: dd(1, 12),
    links: [],
  },
  {
    id: "gl-outlet",
    number: 4,
    year: YEAR,
    title: "Kitchen electrical outlet",
    description: "Second outlet by the prep counter so two urns can run at once.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    target: { precision: "month", value: mm(5) },
    status: "completed",
    createdAt: dd(1, 12),
    completedAt: dd(5, 21),
    completionNote: "Installed and inspected.",
    links: [],
  },
  {
    id: "gl-fellowship",
    number: 5,
    year: YEAR,
    title: "Team-building fellowship",
    description: "One whole-team gathering away from a serving day.",
    ministryId: "min-victuals",
    ownerId: "p-joel",
    target: { precision: "month", value: mm(7) },
    status: "active",
    createdAt: dd(2, 3),
    links: [{ kind: "schedule-entry", id: "se-potbless" }],
  },
  {
    id: "gl-storage",
    number: 6,
    year: YEAR,
    title: "Reorganize the storage room",
    description: "Label shelving and set a fixed home for every serving item.",
    ministryId: "min-victuals",
    target: { precision: "date", value: dd(9, 30) },
    status: "active",
    createdAt: dd(2, 3),
    links: [],
  },
  {
    id: "gl-procedures",
    number: 7,
    year: YEAR,
    title: "Write down the serving procedure",
    description: "A one-page procedure so a new volunteer can serve without shadowing for a month.",
    ministryId: "min-victuals",
    ownerId: "p-esther",
    status: "active",
    createdAt: dd(2, 3),
    links: [{ kind: "artifact", id: "art-sws-order", label: "Draft procedure" }],
  },
  {
    id: "gl-key-person",
    number: 8,
    year: YEAR,
    title: "Develop a second lead for the ministry",
    description: "Identify and prepare someone who can carry the ministry when needed.",
    ministryId: "min-victuals",
    ownerId: "p-esther",
    status: "on-hold",
    createdAt: dd(2, 3),
    holdSince: mm(5),
    holdReason: "Waiting until the serving team stabilizes after the camp season.",
    links: [],
    // Development of a named person is leadership material, not open reading.
    policy: {
      classification: "leadership-confidential",
      ownerId: "p-esther",
      campusId: "cmp-scarborough",
      audienceGroups: [GROUP_CENTRAL_LEADERSHIP],
      reviewers: ["p-bishop"],
    },
  },
  {
    id: "gl-equipment",
    number: 9,
    year: YEAR,
    title: "Replace the two failing urns",
    ministryId: "min-victuals",
    target: { precision: "month", value: mm(10) },
    status: "active",
    createdAt: dd(3, 15),
    links: [],
  },
  {
    id: "gl-aprons",
    number: 10,
    year: YEAR,
    title: "Ministry aprons for the serving team",
    ministryId: "min-victuals",
    status: "active",
    createdAt: dd(3, 15),
    links: [],
  },
  {
    id: "gl-cleaning",
    number: 11,
    year: YEAR,
    title: "Cleaning guidelines on the wall",
    description: "Printed close-down steps so the last person out knows what to check.",
    ministryId: "min-victuals",
    target: { precision: "month", value: mm(9) },
    status: "active",
    createdAt: dd(3, 15),
    links: [],
  },
  {
    id: "gl-call-time",
    number: 12,
    year: YEAR,
    title: "Improve call time before the service",
    description: "Team in place thirty minutes before the first service, consistently.",
    ministryId: "min-victuals",
    status: "active",
    createdAt: dd(4, 2),
    links: [{ kind: "schedule-entry", id: "se-victuals" }],
  },

  /* Prior year, kept as a historical snapshot. */
  {
    id: "gl-prior-storage",
    number: 7,
    year: PRIOR,
    title: "Reorganize the storage room",
    description: "Started but not finished before the year ended.",
    ministryId: "min-victuals",
    status: "carried-forward",
    createdAt: `${PRIOR}-02-10`,
    links: [],
  },
  {
    id: "gl-prior-rota",
    number: 3,
    year: PRIOR,
    title: "Publish the serving rota a month ahead",
    ministryId: "min-victuals",
    status: "completed",
    createdAt: `${PRIOR}-01-20`,
    completedAt: `${PRIOR}-08-14`,
    completionNote: "Rota has run a month ahead since August.",
    links: [],
  },
];

/* The prior year's unfinished goal became this year's number 6. */
const carried = goals.find((goal) => goal.id === "gl-storage");
if (carried) carried.carriedFromGoalId = "gl-prior-storage";

export const goalUpdates: GoalUpdate[] = [
  {
    id: "gu-cert-1",
    goalId: "gl-food-cert",
    date: dd(5, 12),
    text: "Second Harvest offers the certification free for community groups.",
    authorId: "p-esther",
    kind: "note",
  },
  {
    id: "gu-cert-2",
    goalId: "gl-food-cert",
    date: dd(6, 18),
    text: "Six volunteers registered for the 18 June session.",
    authorId: "p-esther",
    kind: "note",
  },
  {
    id: "gu-cert-3",
    goalId: "gl-food-cert",
    date: dd(6, 29),
    text: "Completed. Certificates filed with the ministry.",
    authorId: "p-esther",
    kind: "completion",
  },
  {
    id: "gu-fellowship-1",
    goalId: "gl-fellowship",
    date: dd(5, 4),
    text: "Two venue options priced. Waiting on the July calendar to settle.",
    authorId: "p-joel",
    kind: "note",
  },
  {
    id: "gu-fellowship-2",
    goalId: "gl-fellowship",
    date: dd(6, 23),
    text: "Agreed to attach the fellowship to the July potbless rather than a separate date.",
    authorId: "p-joel",
    kind: "note",
  },
  {
    id: "gu-outlet-1",
    goalId: "gl-outlet",
    date: dd(4, 30),
    text: "Quotation received from the campus electrician.",
    authorId: "p-esther",
    kind: "note",
  },
  {
    id: "gu-outlet-2",
    goalId: "gl-outlet",
    date: dd(5, 21),
    text: "Installed and inspected.",
    authorId: "p-esther",
    kind: "completion",
  },
  {
    id: "gu-training-1",
    goalId: "gl-training",
    date: dd(3, 8),
    text: "Ran the first walkthrough with four volunteers. Serving order is the weak point.",
    authorId: "p-esther",
    kind: "note",
  },
  {
    id: "gu-key-1",
    goalId: "gl-key-person",
    date: mm(5),
    text: "On hold until the serving team stabilizes after the camp season.",
    authorId: "p-esther",
    kind: "status",
  },
  {
    id: "gu-procedures-1",
    goalId: "gl-procedures",
    date: dd(6, 9),
    text: "First draft written. Needs a review pass with the Sunday team.",
    authorId: "p-esther",
    kind: "note",
  },
  {
    id: "gu-storage-1",
    goalId: "gl-storage",
    date: dd(4, 18),
    text: "Carried over from last year. Shelving measured; labels still to order.",
    authorId: "p-esther",
    kind: "note",
  },
];

/* -------------------------------------------------------------- lifegroup */

/**
 * LifeGroup fixtures.
 *
 * Written to prove the operating model rather than to look tidy. Maria leads at
 * two different venues in consecutive weeks; Juan turns up at SC Church one week
 * and Thomson Park the next; one gathering has ten signups and seven present;
 * Baronia Residence hosts four separate occasions without becoming a group; and
 * one pastoral line sits inside an otherwise ordinary gathering.
 */

/** Thursdays, oldest first, ending with the one coming up. */
const thursdays = (() => {
  const out: string[] = [];
  const d = new Date(today);
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7)); // next Thursday
  for (let i = 5; i >= -1; i -= 1) {
    const t = new Date(d);
    t.setDate(d.getDate() - i * 7);
    out.push(toISO(t));
  }
  return out;
})();

const [thu0, thu1, thu2, thu3, thu4, thu5, thu6] = thursdays as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export const venues: Venue[] = [
  {
    id: "ven-baronia",
    name: "Baronia Residence",
    type: "residence",
    hostId: "p-john",
    campusId: "cmp-scarborough",
    area: "Kennedy & Eglinton",
    address: "Held apart from the name — restricted",
  },
  {
    id: "ven-manse",
    name: "Manse Residence",
    type: "residence",
    hostId: "p-anna",
    campusId: "cmp-scarborough",
    area: "Victoria Park",
  },
  {
    id: "ven-sc-church",
    name: "SC Church",
    type: "church",
    campusId: "cmp-scarborough",
    area: "Kennedy & Eglinton",
  },
  {
    id: "ven-thomson",
    name: "Thomson Park",
    type: "park",
    campusId: "cmp-scarborough",
    area: "Brimley & Ellesmere",
    notes: "Summer months only. Shelter 2 if it rains.",
  },
];

export const venueById = (id: string) => venues.find((venue) => venue.id === id);

/*
 * Leaders move between venues week to week, and venues host whoever is
 * assigned. Neither direction implies ownership.
 */
export const gatherings: Gathering[] = [
  {
    id: "gth-1",
    date: thu0,
    startTime: "20:00",
    venueId: "ven-baronia",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-maria"],
    expectedAttendeeIds: ["p-nathan", "p-anna", "p-juan", "p-jonas"],
    status: "completed",
  },
  {
    id: "gth-2",
    date: thu1,
    startTime: "20:00",
    venueId: "ven-sc-church",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-daniel"],
    expectedAttendeeIds: ["p-juan", "p-peter", "p-esther"],
    status: "completed",
  },
  {
    id: "gth-3",
    date: thu2,
    startTime: "19:30",
    venueId: "ven-thomson",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-daniel", "p-mark"],
    expectedAttendeeIds: ["p-juan", "p-lita", "p-peter"],
    status: "completed",
  },
  {
    id: "gth-4",
    date: thu3,
    startTime: "20:00",
    venueId: "ven-baronia",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-mark"],
    expectedAttendeeIds: ["p-nathan", "p-anna", "p-jonas"],
    status: "completed",
  },
  /* Ten signed up, seven came. Both numbers stay true. */
  {
    id: "gth-5",
    date: thu4,
    startTime: "20:00",
    venueId: "ven-baronia",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-maria", "p-john"],
    expectedAttendeeIds: [
      "p-nathan",
      "p-anna",
      "p-juan",
      "p-jonas",
      "p-lita",
      "p-peter",
      "p-mark",
      "p-esther",
      "p-daniel",
      "p-ruth",
    ],
    status: "completed",
  },
  /* Maria at Manse this Thursday, Baronia the next — occurrence-level. */
  {
    id: "gth-6",
    date: thu5,
    startTime: "20:00",
    venueId: "ven-manse",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-maria", "p-john"],
    expectedAttendeeIds: ["p-juan", "p-anna", "p-peter", "p-nathan"],
    status: "open",
  },
  {
    id: "gth-7",
    date: thu6,
    startTime: "20:00",
    venueId: "ven-baronia",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-maria"],
    expectedAttendeeIds: ["p-nathan", "p-anna", "p-jonas"],
    status: "planned",
  },
  {
    id: "gth-8",
    date: thu6,
    startTime: "19:30",
    venueId: "ven-sc-church",
    campusId: "cmp-scarborough",
    assignedLeaderIds: ["p-daniel"],
    status: "planned",
  },
];

export const gatheringById = (id: string) => gatherings.find((g) => g.id === id);

let att = 0;
const mark = (
  gatheringId: string,
  personId: string,
  status: GatheringAttendance["status"] = "present",
  extra: Partial<GatheringAttendance> = {},
): GatheringAttendance => ({
  id: `att-${(att += 1)}`,
  gatheringId,
  personId,
  status,
  ...extra,
});

export const gatheringAttendance: GatheringAttendance[] = [
  ...["p-maria", "p-nathan", "p-anna", "p-juan"].map((id) =>
    mark("gth-1", id, "present", { expected: id !== "p-maria" }),
  ),
  mark("gth-1", "p-jonas", "absent", { expected: true }),

  /* Juan at SC Church one week... */
  ...["p-daniel", "p-juan", "p-peter"].map((id) =>
    mark("gth-2", id, "present", { expected: id !== "p-daniel" }),
  ),
  mark("gth-2", "p-esther", "excused", { expected: true }),

  /* ...and Thomson Park the next. Nothing about him changes. */
  ...["p-daniel", "p-mark", "p-juan", "p-lita"].map((id) =>
    mark("gth-3", id, "present", { expected: id === "p-juan" || id === "p-lita" }),
  ),
  mark("gth-3", "p-peter", "absent", { expected: true }),

  ...["p-mark", "p-nathan", "p-anna", "p-jonas"].map((id) =>
    mark("gth-4", id, "present", { expected: id !== "p-mark" }),
  ),

  /* Of the ten who signed up, seven came. The two leaders and one walk-in are
     counted apart, so the signup pair stays exactly ten and seven. */
  ...["p-nathan", "p-anna", "p-juan", "p-lita", "p-peter", "p-mark", "p-ruth"].map((id) =>
    mark("gth-5", id, "present", { expected: true }),
  ),
  mark("gth-5", "p-jonas", "absent", { expected: true }),
  mark("gth-5", "p-esther", "absent", { expected: true }),
  mark("gth-5", "p-daniel", "excused", { expected: true }),
  ...["p-maria", "p-john"].map((id) => mark("gth-5", id, "present")),
  {
    id: "att-guest-grace",
    gatheringId: "gth-5",
    name: "Grace",
    status: "present",
    firstTime: true,
  },
];

export const exhortations: Exhortation[] = [
  {
    gatheringId: "gth-5",
    topic: "Faithfulness in Small Things",
    scripture: "Luke 16:10",
    notes:
      "Worked through what faithfulness looks like in ordinary weeks, not only in visible service.",
  },
  {
    gatheringId: "gth-4",
    topic: "Perseverance in Prayer",
    scripture: "Luke 18:1-8",
  },
  /* Topic only. An ordinary report must not require more than this. */
  { gatheringId: "gth-3", topic: "Thanksgiving" },
  {
    gatheringId: "gth-2",
    topic: "The Cost of Following",
    scripture: "Luke 14:25-33",
    givenById: "p-peter",
  },
];

const at = (date: string, time: string) => `${date}T${time}:00`;

export const lifegroupEntries: LifegroupEntry[] = [
  {
    id: "lge-1",
    gatheringId: "gth-5",
    authorId: "p-maria",
    body: "Discussion on consistency in prayer when nothing seems to change.",
    createdAt: at(thu4, "20:40"),
  },
  {
    id: "lge-2",
    gatheringId: "gth-5",
    authorId: "p-john",
    body: "Peter shared a work-related concern and asked the group to pray through the month.",
    category: "concern",
    createdAt: at(thu4, "20:52"),
    personId: "p-peter",
  },
  /* The one line held back. Everything around it stays ordinary. */
  {
    id: "lge-3",
    gatheringId: "gth-5",
    authorId: "p-maria",
    body: "Pastoral follow-up needed for a family matter. Speaking with them privately first.",
    category: "follow-up",
    visibility: "selected-viewers",
    viewerIds: ["p-bishop"],
    createdAt: at(thu4, "21:05"),
  },
  {
    id: "lge-4",
    gatheringId: "gth-5",
    authorId: "p-maria",
    body: "Grace came with Lita and stayed for the meal afterwards.",
    category: "visitor",
    createdAt: at(thu4, "21:10"),
  },
  {
    id: "lge-5",
    gatheringId: "gth-5",
    authorId: "p-john",
    body: "Contact Grace before next Thursday.",
    category: "follow-up",
    createdAt: at(thu4, "21:12"),
    assignedTo: "p-john",
  },

  {
    id: "lge-6",
    gatheringId: "gth-4",
    authorId: "p-mark",
    body: "Jonas came for the first time in a month. Good conversation afterwards.",
    category: "highlight",
    createdAt: at(thu3, "21:00"),
    personId: "p-jonas",
  },
  {
    id: "lge-7",
    gatheringId: "gth-3",
    authorId: "p-daniel",
    body: "Met outdoors; smaller group, longer sharing. Worth repeating while the weather holds.",
    createdAt: at(thu2, "20:55"),
  },
  {
    id: "lge-8",
    gatheringId: "gth-2",
    authorId: "p-daniel",
    body: "Peter gave the exhortation. Confident, and the group responded well.",
    category: "highlight",
    createdAt: at(thu1, "21:02"),
    personId: "p-peter",
  },
  {
    id: "lge-9",
    gatheringId: "gth-1",
    authorId: "p-maria",
    body: "Jonas absent again. I will call this week.",
    category: "concern",
    createdAt: at(thu0, "20:48"),
    personId: "p-jonas",
    assignedTo: "p-maria",
    completed: true,
  },
];

export const gatheringReports: GatheringReport[] = [
  {
    /*
     * The most recent gathering: led last night, summary started, write-up not
     * finished. Deliberately left open — a fixture set in which every record is
     * complete cannot show a leader what unfinished work looks like, and the
     * dashboard's whole job is to show them exactly that.
     */
    gatheringId: "gth-5",
    summary: "Full room and a settled evening. Grace is the one to follow up on.",
  },
  { gatheringId: "gth-4", completedAt: at(thu3, "21:20"), completedById: "p-mark" },
  { gatheringId: "gth-3", completedAt: at(thu2, "21:15"), completedById: "p-daniel" },
  { gatheringId: "gth-2", completedAt: at(thu1, "21:25"), completedById: "p-daniel" },
  { gatheringId: "gth-1", completedAt: at(thu0, "21:05"), completedById: "p-maria" },
];

/* --------------------------------------------------------- meeting notes */

/**
 * Meeting fixtures written as blocks, the way the editor stores them, so the
 * shipped notes exercise the real document model rather than a string blob.
 */

let blk = 0;
const b = (
  type: MeetingNote["blocks"][number]["type"],
  html: string,
  extra: Partial<MeetingNote["blocks"][number]> = {},
) => ({ id: `blk-seed-${(blk += 1)}`, type, html, ...extra });

const narrativeMeetingNotes: MeetingNote[] = [
  {
    id: "mn-1",
    title: "September Leaders Meeting",
    noteType: "minutes",
    date: `${YEAR}-09-08`,
    time: "19:00",
    location: "SC Church · Meeting room",
    type: "leaders",
    facilitatorId: "p-bishop",
    noteTakerId: "p-esther",
    authorId: "p-esther",
    tags: ["leadership", "planning", "camp"],
    participantIds: ["p-bishop", "p-joel", "p-esther"],
    absenteeIds: ["p-ruth"],
    status: "complete",
    /* A general leadership meeting: no ministry context, per §7. */
    links: [{ kind: "schedule-entry", id: "se-ministry-meeting" }],
    createdAt: `${YEAR}-09-08`,
    updatedAt: `${YEAR}-09-08`,
    blocks: [
      b("heading-2", "Opening and updates"),
      b("paragraph", "Camp transport is <strong>18 seats short</strong> for departure day."),
      b("bullet", "Two of three coaches confirmed"),
      b("bullet", "Third coach quoted at $980"),
      b(
        "decision",
        "Hold two coaches; stagger the youth departure only if the third coach is not approved by 19 September.",
      ),
      b("heading-2", "SEED"),
      b("paragraph", "Level 2 dates confirmed for July. Mentorship moved to 21 July."),
      b("follow-up", "Confirm the school gym is available for the October outreach.", {
        state: "open",
      }),
      b("checklist", "Bring printed volunteer forms", { checked: false }),
      b("checklist", "Review previous minutes", { checked: true }),
    ],
  },
  {
    id: "mn-2",
    title: "Mentorship — my notes",
    noteType: "personal",
    date: `${YEAR}-09-01`,
    time: "10:00",
    type: "coaching",
    authorId: "p-maria",
    tags: ["follow-up", "training"],
    participantIds: ["p-esther"],
    status: "complete",
    links: [],
    createdAt: `${YEAR}-09-01`,
    updatedAt: `${YEAR}-09-01`,
    blocks: [
      b("paragraph", "Talked through delegation inside the Lifegroup team."),
      b("decision", "Mark will run a whole gathering unsupported before the end of the quarter."),
    ],
  },
  {
    id: "mn-3",
    title: "August Leaders Meeting",
    noteType: "minutes",
    date: `${YEAR}-08-25`,
    time: "19:00",
    location: "SC Church · Meeting room",
    type: "leaders",
    facilitatorId: "p-bishop",
    noteTakerId: "p-ruth",
    authorId: "p-ruth",
    tags: ["leadership", "budget"],
    participantIds: ["p-bishop", "p-ruth"],
    status: "complete",
    links: [{ kind: "artifact", id: "art-camp-master" }],
    createdAt: `${YEAR}-08-25`,
    updatedAt: `${YEAR}-08-26`,
    blocks: [
      b("paragraph", "Reporting cycle opens Monday."),
      b("bullet", "Campus attendance steady"),
      b("bullet", "Victuals raised the disposable utensil supply again"),
      b("follow-up", "Decide whether utensils move to the central budget.", {
        state: "resolved",
      }),
      b("decision", "Concerns should reach the Bishop before the report rather than inside it."),
    ],
  },
  {
    id: "mn-4",
    title: "Weekly Music Ministry Meeting",
    noteType: "minutes",
    date: `${YEAR}-09-05`,
    time: "18:30",
    location: "SC Church · Music room",
    type: "ministry",
    facilitatorId: "p-maria",
    noteTakerId: "p-nathan",
    authorId: "p-nathan",
    status: "complete",
    tags: ["worship", "planning", "training"],
    participantIds: ["p-maria", "p-nathan", "p-daniel"],
    /* The context is the Music Ministry record itself, never a #music tag. */
    links: [{ kind: "ministry", id: "min-music" }],
    createdAt: `${YEAR}-09-05`,
    updatedAt: `${YEAR}-09-05`,
    blocks: [
      b("heading-2", "Agenda"),
      b("bullet", "September rota"),
      b("bullet", "Training for the newer musicians"),
      b("heading-2", "Discussion"),
      b(
        "paragraph",
        "Saturday practice is working better than Friday for most of the team. Two are still struggling with the earlier start.",
      ),
      b("heading-2", "Decisions"),
      b("decision", "Worship practice stays on Saturday for the rest of the year."),
      b("decision", "Transportation for the camp will be handled separately with Joel."),
      b("heading-2", "Action items"),
      b("checklist", "Maria — confirm musicians for the 20th", { checked: false }),
      b("checklist", "Nathan — prepare the training outline", { checked: false }),
      b("checklist", "Daniel — reserve the music room", { checked: true }),
      b("heading-2", "Follow-up and next meeting"),
      b("follow-up", "Ask whether the newer musicians want a separate session.", {
        state: "open",
      }),
      b("paragraph", "Next meeting: 19 September, same time."),
    ],
  },
];

export const meetingNotes: MeetingNote[] = [...narrativeMeetingNotes, ...bulkMeetingNotes];

export const meetingTasks: MeetingTask[] = [
  {
    id: "mt-1",
    meetingId: "mn-1",
    blockId: "blk-seed-4",
    title: "Contact the coach company about the third coach",
    assigneeId: "p-joel",
    dueDate: `${YEAR}-09-19`,
    status: "open",
    createdAt: `${YEAR}-09-08`,
  },
  {
    id: "mt-2",
    meetingId: "mn-1",
    title: "Send the September rota to the team chat",
    assigneeId: "p-maria",
    status: "done",
    createdAt: `${YEAR}-09-08`,
  },
  {
    id: "mt-3",
    meetingId: "mn-3",
    title: "Price disposable utensils for the quarter",
    assigneeId: "p-esther",
    status: "open",
    createdAt: `${YEAR}-08-25`,
  },
];

/* -------------------------------------------------------------- ministry */

/**
 * Ministry documents across all four origins, so the repository UX exercises
 * the real distinction between a document and a file. Drive and upload are
 * represented, not integrated — see modules/MINISTRY.md.
 */
const narrativeBinderDocuments: BinderDocument[] = [
  {
    id: "md-goals",
    title: `${YEAR} Music Ministry Goals`,
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-maria",
    type: "goals",
    origin: "binder",
    updatedAt: `${YEAR}-09-02`,
    description: "This year's goals and their checklists.",
    permission: "edit",
    pinned: true,
    year: YEAR,
  },
  {
    id: "md-training",
    title: "Worship Team Training Plan",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-maria",
    type: "plan",
    origin: "binder",
    updatedAt: `${YEAR}-09-05`,
    description: "Curriculum and schedule for developing new musicians.",
    permission: "edit",
    related: [{ kind: "artifact", id: "art-sws-order", label: "Order of service" }],
    year: YEAR,
  },
  {
    id: "md-update",
    title: "September Ministry Update",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-maria",
    type: "update",
    origin: "binder",
    updatedAt: `${YEAR}-09-03`,
    permission: "edit",
    year: YEAR,
  },
  {
    id: "md-schedule",
    title: "Sunday Worship Schedule",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-daniel",
    type: "spreadsheet",
    origin: "drive",
    updatedAt: `${YEAR}-08-30`,
    url: "https://docs.google.com/spreadsheets/d/example-worship-rota",
    permission: "edit",
    year: YEAR,
  },
  {
    id: "md-christmas",
    title: "Christmas Presentation Plan",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-nathan",
    type: "plan",
    origin: "drive",
    updatedAt: `${YEAR}-08-27`,
    url: "https://docs.google.com/document/d/example-christmas-plan",
    permission: "view",
    year: YEAR,
  },
  {
    id: "md-consent",
    title: "Volunteer Consent Form",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-maria",
    type: "form",
    origin: "file",
    updatedAt: `${YEAR}-07-14`,
    fileName: "volunteer-consent.pdf",
    fileSize: "184 KB",
    permission: "view",
    year: YEAR,
  },
  {
    id: "md-vocal",
    title: "Vocal Training Resources",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-nathan",
    type: "link",
    origin: "link",
    updatedAt: `${YEAR}-06-02`,
    url: "https://example.org/vocal-training",
    description: "External resource. Save a copy if it must be kept.",
    permission: "view",
  },
  {
    id: "md-announce",
    title: "Rehearsal moved to Saturday",
    owner: { kind: "ministry", ministryId: "min-music" },
    preparedById: "p-maria",
    type: "announcement",
    origin: "binder",
    updatedAt: `${YEAR}-09-09`,
    description: "Worship rehearsal moves to Saturday 10 AM for the rest of September.",
    permission: "edit",
    year: YEAR,
  },

  /* Victuals — where Maria participates rather than leads. */
  {
    id: "md-vic-checklist",
    title: "Victuals Weekly Checklist",
    owner: { kind: "ministry", ministryId: "min-victuals" },
    preparedById: "p-esther",
    type: "checklist",
    origin: "binder",
    updatedAt: `${YEAR}-09-08`,
    permission: "edit",
    year: YEAR,
  },
  {
    id: "md-vic-safety",
    title: "Food Safety Guidelines",
    owner: { kind: "ministry", ministryId: "min-victuals" },
    preparedById: "p-esther",
    type: "document",
    origin: "file",
    updatedAt: `${YEAR}-05-19`,
    fileName: "food-safety.pdf",
    fileSize: "512 KB",
    permission: "view",
  },

  /* Transportation — shared with Maria, who is not a member. */
  {
    id: "md-tr-plan",
    title: "Camp Transport Plan",
    owner: { kind: "ministry", ministryId: "min-transport" },
    preparedById: "p-joel",
    type: "plan",
    origin: "drive",
    updatedAt: `${YEAR}-09-07`,
    url: "https://docs.google.com/spreadsheets/d/example-camp-transport",
    permission: "view",
    related: [{ kind: "work", id: "w-camp-transport", label: "Departure-day transport" }],
    year: YEAR,
  },

  /*
   * Reach-Out's working materials. The same records as a ministry's, owned by
   * the section rather than by a ministry, and belonging to no single report.
   */
  {
    id: "doc-ro-planning",
    title: "Community Outreach Planning",
    owner: { kind: "reach-out" },
    preparedById: "p-maria",
    type: "plan",
    origin: "binder",
    description: "Streets covered, who is going out, and what we are handing over.",
    updatedAt: `${YEAR}-09-07`,
    pinned: true,
  },
  {
    id: "doc-ro-notes",
    title: "Reach-Out Contact Notes",
    owner: { kind: "reach-out" },
    preparedById: "p-mark",
    type: "document",
    origin: "binder",
    updatedAt: `${YEAR}-08-30`,
  },
  {
    id: "doc-ro-distribution",
    title: "Invitation Distribution Plan",
    owner: { kind: "reach-out" },
    preparedById: "p-ruth",
    type: "spreadsheet",
    origin: "drive",
    url: "https://docs.google.com/spreadsheets/d/example-invitations",
    updatedAt: `${YEAR}-08-22`,
  },
  {
    id: "doc-ro-reference",
    title: "Outreach Reference Material",
    owner: { kind: "reach-out" },
    preparedById: "p-maria",
    type: "file",
    origin: "file",
    fileName: "outreach-reference.pdf",
    fileSize: "1.2 MB",
    updatedAt: `${YEAR}-07-19`,
  },
  {
    id: "doc-ro-training",
    title: "Personal Evangelism Training",
    owner: { kind: "reach-out" },
    preparedById: "p-peter",
    type: "link",
    origin: "link",
    url: "https://example.org/personal-evangelism",
    updatedAt: `${YEAR}-06-11`,
  },

  /*
   * Owned by Leadership Reports itself. The first is the authoritative content
   * of a linked-document report — the report record still holds its own title,
   * author, period, access and discussion.
   */
  {
    id: "doc-lr-campus-review",
    title: "Campus Leadership Review — September",
    owner: { kind: "leadership-report" },
    preparedById: "p-joel",
    type: "document",
    origin: "drive",
    url: "https://docs.google.com/document/d/example-campus-review",
    updatedAt: `${YEAR}-09-04`,
  },
  {
    id: "doc-lr-development-guide",
    title: "Leadership Development Guide",
    owner: { kind: "leadership-report" },
    preparedById: "p-bishop",
    type: "document",
    origin: "file",
    fileName: "development-guide.pdf",
    fileSize: "820 KB",
    updatedAt: `${YEAR}-07-02`,
  },

  /*
   * Resources that exercise the search acceptance scenarios: a LifeGroup
   * occurrence rather than a standing group, a Reach-Out reference that must
   * never read as a ministry, and a resource whose only route in is a report
   * most people cannot discover.
   */
  {
    id: "doc-lg-thomson-notes",
    title: "Thomson Park Gathering Notes",
    owner: { kind: "lifegroup", gatheringId: "gth-3" },
    preparedById: "p-daniel",
    type: "document",
    origin: "binder",
    description: "Notes and reference material from the outdoor gathering at Thomson Park.",
    updatedAt: `${YEAR}-08-21`,
  },
  {
    id: "doc-ro-tracker",
    title: "Reach-Out Follow-up Tracker",
    owner: { kind: "reach-out" },
    preparedById: "p-mark",
    type: "spreadsheet",
    origin: "drive",
    url: "https://docs.google.com/spreadsheets/d/example-reachout-tracker",
    description: "Shared reference used to coordinate and follow up current Reach-Out efforts.",
    updatedAt: `${YEAR}-09-07`,
  },
];

export const binderDocuments: BinderDocument[] = [
  ...narrativeBinderDocuments,
  ...bulkBinderDocuments,
];

export const ministryActivity: MinistryActivity[] = [
  {
    id: "ma-1",
    ministryId: "min-music",
    at: `${YEAR}-09-09`,
    actorId: "p-maria",
    summary: "posted an announcement about Saturday rehearsal",
  },
  {
    id: "ma-2",
    ministryId: "min-music",
    at: `${YEAR}-09-05`,
    actorId: "p-maria",
    summary: "updated the Worship Team Training Plan",
  },
  {
    id: "ma-3",
    ministryId: "min-music",
    at: `${YEAR}-08-30`,
    actorId: "p-daniel",
    summary: "added the Sunday Worship Schedule from Drive",
  },
  {
    id: "ma-4",
    ministryId: "min-victuals",
    at: `${YEAR}-09-08`,
    actorId: "p-esther",
    summary: "completed the weekly checklist",
  },
];
