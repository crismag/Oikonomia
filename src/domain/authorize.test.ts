import { describe, expect, it } from "vitest";

import {
  canAmendGathering,
  canAssignGatheringLeaders,
  canComment,
  canEdit,
  canReview,
  canScheduleGathering,
  canView,
  permissionsFor,
} from "./authorize";
import { viewerFor } from "@/test/viewer";
import { leadershipReports, ministries } from "@/test/fixtures";

const ministryById = (id: string) => ministries.find((m) => m.id === id)!;
import type { Gathering, Goal, LifegroupEntry, MeetingNote, ScheduleEntry } from "./types";

/**
 * The authorization seam.
 *
 * Two things are being guarded. First, that the seam **delegates** rather than
 * inventing a second, divergent set of rules — the interesting cases are
 * asserted against the domain's own behaviour. Second, that every answer it
 * gives on its own is conservative, because §35 says a route existing is not a
 * reason to expose a record.
 *
 * > These tests describe the MVP's behaviour. They are **not** evidence that
 * > the permission model is sufficient for confidential records — identity is
 * > asserted rather than verified, and `docs/architecture/identity-and-access.md` lists
 * > what that leaves undone.
 */

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");

const report = (id: string) => leadershipReports.find((r) => r.id === id)!;
const ministry = (id: string) => ministries.find((m) => m.id === id)!;

describe("leadership reports delegate to the report's own rules", () => {
  const privateDraft = { kind: "leadership-report", report: report("lr-a-private") } as const;

  it("lets the author read and edit their own draft", () => {
    expect(canView(maria, privateDraft)).toBe(true);
    expect(canEdit(maria, privateDraft)).toBe(true);
  });

  it("keeps a private draft from everyone else, seniority included", () => {
    for (const viewer of [joel, bishop, admin]) {
      expect(canView(viewer, privateDraft)).toBe(false);
      expect(canEdit(viewer, privateDraft)).toBe(false);
    }
  });

  /* Discussion policy is the report's decision, not the seam's. */
  it("honours a report that has discussion switched off", () => {
    expect(canComment(maria, privateDraft)).toBe(false);
  });

  it("does not let anyone review, because no reviewer is assigned yet", () => {
    expect(canReview(maria, privateDraft)).toBe(false);
    expect(canReview(bishop, privateDraft)).toBe(false);
  });
});

describe("ministries", () => {
  const music = { kind: "ministry", ministry: ministry("min-music") } as const;
  const transport = { kind: "ministry", ministry: ministry("min-transport") } as const;

  it("lets the lead manage the ministry", () => {
    const lead = viewerFor("leader");
    const led = ministries.find((m) => m.leadId === lead.person.id);
    if (led) expect(canEdit(lead, { kind: "ministry", ministry: led })).toBe(true);
  });

  it("does not let a participant manage it", () => {
    const victuals = ministry("min-victuals");
    expect(canEdit(maria, { kind: "ministry", ministry: victuals })).toBe(false);
    expect(canComment(maria, { kind: "ministry", ministry: victuals })).toBe(true);
  });

  /** Being able to see that a ministry exists is not access to its work. */
  it("separates seeing a ministry from contributing to it", () => {
    expect(canView(maria, transport)).toBe(true);
    expect(canComment(maria, transport)).toBe(false);
  });

  it("does not treat shared-with as membership", () => {
    expect(canEdit(maria, transport)).toBe(false);
    expect(canEdit(maria, music)).toBe(true);
  });
});

describe("meeting notes stay with the person who wrote them", () => {
  const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
    id: "mn-1",
    title: "Leaders Meeting",
    noteType: "personal",
    date: "2026-09-08",
    participantIds: [],
    blocks: [],
    status: "complete",
    tags: [],
    links: [],
    createdAt: "2026-09-08",
    updatedAt: "2026-09-08",
    ...over,
  });

  it("lets the author read and edit their personal note", () => {
    const subject = { kind: "meeting-note", note: note({ authorId: maria.person.id }) } as const;
    expect(canView(maria, subject)).toBe(true);
    expect(canEdit(maria, subject)).toBe(true);
  });

  it("keeps a personal note from a participant who did not write it", () => {
    const subject = {
      kind: "meeting-note",
      note: note({ authorId: joel.person.id, participantIds: [maria.person.id] }),
    } as const;
    expect(canView(maria, subject)).toBe(false);
  });

  /** Minutes are written to be the meeting's record for the people who were there. */
  it("lets a participant read minutes but not edit them", () => {
    const subject = {
      kind: "meeting-note",
      note: note({
        noteType: "minutes",
        noteTakerId: joel.person.id,
        participantIds: [maria.person.id],
      }),
    } as const;
    expect(canView(maria, subject)).toBe(true);
    expect(canEdit(maria, subject)).toBe(false);
  });

  it("keeps minutes from someone who was not at the meeting", () => {
    const subject = {
      kind: "meeting-note",
      note: note({ noteType: "minutes", noteTakerId: joel.person.id, participantIds: [] }),
    } as const;
    expect(canView(bishop, subject)).toBe(false);
  });

  it("offers no commenting, because sharing is not implemented yet", () => {
    const subject = { kind: "meeting-note", note: note({ authorId: maria.person.id }) } as const;
    expect(canComment(maria, subject)).toBe(false);
  });
});

