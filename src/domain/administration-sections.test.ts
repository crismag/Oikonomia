import { describe, expect, it } from "vitest";

import {
  DEFAULT_ADMINISTRATION_SECTION,
  administrationSectionFor,
  administrationSections,
} from "./administration-sections";
import { churchSetupSteps } from "./church-setup";
import { destinations } from "@/integrations/guide/destinations";

describe("administration sections", () => {
  it("opens the section a hash names, with or without the #", () => {
    expect(administrationSectionFor("#people")).toBe("people");
    expect(administrationSectionFor("google-workspace")).toBe("google-workspace");
  });

  it("opens the default for no hash or one it does not know", () => {
    expect(administrationSectionFor("")).toBe(DEFAULT_ADMINISTRATION_SECTION);
    expect(administrationSectionFor(undefined)).toBe(DEFAULT_ADMINISTRATION_SECTION);
    expect(administrationSectionFor("#nowhere")).toBe(DEFAULT_ADMINISTRATION_SECTION);
  });

  it("has a section for every Administration link the Guide offers", () => {
    /* A Guide destination whose hash matched no section would open the default
       and look like a wrong link. */
    const ids = new Set<string>(administrationSections.map((section) => section.id));
    for (const destination of Object.values(destinations)) {
      if (destination.path !== "/administration" || !destination.hash) continue;
      expect(ids.has(destination.hash)).toBe(true);
    }
  });

  it("has a section for every step of setting up a church", () => {
    const steps = churchSetupSteps({
      campuses: 0,
      ministries: 0,
      people: 0,
      othersWithAccounts: 0,
      confirmedAssignments: 0,
    });
    const ids = new Set<string>(administrationSections.map((section) => section.id));
    for (const step of steps) expect(ids.has(step.section)).toBe(true);
  });
});
