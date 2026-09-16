import { text } from "@/config/messages";
import type { Database as Db } from "better-sqlite3";

import { ApiError } from "../api/response";
import { getCurrentUser } from "./current-user";
import type { Viewer } from "@/domain/viewer";

/**
 * The viewer, or a refusal.
 *
 * Handlers used to be handed a viewer unconditionally, because identity came
 * from a table of personas compiled into the application. Identity is a record
 * now, so "nobody" is a real answer — on a fresh installation it is the *only*
 * answer — and every handler has to deal with it.
 *
 * Dealing with it means refusing. Answering with data while unable to say who
 * asked is how an access model stops meaning anything.
 */
export function requireCurrentUser(request: Request, db: Db): Viewer {
  const viewer = getCurrentUser(request, db);
  if (!viewer) {
    throw ApiError.unauthenticated(text("refusal.auth.nothingToShow"));
  }
  return viewer;
}
