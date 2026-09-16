import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { PageMeta } from "./api-envelope";
import type { MeetingNote, MeetingTask } from "@/domain/types";

/**
 * Meeting Notes' API.
 *
 * Same shape and the same constraints as the calendar's — see
 * `docs/architecture/api-boundary.md` for why these are server functions rather
 * than HTTP routes, why they live in `lib/` rather than `server/`, and why the
 * database layer is imported lazily inside each handler.
 */

export interface NotePage {
  notes: MeetingNote[];
  tasks: MeetingTask[];
  page: PageMeta;
  /** Filter options across everything readable, not just this page. */
  facets: { tags: string[]; ministryIds: string[] };
}

async function withMeetings<T>(
  work: (service: MeetingService, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createMeetingRepository },
    { createMeetingService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/meeting-repository"),
    import("@/server/services/meeting-service"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);

    const service = createMeetingService(createMeetingRepository(db));
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return {
      error: { code: "internal", message: "Something went wrong saving that. Please try again." },
    };
  }
}

type MeetingService = import("@/server/services/meeting-service").MeetingService;
type Viewer = import("@/domain/viewer").Viewer;

/* ------------------------------------------------------------------ reads */

export const fetchNotes = createServerFn({ method: "GET" })
  .validator((input: unknown) => input)
  .handler(({ data }) =>
    withMeetings((service, viewer): NotePage => {
      const { notes, page, facets } = service.listNotes(viewer, data);
      return {
        notes,
        facets,
        /* The list counts decisions and open tasks per note, so they travel
           with the page rather than as one request per row. */
        tasks: service.tasksForNotes(
          viewer,
          notes.map((n) => n.id),
        ),
        page,
      };
    }),
  );

export const fetchNote = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => withMeetings((service, viewer) => service.getNote(viewer, data.id)));

/* ----------------------------------------------------------------- writes */

export const createNote = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withMeetings((service, viewer) => service.createNote(viewer, data)));

export const updateNote = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown; expectedVersion?: number }) => input)
  .handler(({ data }) =>
    withMeetings((service, viewer) =>
      service.updateNote(viewer, data.id, data.patch, data.expectedVersion),
    ),
  );

export const deleteNote = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withMeetings((service, viewer) => {
      service.deleteNote(viewer, data.id);
      return null;
    }),
  );

/* ------------------------------------------------------------------ tasks */

export const createMeetingTask = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withMeetings((service, viewer) => service.createTask(viewer, data)));

export const updateMeetingTask = createServerFn({ method: "POST" })
  .validator((input: { id: string; patch: unknown }) => input)
  .handler(({ data }) =>
    withMeetings((service, viewer) => service.updateTask(viewer, data.id, data.patch)),
  );

export const deleteMeetingTask = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withMeetings((service, viewer) => {
      service.deleteTask(viewer, data.id);
      return null;
    }),
  );

/**
 * Every task assigned to this leader, whatever meeting produced it.
 *
 * The one call that lets a meeting task be part of a leader's own workspace
 * rather than something they must go back into a meeting to find. It returns
 * the task and a label for where it came from — and that label is neutral when
 * the viewer may not read the note, because the responsibility is theirs to
 * know and the note is not.
 */
export const fetchMyTasks = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withMeetings(
      (
        service,
        viewer,
      ): { task: MeetingTask; contextLabel: string; readable: boolean; byYou: boolean }[] =>
        service.myTasks(viewer),
    ),
  );
