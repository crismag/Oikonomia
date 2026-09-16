import { text } from "@/config/messages";
import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";

/**
 * Google Workspace: what is set up, and whether Google agrees.
 *
 * Administrative. The status names no secret — no key, no client email — only
 * the domain, the church mailbox and which features are on.
 */

export type WorkspaceStatusView = import("@/server/google/workspace").WorkspaceStatus;

/**
 * Run `work` for a signed-in administrator, in the envelope every caller reads.
 *
 * Shared by the Workspace features' APIs so each resolves the viewer and
 * refuses the same way.
 */
export async function withWorkspace<T>(
  work: (parts: {
    viewer: import("@/domain/viewer").Viewer;
    db: import("better-sqlite3").Database;
    ApiError: typeof import("@/server/api/response").ApiError;
  }) => Promise<T> | T,
): Promise<Result<T>> {
  try {
    const [
      { ApiError },
      { requireCurrentUser },
      { getDatabase },
      { refreshConfiguration },
      { getRequest },
    ] = await Promise.all([
      import("@/server/api/response"),
      import("@/server/auth/require-user"),
      import("@/server/db/connection"),
      import("@/server/config/runtime"),
      import("@tanstack/react-start/server"),
    ]);
    const db = getDatabase();
    refreshConfiguration(db);
    try {
      return { data: await work({ viewer: requireCurrentUser(getRequest(), db), db, ApiError }) };
    } catch (error) {
      if (error instanceof ApiError) return { error: error.body() };
      throw error;
    }
  } catch (error) {
    const { ApiError } = await import("@/server/api/response");
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be done. Please try again." } };
  }
}

const requireAdministration = (
  viewer: import("@/domain/viewer").Viewer,
  ApiError: typeof import("@/server/api/response").ApiError,
) => {
  if (!viewer.persona.capabilities.includes("administration")) {
    throw ApiError.forbidden(text("refusal.googleWorkspace.admin"));
  }
};

export const fetchWorkspaceStatus = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withWorkspace(async ({ viewer, ApiError }) => {
      requireAdministration(viewer, ApiError);
      const { workspaceStatus } = await import("@/server/google/workspace");
      return workspaceStatus();
    }),
  );

export const checkWorkspaceConnection = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() =>
    withWorkspace(async ({ viewer, ApiError }) => {
      requireAdministration(viewer, ApiError);
      const { checkWorkspace } = await import("@/server/google/workspace");
      return checkWorkspace();
    }),
  );
