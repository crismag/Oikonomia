import { describe, expect, it } from "vitest";

import {
  completion,
  distribution,
  matrixOrder,
  overallLabel,
  overallStatus,
  trendDirection,
  type LeaderStatus,
  type TrendPoint,
} from "./team-overview";
import { isLeader, scopeFor } from "./team-scope";
import { GROUP_CAMPUS_LEADERS, GROUP_CENTRAL_LEADERSHIP, ministries } from "@/test/fixtures";
import type { ObligationStatus, LeadershipObligation } from "./obligations";
import type { Person, ResponsibilityGroup } from "./types";

/**
 * The organization's leadership work, seen from above.
 *
 * Two claims carry this module and both are easy to lose by accident: **it is
 * not a ranking**, and **oversight is what grants sight of a name**, not rank.
 */

const person = (id: string, ministryIds: string[] = [], campusId = "cmp-a"): Person => ({
  id,
  name: id,
  initials: id.slice(0, 2),
  role: "Leader",
  campusId,
  ministryIds,
});

/** A responsibility group the church has named as a leadership body. */
const body = (id: string, memberIds: string[], campusId?: string): ResponsibilityGroup => ({
  id,
  name: id,
  description: "",
  ...(campusId ? { campusId } : {}),
  groupType: "leadership-body",
  leadershipAudience: true,
  active: true,
  memberIds,
});

describe("one leader's overall state", () => {
  /**
   * The worst of their sections, not an average. A leader with five healthy
   * areas and one overdue report is a leader with an overdue report — averaging
   * would let a real problem disappear into otherwise good work.
   */
  it("is the worst of their sections", () => {
    expect(overallStatus(["done", "done", "blocked", "done"])).toBe("blocked");
    expect(overallStatus(["done", "warning", "in_progress"])).toBe("warning");
    expect(overallStatus(["done", "in_progress"])).toBe("in_progress");
    expect(overallStatus(["done", "done"])).toBe("done");
  });

  it("is on track when there is nothing to report", () => {
    expect(overallStatus([])).toBe("done");
  });

  it("says each state in words a person would use", () => {
    const states: ObligationStatus[] = ["done", "in_progress", "warning", "blocked", "not_started"];
    for (const status of states) expect(overallLabel[status], status).toBeTruthy();
  });
});

/**
 * A church is not a league table.
 */
describe("leaders are ordered, never ranked", () => {
  const leader = (id: string, overall: ObligationStatus): LeaderStatus => ({
    personId: id,
    areas: {},
    overall,
    outstanding: 0,
  });

  it("puts whoever needs following up first, then sorts by name", () => {
    const ordered = matrixOrder(
      [
        leader("Zoe", "done"),
        leader("Adam", "done"),
        leader("Mary", "blocked"),
        leader("Ben", "warning"),
      ],
      (id) => id,
    );
    expect(ordered.map((l) => l.personId)).toEqual(["Mary", "Ben", "Adam", "Zoe"]);
  });

  /**
   * Nothing in the shape of a leader carries a score or a position. If one is
   * ever added, this test is where the conversation should happen.
   */
  it("gives a leader no score and no position", () => {
    const one = leader("Adam", "done");
    expect(Object.keys(one).sort()).toEqual(["areas", "outstanding", "overall", "personId"]);
    expect(one).not.toHaveProperty("score");
    expect(one).not.toHaveProperty("rank");
  });
});

describe("counting", () => {
  it("says what the denominator is, not only a percentage", () => {
    expect(completion(9, 12)).toEqual({ pct: 75, done: 9, total: 12 });
    /* 91% of eleven things is a different situation from 91% of four hundred. */
    expect(completion(0, 0)).toEqual({ pct: 0, done: 0, total: 0 });
  });

  it("divides obligations across the states", () => {
    const at = (status: ObligationStatus): LeadershipObligation => ({
      id: status,
      module: "m",
      title: "t",
      cadence: "weekly",
      cycle: "c",
      status,
      steps: [],
      destination: "/",
    });
    expect(distribution([at("done"), at("done"), at("blocked")])).toMatchObject({
      done: 2,
      blocked: 1,
    });
  });
});

