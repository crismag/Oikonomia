import { personaFor, isPersonaId, LEAST_PRIVILEGED } from "./roles";
import type { Person, PersonaId } from "./types";

/**
 * Who is looking.
 *
 * One definition of "the current user", shared by the browser and the server,
 * so that no component and no request handler has to know how identity is
 * established.
 *
 * A viewer is now built from a **person record** — somebody who was entered
 * into this installation — rather than from a table of demonstration personas
 * compiled into the application. An installation with nobody in it has no
 * viewer at all, which is why every caller has to handle that case instead of
 * quietly falling back to a fictional leader.
 *
 * > **This is still not authentication.** Nothing here verifies a claim. The
 * > caller states which person it is and is believed. See
 * > `src/server/auth/current-user.ts`.
 */

export interface Viewer {
  persona: import("./types").Persona;
  person: Person;
}

export { isPersonaId, LEAST_PRIVILEGED, roleIds as personaIds } from "./roles";

/** Build a viewer from a person and the access role on their record. */
export function viewerOf(person: Person & { accessRole?: PersonaId }): Viewer {
  const role = isPersonaId(person.accessRole) ? person.accessRole : LEAST_PRIVILEGED;
  return { persona: personaFor(role, person.id), person };
}