describe("gatherings are led for one occasion", () => {
  const gathering = (leaders: string[]): Gathering => ({
    id: "g-1",
    date: "2026-09-06",
    venueId: "v-1",
    assignedLeaderIds: leaders,
    status: "planned",
  });

  it("lets an assigned leader record the gathering", () => {
    const subject = { kind: "gathering", gathering: gathering([maria.person.id]) } as const;
    expect(canEdit(maria, subject)).toBe(true);
  });

  /* No standing membership exists to inherit the right from. */
  it("does not let a leader who was not assigned record it", () => {
    const subject = { kind: "gathering", gathering: gathering([joel.person.id]) } as const;
    expect(canEdit(maria, subject)).toBe(false);
    expect(canView(maria, subject)).toBe(true);
  });
});

describe("scheduling, amending and recording are three different rights", () => {
  const gathering = (leaders: string[]): Gathering => ({
    id: "g-1",
    date: "2026-10-01",
    venueId: "ven-thomson",
    assignedLeaderIds: leaders,
    status: "planned",
  });

  /* LifeGroup work is not handed down: a leader puts their own on the calendar. */
  it("lets any leader schedule a gathering", () => {
    for (const viewer of [maria, joel, bishop, admin]) {
      expect(canScheduleGathering(viewer)).toBe(true);
    }
  });

  it("lets only campus oversight assign somebody else", () => {
    expect(canAssignGatheringLeaders(bishop)).toBe(true);
    expect(canAssignGatheringLeaders(maria)).toBe(false);
    expect(canAssignGatheringLeaders(joel)).toBe(false);
  });

  /** Administration manages structure; it is not campus responsibility. */
  it("does not treat administration as campus oversight", () => {
    expect(canAssignGatheringLeaders(admin)).toBe(false);
  });

  it("lets the assigned leader move their own gathering", () => {
    expect(canAmendGathering(maria, gathering([maria.person.id]))).toBe(true);
  });

  it("lets campus oversight move a gathering they do not lead", () => {
    expect(canAmendGathering(bishop, gathering([maria.person.id]))).toBe(true);
  });

  it("does not let an unrelated leader move it", () => {
    expect(canAmendGathering(joel, gathering([maria.person.id]))).toBe(false);
  });

  /**
   * The separation that matters. A campus overseer may move a gathering and
   * may not mark its attendance, because they were not at it — recording is
   * the account of the leader who was.
   */
  it("never lets oversight record a gathering it did not lead", () => {
    const subject = { kind: "gathering", gathering: gathering([maria.person.id]) } as const;
    expect(canAmendGathering(bishop, subject.gathering)).toBe(true);
    expect(canEdit(bishop, subject)).toBe(false);
  });
});

describe("lifegroup entries delegate to entry visibility", () => {
  const entry = (over: Partial<LifegroupEntry> = {}): LifegroupEntry => ({
    id: "le-1",
    gatheringId: "g-1",
    authorId: joel.person.id,
    category: "prayer",
    body: "…",
    createdAt: "2026-09-06",
    ...over,
  });
  const gathering: Gathering = {
    id: "g-1",
    date: "2026-09-06",
    venueId: "v-1",
    assignedLeaderIds: [joel.person.id],
    status: "completed",
  };

  it("keeps a private entry from every other leader", () => {
    const subject = {
      kind: "lifegroup-entry",
      entry: entry({ visibility: "private" }),
      gathering,
      isLeader: true,
    } as const;
    expect(canView(maria, subject)).toBe(false);
  });

  it("shows a leaders-visible entry to a leader", () => {
    const subject = {
      kind: "lifegroup-entry",
      entry: entry({ visibility: "leaders" }),
      gathering,
      isLeader: true,
    } as const;
    expect(canView(maria, subject)).toBe(true);
  });

  it("never lets one leader edit another's entry", () => {
    const subject = {
      kind: "lifegroup-entry",
      entry: entry({ visibility: "leaders" }),
      gathering,
      isLeader: true,
    } as const;
    expect(canEdit(maria, subject)).toBe(false);
  });
});

