import { personaById, personById } from "@/test/fixtures";
import { viewerOf, type Viewer } from "@/domain/viewer";
import type { PersonaId } from "@/domain/types";

/**
 * A viewer, for tests.
 *
 * The application builds a viewer from a person record somebody entered. A
 * test has no such person unless it makes one, so this binds the narrative
 * fixtures to the four roles the way the old prototype did — Maria is the
 * leader, Joel the ministry head, and so on — and keeps every existing test
 * readable.
 *
 * **Test-only.** `src/no-sample-data.test.ts` fails if anything in the running
 * application imports this file or the fixtures behind it.
 */
export function viewerFor(personaId: PersonaId): Viewer {
  const persona = personaById(personaId);
  return viewerOf({ ...personById(persona.personId), accessRole: personaId });
}