describe("which way things are going", () => {
  const point = (label: string, done: number): TrendPoint => ({ label, done, total: 10 });

  /** A direction claimed from two data points is a guess wearing a label. */
  it("says nothing when there is too little history", () => {
    expect(trendDirection([point("a", 5), point("b", 9)])).toBeUndefined();
    expect(trendDirection([point("a", 5), point("b", 6), point("c", 9)])).toBeUndefined();
  });

  it("calls a clear rise improving and a clear fall declining", () => {
    const rising = [point("a", 5), point("b", 5), point("c", 5), point("d", 9)];
    expect(trendDirection(rising)?.direction).toBe("improving");

    const falling = [point("a", 9), point("b", 9), point("c", 9), point("d", 4)];
    expect(trendDirection(falling)?.direction).toBe("declining");
  });

  it("calls small movement stable rather than inventing a story", () => {
    const flat = [point("a", 7), point("b", 7), point("c", 8), point("d", 7)];
    expect(trendDirection(flat)?.direction).toBe("stable");
  });
});

/**
 * Oversight grants sight of a name. Rank does not.
 */
describe("whose work a reader may see", () => {
  it("shows every leader to central leadership", () => {
    const scope = scopeFor(person("p-bishop"), ministries, "Campus", [
      body(GROUP_CENTRAL_LEADERSHIP, ["p-bishop"]),
    ]);
    expect(scope.namesVisible).toBe(true);
    expect(scope.campusId).toBeUndefined();
    expect(scope.ministryIds).toBeUndefined();
  });

  it("shows a campus leader their own campus", () => {
    const scope = scopeFor(person("p-ruth", [], "cmp-a"), ministries, "Campus", [
      body(GROUP_CAMPUS_LEADERS, ["p-ruth"], "cmp-a"),
    ]);
    expect(scope.namesVisible).toBe(true);
    expect(scope.campusId).toBe("cmp-a");
  });

  it("shows a ministry lead the ministries they lead", () => {
    const lead = ministries[0]!;
    const scope = scopeFor(person(lead.leadId), ministries, "Campus");
    expect(scope.namesVisible).toBe(true);
    expect(scope.ministryIds).toEqual([lead.id]);
  });

  /**
   * The default is nobody. A reader with no oversight responsibility sees how
   * the church is doing and not who is behind — which is the right answer for
   * most people who will open this page.
   */
  it("shows a leader with no oversight nobody at all", () => {
    const scope = scopeFor(person("p-someone", []), ministries, "Campus");
    expect(scope.namesVisible).toBe(false);
  });

  /**
   * Belonging to a group is not oversight.
   *
   * A church names groups for all sorts of reasons — a worship rota, a
   * building committee. Only a group it has marked as a leadership body shows
   * anyone else's name, and only while that group is active.
   */
  it("shows nobody's name for a group that is not a leadership body", () => {
    const rota = { ...body("grp-rota", ["p-sam"]), leadershipAudience: false };
    const scope = scopeFor(person("p-sam"), ministries, "Campus", [rota]);
    expect(scope.namesVisible).toBe(false);
  });

  it("shows nobody's name for a leadership body that has been deactivated", () => {
    const retired = { ...body("grp-old", ["p-sam"]), active: false };
    const scope = scopeFor(person("p-sam"), ministries, "Campus", [retired]);
    expect(scope.namesVisible).toBe(false);
  });

  /** Membership is the group's record, not a similar-looking id on the person. */
  it("shows nobody's name to a person the group does not list", () => {
    const scope = scopeFor(person("p-outsider"), ministries, "Campus", [
      body(GROUP_CENTRAL_LEADERSHIP, ["p-bishop"]),
    ]);
    expect(scope.namesVisible).toBe(false);
  });

  it("explains the scope in a sentence, because a subset reads as the whole", () => {
    const bodies = [
      body(GROUP_CENTRAL_LEADERSHIP, ["a"]),
      body(GROUP_CAMPUS_LEADERS, ["b"], "cmp-a"),
    ];
    for (const who of [person("a"), person("b", [], "cmp-a"), person("c")]) {
      const scope = scopeFor(who, ministries, "Campus", bodies);
      expect(scope.reason, who.id).toBeTruthy();
      expect(scope.label, who.id).toBeTruthy();
    }
  });
});

describe("who counts as a leader", () => {
  const noGatherings = new Set<string>();
  const noReports = new Set<string>();

  it("counts whoever the binder expects leadership work from", () => {
    const lead = ministries[0]!;
    expect(isLeader(person(lead.leadId), ministries, noGatherings, noReports)).toBe(true);
    expect(isLeader(person("p-x"), ministries, new Set(["p-x"]), noReports)).toBe(true);
    expect(isLeader(person("p-y"), ministries, noGatherings, new Set(["p-y"]))).toBe(true);
  });

  /** Serving on a team is not the same as being expected to report. */
  it("does not count a member or a guest", () => {
    expect(isLeader(person("p-guest", []), ministries, noGatherings, noReports)).toBe(false);
  });
});
