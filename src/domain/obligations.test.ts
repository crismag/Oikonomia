import { describe, expect, it } from "vitest";

import {
  attentionOrder,
  cadenceLabel,
  statusLabel,
  cycleProgress,
  dueLabel,
  isSatisfied,
  needsAttention,
  progressOf,
  statusOf,
  tally,
  youAreHere,
  type Cadence,
  type LeadershipObligation,
  type ObligationStatus,
  type ObligationStep,
} from "./obligations";

/**
 * What a leader owes, and where that stands.
 *
 * These tests are about one claim: **the dashboard tells the truth about
 * where work stands.** A status that is computed wrongly is worse than no
 * dashboard, because a leader will act on it.
 */

const step = (id: string, done: boolean, required = true): ObligationStep => ({
  id,
  title: id,
  done,
  required,
});

const TODAY = "2026-09-11";

describe("required and optional work", () => {
  it("counts only required steps toward completion", () => {
    const steps = [step("a", true), step("b", true), step("c", false, false)];
    expect(progressOf(steps)).toEqual({ done: 2, total: 2 });
  });

  /**
   * The rule that will matter most once completion is computed server-side: a
   * leader who added no follow-up entries has not left the report unfinished.
   */
  it("is satisfied with every required step done and an optional one left", () => {
    const steps = [step("a", true), step("b", true), step("optional", false, false)];
    expect(isSatisfied(steps)).toBe(true);
    expect(statusOf({ steps, dueAt: "2026-09-13" }, TODAY)).toBe("done");
  });

  it("is not satisfied while a required step is outstanding", () => {
    const steps = [step("a", true), step("b", false), step("optional", true, false)];
    expect(isSatisfied(steps)).toBe(false);
  });
});

/**
 * The worked example from the brief, day by day.
 */
describe("status follows the cadence", () => {
  const attendanceTaken = [step("attendance", true), step("report", false)];
  const everythingDone = [step("attendance", true), step("report", true)];
  const due = "2026-09-13";

  it("is in progress while the work is under way and the date is comfortable", () => {
    expect(statusOf({ steps: attendanceTaken, dueAt: due }, "2026-09-11")).toBe("in_progress");
  });

  it("warns as the date approaches", () => {
    expect(statusOf({ steps: attendanceTaken, dueAt: due }, "2026-09-12")).toBe("warning");
    expect(statusOf({ steps: attendanceTaken, dueAt: due }, "2026-09-13")).toBe("warning");
  });

  it("needs attention once the date has passed", () => {
    expect(statusOf({ steps: attendanceTaken, dueAt: due }, "2026-09-14")).toBe("blocked");
  });

  it("is done once the required work is done", () => {
    expect(statusOf({ steps: everythingDone, dueAt: due }, "2026-09-14")).toBe("done");
  });

  /**
   * Work finished late is finished. Colouring it red the next morning would be
   * the system arguing with the leader about something they already did.
   */
  it("stays done even when it was finished after the date", () => {
    expect(statusOf({ steps: everythingDone, dueAt: "2026-01-01" }, TODAY)).toBe("done");
  });

  /** Being late is a consequence; being stopped is the cause. */
  it("says blocked rather than overdue when something is actually in the way", () => {
    const status = statusOf(
      { steps: attendanceTaken, dueAt: "2026-09-01", blockedReason: "Returned for clarification" },
      TODAY,
    );
    expect(status).toBe("blocked");
  });

  it("recedes before its period begins", () => {
    expect(
      statusOf({ steps: [step("a", false)], activeFrom: "2026-10-01", dueAt: "2026-10-05" }, TODAY),
    ).toBe("not_started");
  });

  it("does not call something late when it has no deadline at all", () => {
    expect(statusOf({ steps: [step("a", false)] }, TODAY)).toBe("not_started");
    expect(statusOf({ steps: [step("a", true), step("b", false)] }, TODAY)).toBe("in_progress");
  });

  it("takes the warning window from the caller when the cadence has a different one", () => {
    const steps = [step("a", false)];
    expect(statusOf({ steps, dueAt: "2026-09-16", warnWithinDays: 7 }, TODAY)).toBe("warning");
    expect(statusOf({ steps, dueAt: "2026-09-16" }, TODAY)).toBe("not_started");
  });

  /**
   * A deadline is not a start. An obligation nobody has touched is upcoming,
   * however soon it is due — calling it "in progress" would describe work that
   * has not begun.
   */
  it("does not call untouched work in progress merely because it has a date", () => {
    expect(statusOf({ steps: [step("a", false)], dueAt: "2026-09-30" }, TODAY)).toBe("not_started");
  });
});