describe("the calendar is shared working information", () => {
  const entry = (over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
    id: "se-1",
    title: "Ministry meeting",
    date: "2026-09-10",
    category: "ministry-meeting",
    ...over,
  });

  it("lets a leader edit what they created", () => {
    const subject = {
      kind: "schedule-entry",
      entry: entry({ createdBy: maria.person.id }),
    } as const;
    expect(canEdit(maria, subject)).toBe(true);
  });

  it("lets a leader edit their own ministry's entries", () => {
    const subject = { kind: "schedule-entry", entry: entry({ ministryId: "min-music" }) } as const;
    expect(canEdit(maria, subject)).toBe(true);
  });

  /** A church-wide rhythm is not one leader's to change. */
  it("does not let a leader edit a church-wide entry", () => {
    const subject = {
      kind: "schedule-entry",
      entry: entry({ source: "church", ministryId: "min-music" }),
    } as const;
    expect(canEdit(maria, subject)).toBe(false);
    expect(canView(maria, subject)).toBe(true);
  });
});

describe("goals", () => {
  const goal = (over: Partial<Goal> = {}): Goal => ({
    id: "goal-1",
    number: 1,
    year: 2026,
    title: "Training for excellence",
    scope: "ministry",
    status: "active",
    createdAt: "2026-01-06",
    links: [],
    ...over,
  });

  it("lets the ministry's lead edit its goal", () => {
    expect(
      canEdit(maria, {
        kind: "goal",
        goal: goal({ ministryId: "min-music" }),
        ministry: ministryById("min-music"),
      }),
    ).toBe(true);
  });

  /**
   * The bug this guards. Maria serves in Victuals — the Ministry page says so —
   * but her `person.ministryIds` does not list it, because membership is
   * recorded on the ministry's `teamIds`. Asking the wrong side told her she
   * could not annotate a goal in a ministry she works in.
   */
  it("lets someone who serves in the ministry edit its goal", () => {
    expect(
      canEdit(maria, {
        kind: "goal",
        goal: goal({ ministryId: "min-victuals" }),
        ministry: ministryById("min-victuals"),
      }),
    ).toBe(true);
  });

  it("does not let someone outside the ministry edit it", () => {
    expect(
      canEdit(maria, {
        kind: "goal",
        goal: goal({ ministryId: "min-transport" }),
        ministry: ministryById("min-transport"),
      }),
    ).toBe(false);
  });

  /** A goal shared with you is not a goal you work on. */
  it("does not treat shared-with as working in the ministry", () => {
    const shared = {
      kind: "goal",
      goal: goal({ ministryId: "min-transport" }),
      ministry: ministryById("min-transport"),
    } as const;
    expect(canView(maria, shared)).toBe(true);
    expect(canEdit(maria, shared)).toBe(false);
  });

  it("lets only its owner edit a personal goal", () => {
    const personal = goal({ scope: "personal", ownerId: maria.person.id });
    expect(canEdit(maria, { kind: "goal", goal: personal })).toBe(true);
    expect(canEdit(maria, { kind: "goal", goal: { ...personal, ownerId: "p-somebody" } })).toBe(
      false,
    );
  });

  /** Relating to a ministry does not hand a leader's own goal to the ministry. */
  it("does not let a ministry's people edit a personal goal that relates to it", () => {
    const personal = goal({ scope: "personal", ownerId: "p-somebody", ministryId: "min-music" });
    expect(
      canEdit(maria, { kind: "goal", goal: personal, ministry: ministryById("min-music") }),
    ).toBe(false);
  });

  it("lets a group's members edit its goal, and nobody else", () => {
    const groupGoal = goal({ scope: "other", groupId: "grp-1" });
    const group = {
      id: "grp-1",
      name: "Elders",
      description: "",
      leadershipAudience: false,
      active: true,
      memberIds: [maria.person.id],
      groupType: "team",
    };
    expect(canEdit(maria, { kind: "goal", goal: groupGoal, group })).toBe(true);
    expect(
      canEdit(maria, { kind: "goal", goal: groupGoal, group: { ...group, memberIds: [] } }),
    ).toBe(false);
    expect(canEdit(maria, { kind: "goal", goal: groupGoal })).toBe(false);
  });
});

describe("the shape of an answer", () => {
  it("always answers all four questions", () => {
    const permissions = permissionsFor(maria, {
      kind: "ministry",
      ministry: ministry("min-music"),
    });
    expect(Object.keys(permissions).sort()).toEqual(["comment", "edit", "review", "view"]);
  });

  /**
   * The conservative default. A subject kind nobody has thought about yet must
   * deny, not wave through — adding a record type should require a decision.
   */
  it("denies a subject kind it does not know", () => {
    const unknown = { kind: "budget-line", id: "b-1" } as unknown as Parameters<
      typeof permissionsFor
    >[1];
    expect(permissionsFor(maria, unknown)).toEqual({
      view: false,
      edit: false,
      comment: false,
      review: false,
    });
  });

  it("grants review nowhere, because reviewer assignment is not modelled yet", () => {
    const subjects = [
      { kind: "ministry", ministry: ministry("min-music") },
      { kind: "leadership-report", report: report("lr-a-private") },
    ] as const;
    for (const subject of subjects) {
      for (const viewer of [maria, joel, bishop, admin]) {
        expect(canReview(viewer, subject)).toBe(false);
      }
    }
  });
});
