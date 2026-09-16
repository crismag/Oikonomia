import { describe, expect, it } from "vitest";

import {
  canContribute,
  canDeleteReport,
  commentCount,
  contributorsOf,
  commentsInOrder,
  displayTitle,
  laterContributors,
  preview,
  reportById,
  reportsNewestFirst,
  searchReports,
  wasEdited,
} from "./reach-out";
import { reachOutReports } from "@/test/fixtures";
import type { ReachOutReport } from "./types";

/**
 * Reach-Out behaviour.
 *
 * The module is small by design, so most of what is worth testing is what it
 * refuses to know. A report is a report: it carries no person, no stage, no
 * category and no outcome, and nothing here may quietly reintroduce one.
 */

const report = (over: Partial<ReachOutReport> = {}): ReachOutReport => ({
  id: "r1",
  title: "Weekly reach-out",
  reportDate: "2026-09-08",
  content: "We went around the park and spoke with several people.",
  authorId: "p-maria",
  createdAt: "2026-09-08T21:00:00",
  updatedAt: "2026-09-08T21:00:00",
  comments: [],
  ...over,
});

const nameOf = (personId: string) => (personId === "p-maria" ? "Maria Santos" : "Mark Delos Reyes");

describe("the report is the record", () => {
  it("requires nothing but a title, a date, content and an author", () => {
    const bare = report({ title: "", content: "" });
    expect(bare.reportDate).toBeTruthy();
    expect(bare.authorId).toBeTruthy();
  });

  /** Every one of these would be an assumption about how outreach must work. */
  /** §6 — no organizational entities invented to support weekly reporting. */
  it("builds no Reach-Out team, membership or assigned leader", () => {
    for (const field of [
      "teamId",
      "memberIds",
      "membership",
      "assignedLeaderId",
      "reachOutTeam",
      "groupId",
    ]) {
      expect(report()).not.toHaveProperty(field);
      for (const shipped of reachOutReports) expect(shipped).not.toHaveProperty(field);
    }
  });

  it("carries no person, stage, category, campaign, count or outcome", () => {
    for (const field of [
      "personId",
      "contactId",
      "stage",
      "outreachType",
      "category",
      "campaign",
      "location",
      "numberReached",
      "followUpStatus",
      "conversionStatus",
      "ownerId",
      "next",
    ]) {
      expect(report()).not.toHaveProperty(field);
    }
  });

  it("holds the shipped reports to the same shape", () => {
    for (const shipped of reachOutReports) {
      expect(shipped).not.toHaveProperty("personId");
      expect(shipped).not.toHaveProperty("stage");
      expect(shipped).not.toHaveProperty("category");
    }
  });

  /**
   * §2 lists five kinds of report that must all be valid. Each is prose, and
   * none of them reduces to a person plus a stage.
   */
  it("accepts every kind of report the brief names as valid", () => {
    const kinds = [
      "Visited the Santos family and spent some time praying with them.",
      "We went around Thomson Park and spoke with several people.",
      "Followed up with some of the visitors from Sunday.",
      "Distributed invitations around the neighbourhood.",
      "Called and encouraged two families this week.",
    ];
    for (const content of kinds) {
      expect(report({ content }).content).toBe(content);
    }
  });

  it("ships reports covering named, unnamed and place-based outreach", () => {
    const all = reachOutReports
      .map((r) => r.content)
      .join(" ")
      .toLowerCase();
    expect(all).toContain("santos family");
    expect(all).toContain("thomson park");
    expect(all).toContain("several people");
  });
});

