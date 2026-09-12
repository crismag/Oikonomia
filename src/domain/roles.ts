import { config } from "@/config";
import { isCapability } from "./capabilities";
import type { Capability, Persona, PersonaId } from "./types";

/**
 * Access roles: named bundles of capabilities.
 *
 * The list below is what a **new installation** starts with, not what an
 * installation has. A role's name and the capabilities in its bundle are both
 * an administrator's to change, and a church may define a role of its own; the
 * bundle may only ever contain capabilities the application implements, which
 * `domain/capabilities.ts` owns and `config/schema.ts` enforces by dropping
 * anything else.
 *
 * ## The separation this rests on
 *
 * Nothing in the application may ask *which role is this?*. Every rule asks
 * what the viewer **may do**, and a role's only job is to answer that. So
 * renaming "Bishop" changes nothing about access, and defining "Regional
 * Overseer" grants exactly the capabilities somebody ticked — no more, and no
 * code change. The guard is `roles-are-not-permissions.test.ts`.
 *
 * A person's *title* is a third thing again: free text on their record, which
 * authorizes nothing.
 */

export interface RoleDefinition {
  id: PersonaId;
  label: string;
  focus: string;
  capabilities: Capability[];
}

/**
 * The roles this installation offers now.
 *
 * Read through the registry on every call rather than captured once, so an
 * administrator's change is effective on the next request and not the next
 * deployment. The shipped four live in `config/files/roles.json`.
 */
export function currentRoles(): RoleDefinition[] {
  return config.options("people.roles").map((option) => ({
    id: option.id,
    label: option.label,
    focus: (option as { description?: string }).description ?? "",
    capabilities: (((option as { capabilities?: string[] }).capabilities ?? []) as string[]).filter(
      isCapability,
    ),
  }));
}

/**
 * The roles as they shipped.
 *
 * A snapshot taken at import, so it is **not** what this church offers — only
 * the guard test, which checks the shipped bundles against the closed
 * capability set, has any business reading it. Everything else asks
 * `currentRoles()`.
 */
export const roles: RoleDefinition[] = currentRoles();

/** The ids this installation offers now. */
export const roleIds = (): PersonaId[] => currentRoles().map((role) => role.id);

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === "string" && currentRoles().some((role) => role.id === value);
}

/**
 * The least privileged role.
 *
 * Used when a record names a role that no longer exists, so that a bad value
 * fails closed rather than open.
 */
export const LEAST_PRIVILEGED: PersonaId = "leader";

export function roleById(id: PersonaId): RoleDefinition {
  const offered = currentRoles();
  return (
    offered.find((role) => role.id === id) ??
    offered.find((role) => role.id === LEAST_PRIVILEGED) ??
    offered[0]!
  );
}

/**
 * The role, bound to the person who holds it.
 *
 * `Persona` is the shape the access rules already read, and they read
 * `personId` — so binding happens here, from a real person, rather than from a
 * table of pretend ones.
 */
export function personaFor(roleId: PersonaId, personId: string): Persona {
  const role = roleById(isPersonaId(roleId) ? roleId : LEAST_PRIVILEGED);
  /* Belt and braces. The registry already drops a capability this build does
     not implement; a persona is what every rule reads, so it is filtered again
     here rather than trusted. */
  return {
    ...role,
    capabilities: role.capabilities.filter((capability): capability is Capability =>
      isCapability(capability),
    ),
    personId,
  };
}
