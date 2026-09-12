import type { Capability } from "./types";

/**
 * What the application can actually enforce.
 *
 * A **closed set, owned by code.** Each entry corresponds to a rule somebody
 * wrote and a test somebody can point at; there is no way to add one from a
 * settings screen, because adding one would mean writing the rule that honours
 * it. This is the same shape as the access strategies a visibility choice
 * names: configuration picks among capabilities the product implements, and
 * never invents one.
 *
 * ## Why this is separate from roles
 *
 * A role — "Bishop", "Ministry Head" — is a **name a church gives a bundle of
 * these**. Renaming the bundle must not change what it may do, and adding a
 * bundle must not require a code change. Keeping the two apart is what makes
 * both of those true; collapsing them is how `persona.id === "bishop"` ends up
 * in an authorization branch, which is what this separation replaced.
 *
 * A person's **title** is a third thing again: free text on their record, for
 * the church's own reading. It authorizes nothing, and `describe(
 * "authorization asks what somebody may do, never who they are")` keeps that
 * true.
 */

export interface CapabilityDefinition {
  id: Capability;
  label: string;
  /** What granting it actually opens. Written for whoever assigns it. */
  description: string;
}

export const capabilities: CapabilityDefinition[] = [
  {
    id: "campus-oversight",
    label: "Campus oversight",
    description:
      "Sees the leadership work of one campus by name, and may put somebody else's name against a gathering. Does not open confidential reports.",
  },
  {
    id: "cross-ministry-oversight",
    label: "Cross-ministry oversight",
    description:
      "Sees leadership work across ministries. Seniority still does not open a confidential report — that takes being in its audience.",
  },
  {
    id: "administration",
    label: "Administration",
    description:
      "Sets up the organisation and changes configuration. Deliberately grants no pastoral content: administration manages structure, not what a report says.",
  },
];

export const capabilityIds: Capability[] = capabilities.map((capability) => capability.id);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && capabilityIds.includes(value as Capability);
}

export function capabilityLabel(id: Capability): string {
  return capabilities.find((capability) => capability.id === id)?.label ?? id;
}
