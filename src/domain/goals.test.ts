import { describe, expect, it } from "vitest";

import { resolveAccess } from "./access";
import { personById, personaById } from "@/test/fixtures";
import {
  formatTarget,
  formatTargetShort,
  goalCounts,
  goalYears,
  goalsByWhose,
  goalsForYear,
  latestUpdate,
  needsAttention,
  nextGoalNumber,
  reportableFromGoals,
  targetState,
  updatesFor,
} from "./goals";
import type { Goal, GoalUpdate, PersonaId } from "./types";

/**
 * Goal behaviour.
 *
 * The binder's value is the annual record: which year a goal belongs to, what
 * happened to it, and whether a past year still reads truthfully afterwards.
 * These cases guard that, and guard against percentage-style progress creeping
 * back in through a target that means more than it should.
 */

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1",
  number: 1,
  year: 2026,
  title: "Improve storage",
  status: "active",
  createdAt: "2026-01-10",
  links: [],
  ...over,
});

describe("annual grouping", () => {
  const goals = [
    goal({ id: "a", year: 2026, number: 2 }),
    goal({ id: "b", year: 2026, number: 1 }),
    goal({ id: "c", year: 2025, number: 1 }),
  ];

  it("returns only the requested year, in binder order", () => {
    expect(goalsForYear(goals, 2026).map((g) => g.id)).toEqual(["b", "a"]);
  });

  it("keeps earlier years available as history", () => {
    expect(goalsForYear(goals, 2025).map((g) => g.id)).toEqual(["c"]);
  });

  it("lists years newest first", () => {
    expect(goalYears(goals)).toEqual([2026, 2025]);
  });

  it("continues the annual numbering rather than restarting", () => {
    expect(nextGoalNumber(goals, 2026)).toBe(3);
    expect(nextGoalNumber(goals, 2025)).toBe(2);
  });

  it("starts a fresh year at one", () => {
    expect(nextGoalNumber(goals, 2027)).toBe(1);
  });
});

describe("targets", () => {
  it("renders a month target as a month, never a made-up day", () => {
    const formatted = formatTarget({ precision: "month", value: "2026-06" });
    expect(formatted).toBe("June 2026");
    expect(formatted).not.toMatch(/\d+\s+June/);
  });

  it("renders a date target with its day", () => {
    expect(formatTarget({ precision: "date", value: "2026-09-30" })).toBe("30 September 2026");
  });

  it("has no target text when none was set", () => {
    expect(formatTarget(undefined)).toBeUndefined();
    expect(formatTargetShort(undefined)).toBeUndefined();
  });

  it("treats a month target as met any time up to its last day", () => {
    const g = goal({ target: { precision: "month", value: "2026-06" } });
    expect(targetState(g, new Date(2026, 5, 30))).toBe("approaching");
    expect(targetState(g, new Date(2026, 6, 1))).toBe("passed");
  });

  it("warns only within thirty days", () => {
    const g = goal({ target: { precision: "date", value: "2026-09-30" } });
    expect(targetState(g, new Date(2026, 8, 20))).toBe("approaching");
    expect(targetState(g, new Date(2026, 6, 1))).toBe("ok");
  });

  it("never calls a completed or held goal late", () => {
    const target = { precision: "month", value: "2026-01" } as const;
    expect(targetState(goal({ target, status: "completed" }), new Date(2026, 11, 1))).toBe("none");
    expect(targetState(goal({ target, status: "on-hold" }), new Date(2026, 11, 1))).toBe("none");
  });

  it("surfaces approaching and passed targets, soonest first", () => {
    const goals = [
      goal({ id: "late", target: { precision: "month", value: "2026-05" } }),
      goal({ id: "soon", target: { precision: "month", value: "2026-09" } }),
      goal({ id: "far", target: { precision: "month", value: "2026-12" } }),
      goal({ id: "none" }),
    ];
    expect(needsAttention(goals, new Date(2026, 8, 10)).map((g) => g.id)).toEqual(["late", "soon"]);
  });
});

describe("updates", () => {
  const updates: GoalUpdate[] = [
    { id: "u1", goalId: "g1", date: "2026-05-12", text: "First", kind: "note" },
    { id: "u2", goalId: "g1", date: "2026-06-18", text: "Second", kind: "note" },
    { id: "u3", goalId: "other", date: "2026-06-20", text: "Elsewhere", kind: "note" },
  ];

  it("returns a goal's own updates, newest first", () => {
    expect(updatesFor(updates, "g1").map((u) => u.id)).toEqual(["u2", "u1"]);
  });

  it("never mixes in another goal's updates", () => {
    expect(updatesFor(updates, "g1").some((u) => u.goalId !== "g1")).toBe(false);
  });

  it("reports the most recent as the latest", () => {
    expect(latestUpdate(updates, "g1")?.id).toBe("u2");
  });

  it("has no latest when nothing has been written", () => {
    expect(latestUpdate(updates, "empty")).toBeUndefined();
  });
});

describe("counts", () => {
  it("counts each status separately", () => {
    const counts = goalCounts([
      goal({ id: "a", status: "active" }),
      goal({ id: "b", status: "completed" }),
      goal({ id: "c", status: "on-hold" }),
      goal({ id: "d", status: "carried-forward" }),
    ]);
    expect(counts).toEqual({ total: 4, active: 1, completed: 1, onHold: 1, carried: 1 });
  });
});