describe("how a date reads", () => {
  it("says today, tomorrow and how late rather than a date to compare", () => {
    expect(dueLabel("2026-09-11", TODAY)).toBe("Due today");
    expect(dueLabel("2026-09-12", TODAY)).toBe("Due tomorrow");
    expect(dueLabel("2026-09-10", TODAY)).toBe("1 day overdue");
    expect(dueLabel("2026-09-08", TODAY)).toBe("3 days overdue");
    expect(dueLabel("2026-09-15", TODAY)).toBe("Due in 4 days");
  });

  /** Saying "3 days overdue" beside "Done" is the page arguing with itself. */
  it("says nothing about a deadline once the work is done", () => {
    expect(dueLabel("2026-09-08", TODAY, "done")).toBeUndefined();
    expect(dueLabel("2026-09-08", TODAY, "warning")).toBe("3 days overdue");
  });

  it("says nothing when there is nothing useful to say", () => {
    expect(dueLabel(undefined, TODAY)).toBeUndefined();
    expect(dueLabel("2026-12-25", TODAY)).toBeUndefined();
  });
});

/* ------------------------------------------------------------- ordering */

const obligation = (
  id: string,
  status: LeadershipObligation["status"],
  dueAt?: string,
): LeadershipObligation => ({
  id,
  module: "Test",
  title: id,
  cadence: "weekly",
  cycle: "This week",
  status,
  steps: [],
  destination: "/",
  ...(dueAt ? { dueAt } : {}),
});

describe("what a leader sees first", () => {
  it("puts a problem above a deadline, a deadline above work in hand", () => {
    const ordered = [
      obligation("upcoming", "not_started"),
      obligation("active", "in_progress"),
      obligation("due", "warning"),
      obligation("stuck", "blocked"),
    ].sort(attentionOrder);

    expect(ordered.map((o) => o.id)).toEqual(["stuck", "due", "active", "upcoming"]);
  });

  it("puts the nearer deadline first within one state", () => {
    const ordered = [
      obligation("later", "warning", "2026-09-15"),
      obligation("sooner", "warning", "2026-09-12"),
    ].sort(attentionOrder);
    expect(ordered.map((o) => o.id)).toEqual(["sooner", "later"]);
  });

  /** Something with no deadline cannot be late, so it does not jump the queue. */
  it("sorts an obligation with no deadline after one that has", () => {
    const ordered = [
      obligation("undated", "warning"),
      obligation("dated", "warning", "2026-09-20"),
    ].sort(attentionOrder);
    expect(ordered.map((o) => o.id)).toEqual(["dated", "undated"]);
  });

  /**
   * A list of what needs doing that includes things that do not is a list a
   * leader stops reading.
   */
  it("leaves finished work out of what needs attention", () => {
    const all = [obligation("done", "done"), obligation("due", "warning")];
    expect(needsAttention(all).map((o) => o.id)).toEqual(["due"]);
  });
});

describe("the counts across the top", () => {
  it("counts obligations, in every state", () => {
    const counts = tally([
      obligation("a", "done"),
      obligation("b", "done"),
      obligation("c", "in_progress"),
      obligation("d", "warning"),
      obligation("e", "blocked"),
      obligation("f", "not_started"),
    ]);
    expect(counts).toEqual({ done: 2, in_progress: 1, warning: 1, blocked: 1, not_started: 1 });
  });

  /** The denominator has to be something a leader can point at. */
  it("measures a cycle by its required steps", () => {
    const withSteps = (id: string, steps: ObligationStep[]): LeadershipObligation => ({
      ...obligation(id, "in_progress"),
      steps,
    });
    const progress = cycleProgress([
      withSteps("a", [step("1", true), step("2", false)]),
      withSteps("b", [step("3", true), step("4", true), step("5", false, false)]),
    ]);
    expect(progress).toEqual({ done: 3, total: 4 });
  });
});

/**
 * Colour is never the only carrier.
 *
 * The components render `statusLabel[status]` beside every dot and inside every
 * chip, so a state without a word would reach the page as a coloured circle
 * that means nothing to a reader who cannot see the colour. This makes adding
 * one a build failure rather than a design review finding.
 */
describe("every state can be read without colour", () => {
  it("gives each status a word", () => {
    const states: ObligationStatus[] = ["done", "in_progress", "warning", "blocked", "not_started"];
    for (const status of states) {
      expect(statusLabel[status], status).toBeTruthy();
    }
    expect(Object.keys(statusLabel).sort()).toEqual([...states].sort());
  });

  it("gives each cadence a word, so a rhythm is never implied by position alone", () => {
    const cadences: Cadence[] = ["weekly", "monthly", "ongoing", "event", "once"];
    for (const cadence of cadences) expect(cadenceLabel[cadence], cadence).toBeTruthy();
    expect(Object.keys(cadenceLabel).sort()).toEqual([...cadences].sort());
  });
});

describe("where the leader is in the cycle", () => {
  it("points at the first station that is not finished", () => {
    const stations = [
      obligation("agenda", "done"),
      obligation("meeting", "done"),
      obligation("lifegroup", "in_progress"),
      obligation("reach-out", "warning"),
    ];
    expect(youAreHere(stations)).toBe("lifegroup");
  });

  /** An arrow pointing at a place the leader is not is worse than no arrow. */
  it("points nowhere when the cycle is finished", () => {
    expect(youAreHere([obligation("a", "done"), obligation("b", "done")])).toBeUndefined();
  });

  it("points nowhere when the cycle has not begun", () => {
    expect(
      youAreHere([obligation("a", "not_started"), obligation("b", "not_started")]),
    ).toBeUndefined();
  });
});