describe("the list", () => {
  it("puts the most recent report first", () => {
    const list = [
      report({ id: "older", reportDate: "2026-08-24" }),
      report({ id: "newest", reportDate: "2026-09-08" }),
      report({ id: "middle", reportDate: "2026-09-01" }),
    ];
    expect(reportsNewestFirst(list).map((r) => r.id)).toEqual(["newest", "middle", "older"]);
  });

  it("does not mutate what it was given", () => {
    const list = [report({ id: "a", reportDate: "2026-01-01" }), report({ id: "b" })];
    reportsNewestFirst(list);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("breaks a same-day tie by when it was written", () => {
    const list = [
      report({ id: "first", createdAt: "2026-09-08T09:00:00" }),
      report({ id: "second", createdAt: "2026-09-08T18:00:00" }),
    ];
    expect(reportsNewestFirst(list)[0]?.id).toBe("second");
  });

  it("finds a report by id", () => {
    expect(reportById([report({ id: "x" })], "x")?.id).toBe("x");
    expect(reportById([report()], "missing")).toBeUndefined();
  });
});

describe("previews", () => {
  it("leaves a short report alone", () => {
    expect(preview("Short one.")).toBe("Short one.");
  });

  it("collapses the line breaks a leader typed", () => {
    expect(preview("First line.\n\nSecond line.")).toBe("First line. Second line.");
  });

  it("cuts on a word boundary rather than mid-word", () => {
    const long = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const cut = preview(long, 30);
    expect(cut.endsWith("…")).toBe(true);

    /* What survived is a whole number of words from the start of the report. */
    const kept = cut.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(" ");
  });

  it("never reformats the report itself", () => {
    const original = "Line one.\n\nLine two.";
    const r = report({ content: original });
    preview(r.content);
    expect(r.content).toBe(original);
  });

  it("gives an untitled report something to be called", () => {
    expect(displayTitle(report({ title: "   " }))).toBe("Untitled report");
    expect(displayTitle(report({ title: "Weekly reach-out" }))).toBe("Weekly reach-out");
  });
});

describe("search", () => {
  const list = [
    report({ id: "park", title: "Weekly reach-out", content: "Around Thomson Park." }),
    report({ id: "calls", title: "Calls this week", content: "Two families.", authorId: "p-mark" }),
  ];

  it("matches the title", () => {
    expect(searchReports(list, "weekly", nameOf).map((r) => r.id)).toEqual(["park"]);
  });

  it("matches words inside the report", () => {
    expect(searchReports(list, "thomson", nameOf).map((r) => r.id)).toEqual(["park"]);
  });

  it("matches the leader who wrote it", () => {
    expect(searchReports(list, "mark", nameOf).map((r) => r.id)).toEqual(["calls"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchReports(list, "   ", nameOf)).toHaveLength(2);
  });
});

describe("Reach-Out is shared leadership work", () => {
  it("lets the leader who wrote it work on it", () => {
    expect(canContribute(report(), "p-maria")).toBe(true);
  });

  /**
   * The rule this replaced. Authorship is provenance, not exclusive ownership:
   * one leader leads an effort, another writes it up, a third adds what they
   * saw, and none of them has to be assigned to Reach-Out first.
   */
  it("lets any other leader work on it too", () => {
    expect(canContribute(report(), "p-mark")).toBe(true);
    expect(canContribute(report(), "p-someone-new")).toBe(true);
  });

  it("names the first author, then whoever added to it", () => {
    const r = report({ contributorIds: ["p-mark", "p-john"] });
    expect(contributorsOf(r)).toEqual(["p-maria", "p-mark", "p-john"]);
    expect(laterContributors(r)).toEqual(["p-mark", "p-john"]);
  });

  it("never lists the same leader twice", () => {
    const r = report({ contributorIds: ["p-maria", "p-mark", "p-mark"] });
    expect(contributorsOf(r)).toEqual(["p-maria", "p-mark"]);
  });

  it("has no later contributors on a report only its author touched", () => {
    expect(laterContributors(report())).toEqual([]);
  });

  it("counts comments without counting system entries", () => {
    const r = report({
      comments: [
        { id: "c1", authorId: "p-mark", at: "2026-09-09T09:00:00", body: "Thank you." },
        { id: "c2", authorId: "p-mark", at: "2026-09-09T09:05:00", body: "Noted.", system: true },
      ],
    });
    expect(commentCount(r)).toBe(1);
  });

  it("reads the conversation oldest first", () => {
    const r = report({
      comments: [
        { id: "late", authorId: "p-mark", at: "2026-09-09T12:00:00", body: "b" },
        { id: "early", authorId: "p-mark", at: "2026-09-09T08:00:00", body: "a" },
      ],
    });
    expect(commentsInOrder(r).map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("does not call a freshly written report updated", () => {
    expect(wasEdited(report())).toBe(false);
  });

  it("marks a report that was come back to", () => {
    expect(wasEdited(report({ updatedAt: "2026-09-09T08:15:00" }))).toBe(true);
  });
});

describe("permissions are an open decision", () => {
  /**
   * A policy field exists so the binder-wide access model can be applied later
   * without reshaping the record. Guessing at one now would be worse than
   * leaving it empty — see §10.
   */
  it("ships no report with an assumed audience policy", () => {
    expect(reachOutReports.every((r) => r.policy === undefined)).toBe(true);
  });
});

describe("who may delete a report", () => {
  it("is whoever started it", () => {
    expect(canDeleteReport(report(), "p-maria")).toBe(true);
  });

  it("is not a leader who only added to it", () => {
    const continued = report({ contributorIds: ["p-joel"] });
    expect(canContribute(continued, "p-joel")).toBe(true);
    expect(canDeleteReport(continued, "p-joel")).toBe(false);
  });
});
