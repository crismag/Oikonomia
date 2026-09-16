import { describe, expect, it } from "vitest";

import { churchSetupComplete, churchSetupSteps, type ChurchSetupProgress } from "./church-setup";

/**
 * The first-church checklist is computed, never ticked. These pin what counts
 * as done, so a step cannot read as finished because a form was opened.
 */
const fresh: ChurchSetupProgress = {
  campuses: 0,
  ministries: 0,
  people: 1,
  othersWithAccounts: 0,
  confirmedAssignments: 0,
};

const doneIds = (progress: ChurchSetupProgress) =>
  churchSetupSteps(progress)
    .filter((step) => step.done)
    .map((step) => step.id);

describe("churchSetupSteps", () => {
  it("starts with nothing done for the first administrator alone", () => {
    expect(doneIds(fresh)).toEqual([]);
    expect(churchSetupComplete(churchSetupSteps(fresh))).toBe(false);
  });

  it("does not count the administrator as a leader they added", () => {
    expect(doneIds({ ...fresh, people: 1 })).not.toContain("leaders");
    expect(doneIds({ ...fresh, people: 2 })).toContain("leaders");
  });

  it("counts an invitation only when somebody else has an account", () => {
    expect(doneIds({ ...fresh, people: 4 })).not.toContain("invitations");
    expect(doneIds({ ...fresh, people: 4, othersWithAccounts: 1 })).toContain("invitations");
  });

  it("is complete once every record exists, and only then", () => {
    const established = {
      campuses: 1,
      ministries: 3,
      people: 12,
      othersWithAccounts: 5,
      confirmedAssignments: 8,
    };
    expect(churchSetupComplete(churchSetupSteps(established))).toBe(true);
    expect(churchSetupComplete(churchSetupSteps({ ...established, confirmedAssignments: 0 }))).toBe(
      false,
    );
  });

  it("points every step at a section of Administration", () => {
    for (const step of churchSetupSteps(fresh)) {
      expect(["campuses", "ministries", "people", "assignments"]).toContain(step.section);
    }
  });
});
