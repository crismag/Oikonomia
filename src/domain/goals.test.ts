import { describe, expect, it } from "vitest";

import { resolveAccess } from "./access";
import { personById, personaById } from "@/test/fixtures";
import {
  formatTarget,
  formatTargetShort,
  goalCounts,
  goalYears,
  goalsByWhose,
  goalsForMyWork,
  ministryGoals,
  personalGoalsRelatingTo,
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
  scope: "personal",
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
 * Goals are kept apart by whose they are — by their stated scope, never by
 * which fields happen to be filled in. A personal goal that relates to a
 * ministry is still the leader's, and a ministry goal with a leader
 * responsible for it is still the ministry's.
 */
describe("grouping goals by whose they are", () => {
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
  const groups = [
    { id: "g-elders", memberIds: ["me"] },
    { id: "g-far", memberIds: ["cy"] },
  ];
  const goals = [
    goal({ id: "mine-1", scope: "personal", ownerId: "me" }),
    goal({ id: "ana-1", scope: "personal", ownerId: "ana" }),
    goal({ id: "ana-2", scope: "personal", ownerId: "ana", number: 2, ministryId: "m-ana" }),
    goal({ id: "cy-1", scope: "personal", ownerId: "cy" }),
    goal({ id: "m-mine-1", scope: "ministry", ministryId: "m-mine", ownerId: "me" }),
    goal({ id: "m-ana-1", scope: "ministry", ministryId: "m-ana", ownerId: "ana", number: 3 }),
    goal({ id: "m-other-1", scope: "ministry", ministryId: "m-other" }),
    goal({ id: "elders-1", scope: "other", groupId: "g-elders" }),
    goal({ id: "far-1", scope: "other", groupId: "g-far" }),
    goal({ id: "old", scope: "personal", ownerId: "ana", year: 2025 }),
  ];
  const context = { year: 2026, viewerId: "me", people, ministries, groups };
  const ids = (list: { goals: Goal[] }[]) => list.map((g) => g.goals.map((x) => x.id));

  describe("for Reports to you", () => {
    const grouped = goalsByWhose(goals, context);

    it("lists each report's personal goals under that person, including one relating to a ministry", () => {
      expect(grouped.people.map((g) => g.personId)).toEqual(["ana"]);
      expect(ids(grouped.people)).toEqual([["ana-1", "ana-2"]]);
    });

    it("keeps a ministry's goal with the ministry even when a leader is responsible for it", () => {
      expect(grouped.ministries.map((g) => g.ministryId)).toEqual(["m-mine", "m-ana"]);
      expect(ids(grouped.ministries)).toEqual([["m-mine-1"], ["m-ana-1"]]);
    });

    it("lists other groups this leader's circle belongs to, and only this year's", () => {
      expect(ids(grouped.groups)).toEqual([["elders-1"]]);
      expect(JSON.stringify(grouped)).not.toContain('"old"');
    });
  });

  describe("for My Work", () => {
    const mine = goalsForMyWork(goals, context);

    it("counts only this leader's own goals as personal", () => {
      expect(mine.personal.map((g) => g.id)).toEqual(["mine-1"]);
    });

    it("keeps every ministry's goals in their own group, the viewer's first", () => {
      expect(mine.ministries.map((g) => [g.id, g.yours])).toEqual([
        ["m-mine", true],
        ["m-other", false],
        ["m-ana", false],
      ]);
    });

    it("keeps other groups apart from ministries, the viewer's first", () => {
      expect(mine.groups.map((g) => [g.id, g.yours])).toEqual([
        ["g-elders", true],
        ["g-far", false],
      ]);
    });

    it("never puts a personal goal in a ministry's group", () => {
      const inMinistries = mine.ministries.flatMap((g) => g.goals);
      expect(inMinistries.every((g) => g.scope === "ministry")).toBe(true);
    });
  });

  it("tells a ministry's own goals from leaders' goals that relate to it", () => {
    expect(ministryGoals(goals, "m-ana").map((g) => g.id)).toEqual(["m-ana-1"]);
    expect(personalGoalsRelatingTo(goals, "m-ana").map((g) => g.id)).toEqual(["ana-2"]);
  });
});
