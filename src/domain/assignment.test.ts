import { describe, expect, it } from "vitest";

import {
  assignmentSentence,
  assignmentStatuses,
  isCurrentAssignment,
  isServing,
  needsDecision,
  type Assignment,
} from "./assignment";

/**
 * What an assignment's state means.
 *
 * `isServing` is a security-relevant predicate: it is the difference between
 * "somebody said they are part of the music ministry" and "they are". These
 * pin the closed direction, because the open one is the expensive mistake.
 */

const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  scope: "ministry",
  targetId: "min-1",
  personId: "p-1",
  function: "",
  status: "confirmed",
  ...over,
});

describe("whether somebody is actually serving somewhere", () => {
  it("is true only when the church has confirmed it", () => {
    expect(isServing("confirmed")).toBe(true);
  });

  /* A claim is not membership; a correction request is somebody saying the
     record is wrong; an ended assignment is history. None of the three is a
     reason to open a ministry's information. */
  it("is false for everything else", () => {
    for (const status of assignmentStatuses.filter((s) => s !== "confirmed")) {
      expect(isServing(status), status).toBe(false);
    }
  });

  it("is false for a status nothing recognises", () => {
    expect(isServing("invented-70241")).toBe(false);
    expect(isServing("")).toBe(false);
  });
});

describe("what is still going on", () => {
  it("counts a claim and a correction request as current", () => {
    expect(isCurrentAssignment("pending")).toBe(true);
    expect(isCurrentAssignment("correction-requested")).toBe(true);
  });

  it("does not count what has ended", () => {
    expect(isCurrentAssignment("ended")).toBe(false);
  });

  it("treats an unrecognised status as not current", () => {
    expect(isCurrentAssignment("invented-70241")).toBe(false);
  });
});

describe("what an administrator is waiting to decide", () => {
  it("is what somebody said, and what somebody disputed", () => {
    expect(needsDecision("pending")).toBe(true);
    expect(needsDecision("correction-requested")).toBe(true);
  });

  it("is not what is already settled", () => {
    expect(needsDecision("confirmed")).toBe(false);
    expect(needsDecision("ended")).toBe(false);
  });
});

/**
 * The sentence somebody reads about their own record.
 *
 * An unconfirmed claim has to *read* as a claim. Showing "Music Ministry" for
 * something nobody has agreed to would tell a leader they are in a ministry
 * they are not in.
 */
describe("how one assignment reads", () => {
  it("says nothing extra about a confirmed one", () => {
    expect(assignmentSentence(assignment({ function: "head" }), "Music")).toBe("Head · Music");
  });

  it("says a claim is waiting", () => {
    expect(assignmentSentence(assignment({ status: "pending" }), "Music")).toMatch(/awaiting/i);
  });

  it("says a correction was asked for", () => {
    expect(assignmentSentence(assignment({ status: "correction-requested" }), "Music")).toMatch(
      /correction/i,
    );
  });

  it("says an old one has ended rather than hiding it", () => {
    expect(assignmentSentence(assignment({ status: "ended" }), "Music")).toMatch(/ended/i);
  });

  it("reads without a function, because most people hold none", () => {
    expect(assignmentSentence(assignment(), "Music")).toBe("Music");
  });
});