describe("reportable material", () => {
  const goals = [
    goal({
      id: "done",
      number: 2,
      title: "Food handling certification",
      status: "completed",
      completedAt: "2026-06-29",
      ministryId: "min-victuals",
    }),
    goal({
      id: "held",
      number: 8,
      title: "Develop a second lead",
      status: "on-hold",
      holdSince: "2026-05",
      holdReason: "staffing",
    }),
    goal({ id: "active", number: 5, title: "Team fellowship" }),
  ];

  const updates: GoalUpdate[] = [
    { id: "u1", goalId: "active", date: "2026-06-23", text: "Venue agreed", kind: "note" },
    { id: "u2", goalId: "done", date: "2026-06-29", text: "Completed.", kind: "completion" },
  ];

  const items = reportableFromGoals(goals, updates);

  it("offers a completion as reportable", () => {
    const done = items.find((i) => i.emphasis === "completed");
    expect(done?.text).toBe("Food handling certification completed");
    expect(done?.source.label).toBe("Goal 02");
  });

  it("offers a hold, with its reason", () => {
    const held = items.find((i) => i.emphasis === "on-hold");
    expect(held?.text).toContain("placed on hold");
    expect(held?.text).toContain("staffing");
  });

  it("offers ordinary progress notes", () => {
    const progress = items.filter((i) => i.emphasis === "progress");
    expect(progress.map((i) => i.text)).toContain("Team fellowship: Venue agreed");
  });

  it("does not double-count a completion that also has an update", () => {
    expect(items.filter((i) => i.source.id === "done")).toHaveLength(1);
  });

  it("carries ministry context through for report scoping", () => {
    expect(items.find((i) => i.source.id === "done")?.ministryId).toBe("min-victuals");
  });

  it("orders newest first", () => {
    const dates = items.map((i) => i.date);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });
});

describe("access", () => {
  const level = (personaId: PersonaId, g: Goal) => {
    if (!g.policy) return "full";
    const persona = personaById(personaId);
    return resolveAccess(persona, personById(persona.personId), g.policy).level;
  };

  const confidential = goal({
    id: "dev",
    title: "Develop a second lead",
    policy: {
      classification: "leadership-confidential",
      ownerId: "p-esther",
      campusId: "cmp-scarborough",
      reviewers: ["p-bishop"],
    },
  });

  it("leaves an ordinary goal open", () => {
    expect(level("leader", goal())).toBe("full");
  });

  it("closes a person-development goal to an unrelated leader", () => {
    expect(level("leader", confidential)).toBe("metadata");
  });

  it("does not open it to administration", () => {
    expect(level("admin", confidential)).toBe("metadata");
  });

  it("opens it to the reviewer it was shared with", () => {
    expect(level("bishop", confidential)).toBe("full");
  });
});

/**
 * A leader's goals are theirs. On the page where reports arrive they must stay
 * grouped by whose they are, never pooled into one list of everybody's goals.
 */
describe("goalsByWhose", () => {
  const people = [
    { id: "me" },
    { id: "ana", reportsToId: "me" },
    { id: "ben", reportsToId: "me" },
    { id: "cy", reportsToId: "someone-else" },
  ];
  const ministries = [
    { id: "m-mine", leadId: "me", teamIds: [] },
    { id: "m-ana", leadId: "ana", teamIds: [] },
    { id: "m-other", leadId: "cy", teamIds: [] },
  ];
  const goals = [
    goal({ id: "ana-1", ownerId: "ana" }),
    goal({ id: "ana-2", ownerId: "ana", number: 2 }),
    goal({ id: "cy-1", ownerId: "cy" }),
    goal({ id: "mine-min", ministryId: "m-mine" }),
    goal({ id: "ana-min", ministryId: "m-ana", ownerId: "ana", number: 3 }),
    goal({ id: "ana-ministry-own", ministryId: "m-ana", number: 4 }),
    goal({ id: "other-min", ministryId: "m-other" }),
    goal({ id: "church", number: 9 }),
    goal({ id: "old", ownerId: "ana", year: 2025 }),
  ];
  const grouped = goalsByWhose(goals, { year: 2026, viewerId: "me", people, ministries });

  it("keeps every goal a report owns under that person, and omits people with none", () => {
    expect(grouped.people.map((g) => [g.personId, g.goals.map((x) => x.id)])).toEqual([
      ["ana", ["ana-1", "ana-2", "ana-min"]],
    ]);
  });

  it("does not list goals of people who report to somebody else", () => {
    expect(grouped.people.flatMap((g) => g.goals).map((g) => g.id)).not.toContain("cy-1");
  });

  it("puts only a ministry's own, unowned goals under the ministry", () => {
    expect(grouped.ministries.map((m) => [m.ministryId, m.goals.map((g) => g.id)])).toEqual([
      ["m-mine", ["mine-min"]],
      ["m-ana", ["ana-ministry-own"]],
    ]);
  });

  /* The data this came from: a leader's personal goals filed under the
     ministry they serve. Pooled by ministry they became one incoherent list. */
  it("never pools different leaders' goals under the ministry they relate to", () => {
    const owners = grouped.ministries.flatMap((m) => m.goals).map((g) => g.ownerId);
    expect(owners.every((owner) => owner === undefined)).toBe(true);
  });

  it("keeps shared goals apart, and only this year's", () => {
    expect(grouped.shared.map((g) => g.id)).toEqual(["church"]);
    expect(JSON.stringify(grouped)).not.toContain('"old"');
  });
});
