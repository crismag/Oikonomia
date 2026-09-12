import { describe, expect, it } from "vitest";

import { resolveAccess } from "./access";
import { GROUP_CENTRAL_LEADERSHIP, personById, personaById, workById } from "@/test/fixtures";
import type { AudiencePolicy, PersonaId } from "./types";

/**
 * Access is a correctness boundary, not a visual concern.
 *
 * These cases encode the rules from
 * the four rules stated in `access.ts` so that a later refactor cannot
 * quietly widen an audience. Production enforcement is still deferred to the
 * backend; this guards the semantics the prototype claims to demonstrate.
 */

function levelFor(personaId: PersonaId, policy: AudiencePolicy) {
  const persona = personaById(personaId);
  return resolveAccess(persona, personById(persona.personId), policy);
}

const base: AudiencePolicy = {
  classification: "open",
  ownerId: "p-nobody",
  campusId: "cmp-scarborough",
};

describe("classification ceilings", () => {
  it("denies pastoral-private to an unrelated leader", () => {
    expect(levelFor("leader", { ...base, classification: "pastoral-private" }).level).toBe(
      "denied",
    );
  });

  it("denies pastoral-private to administration, and says why", () => {
    const decision = levelFor("admin", { ...base, classification: "pastoral-private" });
    expect(decision.level).toBe("denied");
    expect(decision.rationale).toMatch(/not pastoral content/i);
  });

  it("does not let seniority open leadership-confidential content", () => {
    const decision = levelFor("bishop", {
      ...base,
      classification: "leadership-confidential",
    });
    expect(decision.level).toBe("metadata");
    expect(decision.rationale).toMatch(/does not imply/i);
  });

  it("opens leadership-confidential to the named leadership audience", () => {
    // The Bishop is a member of central leadership in the fixtures.
    const decision = levelFor("bishop", {
      ...base,
      classification: "leadership-confidential",
      audienceGroups: [GROUP_CENTRAL_LEADERSHIP],
    });
    expect(decision.level).toBe("full");
  });
});

describe("ownership and explicit share", () => {
  it("gives the owner full access even to pastoral-private", () => {
    expect(
      levelFor("leader", {
        ...base,
        classification: "pastoral-private",
        ownerId: "p-maria",
      }).level,
    ).toBe("full");
  });

  it("honours an explicit named share", () => {
    expect(
      levelFor("leader", {
        ...base,
        classification: "leadership-confidential",
        audience: ["p-maria"],
      }).level,
    ).toBe("full");
  });

  it("lets an explicit exclusion beat an ordinary contextual grant", () => {
    expect(levelFor("leader", { ...base, excluded: ["p-maria"] }).level).toBe("denied");
  });
});

describe("section sensitivity", () => {
  const mixed: AudiencePolicy = {
    ...base,
    classification: "leadership-confidential",
    reviewers: ["p-bishop"],
    restrictedSections: ["Pastoral notes"],
  };

  it("limits a reviewer when the record holds stricter sections", () => {
    const decision = levelFor("bishop", mixed);
    expect(decision.level).toBe("limited");
    expect(decision.restrictedSections).toEqual(["Pastoral notes"]);
  });

  it("gives a reviewer full access when no section is stricter", () => {
    const { restrictedSections: _omit, ...plain } = mixed;
    expect(levelFor("bishop", plain).level).toBe("full");
  });

  it("limits a participant the same way", () => {
    expect(
      levelFor("leader", {
        ...base,
        classification: "context-restricted",
        participants: ["p-maria"],
        restrictedSections: ["Concerns"],
      }).level,
    ).toBe("limited");
  });

  it("never grants pastoral content through participation alone", () => {
    expect(
      levelFor("leader", {
        ...base,
        classification: "pastoral-private",
        participants: ["p-maria"],
      }).level,
    ).toBe("metadata");
  });
});

describe("administration is not omniscience", () => {
  it("grants metadata, not content, on context-restricted records", () => {
    const decision = levelFor("admin", { ...base, classification: "context-restricted" });
    expect(decision.level).toBe("metadata");
    expect(decision.rationale).toMatch(/metadata, not content/i);
  });

  it("still allows ordinary open operational records in scope", () => {
    expect(levelFor("admin", { ...base, campusId: "cmp-central" }).level).toBe("full");
  });
});

describe("default deny", () => {
  it("denies a context-restricted record with no applicable grant", () => {
    expect(
      levelFor("leader", { ...base, classification: "context-restricted", ministryId: "min-none" })
        .level,
    ).toBe("denied");
  });
});

describe("fixtures behave as the journeys describe", () => {
  const policyOf = (id: string) => {
    const work = workById(id);
    if (!work) throw new Error(`missing fixture ${id}`);
    return work.policy;
  };

  it("Bishop reviews the development report but not its pastoral notes", () => {
    const decision = levelFor("bishop", policyOf("w-lead-dev-report"));
    expect(decision.level).toBe("limited");
    expect(decision.restrictedSections).toContain("Pastoral notes");
  });

  it("Admin cannot open a private Lifegroup follow-up", () => {
    expect(levelFor("admin", policyOf("w-lg-follow-up")).level).toBe("denied");
  });

  it("Leader cannot read central leadership direction", () => {
    expect(levelFor("leader", policyOf("w-sept-direction")).level).toBe("metadata");
  });

  it("Leader participates fully in the camp transport concern", () => {
    expect(levelFor("leader", policyOf("w-camp-transport")).level).toBe("full");
  });
});
