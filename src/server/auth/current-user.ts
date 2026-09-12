import { viewerFor } from "./principal";
import type { Database as Db } from "better-sqlite3";
import type { Viewer } from "@/domain/viewer";

/**
 * Who is signed in.
 *
 * ## What this used to be
 *
 * A person id, read out of a cookie the browser could set to anybody's. Every
 * authorization rule in Oikonomia was real, enforced server-side — and
 * evaluated against that. Changing one string in a browser's developer tools
 * was enough to become the bishop.
 *
 * ## What it is now
 *
 * A **session the server issued**, in an `HttpOnly` cookie script cannot read,
 * naming a row the server wrote, which names an account, which names a person.
 * `principal.ts` is the only place that chain is walked, and this is the only
 * name the rest of the application knows it by.
 *
 * It can still answer "nobody", and that is still the honest outcome: a new
 * installation has no accounts, a session expires, an account is suspended, a
 * person is deactivated. A handler that cannot say who is calling must refuse
 * rather than fall back to a pretend leader and answer anyway.
 */
export function getCurrentUser(request: Request, db: Db): Viewer | undefined {
  return viewerFor(request, db);
}

export {
  SESSION_COOKIE,
  sessionCookie,
  clearSessionCookie,
  principalFor,
  type Principal,
} from "./principal";
