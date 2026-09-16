import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { EscalationSourceType, RecipientRole } from "@/domain/escalation";

/**
 * Asking something of leadership, over the wire.
 *
 * Reading the inbox, raising an ask, moving one along, answering a question
 * about one's own ask, withdrawing one, and
 * the small reading layer beside it — what this person has opened.
 *
 * There is deliberately no endpoint that turns a submitted report into an
 * obligation. Obligations are created by people, one at a time, saying what
 * they need.
 */

export type LeadershipInbox = import("@/server/services/escalation-service").LeadershipInbox;
export type EscalationView = import("@/server/services/escalation-service").EscalationView;

type Service = import("@/server/services/escalation-service").EscalationService;
type Viewer = import("@/domain/viewer").Viewer;

async function withEscalations<T>(
  work: (service: Service, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createEscalationRepository },
    { createOrganizationRepository },
    { createEscalationService },
    { createLeadershipReportRepository },
    { createLeadershipReportService },
    { getRequest },
    { noticeMailerFor },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/escalation-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/services/escalation-service"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/services/leadership-report-service"),
    import("@tanstack/react-start/server"),
    import("@/server/notices/notice-mailer"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);
    /*
     * Reports are handed in as "what this viewer may already discover", so
     * the attention projection can never widen access: it reads a list that
     * was gated before it arrived.
     */
    const service = createEscalationService(
      createEscalationRepository(db),
      createOrganizationRepository(db),
      {
        discoverable: (viewer) =>
          createLeadershipReportService(
            createLeadershipReportRepository(db),
            createOrganizationRepository(db),
          ).list(viewer).reports,
      },
      /* Asks are emailed to the people asked who chose that; never fails the ask. */
      await noticeMailerFor(db),
    );
    return { data: work(service, requireCurrentUser(getRequest(), db)) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved. Please try again." } };
  }
}

export const fetchInbox = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withEscalations((service, viewer) => service.inbox(viewer)));

export const fetchEscalationsFor = createServerFn({ method: "GET" })
  .validator((input: { sourceType: EscalationSourceType; sourceId: string }) => input)
  .handler(({ data }) =>
    withEscalations((service, viewer) => service.forSource(viewer, data.sourceType, data.sourceId)),
  );

/** Ask for attention, an action, or a decision. */
export const raiseEscalation = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => withEscalations((service, viewer) => service.raise(viewer, data)));

export const moveEscalation = createServerFn({ method: "POST" })
  .validator((input: { id: string; status: string; note?: string; assigneeId?: string }) => input)
  .handler(({ data }) => withEscalations((service, viewer) => service.move(viewer, data)));

export const withdrawEscalation = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(({ data }) =>
    withEscalations((service, viewer) => {
      service.withdraw(viewer, data.id);
      return { id: data.id };
    }),
  );

/** The person who asked answers a question about it, returning it to the recipient. */
export const replyToEscalation = createServerFn({ method: "POST" })
  .validator((input: { id: string; note: string }) => input)
  .handler(({ data }) => withEscalations((service, viewer) => service.reply(viewer, data)));

/** Which positions this viewer holds, and who a semantic recipient is now. */
export const fetchMyRoles = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withEscalations((service, viewer): RecipientRole[] => service.roles(viewer)));

/* ------------------------------------------------------------ read state */

type ReadRepo = import("@/server/repositories/escalation-repository").ReadStateRepository;

async function withReadState<T>(work: (repo: ReadRepo, personId: string) => T): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createReadStateRepository },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/escalation-repository"),
    import("@tanstack/react-start/server"),
  ]);

  try {
    const db = getDatabase();
    /* An administrator\'s configuration is effective on the next request,
       not the next deployment. */
    refreshConfiguration(db);
    const viewer = requireCurrentUser(getRequest(), db);
    return { data: work(createReadStateRepository(db), viewer.person.id) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved." } };
  }
}

export interface ReadRecord {
  itemType: string;
  itemId: string;
  lastViewedAt: string;
}

/**
 * What this person has read.
 *
 * A reading state and nothing else. Nothing here can make an unread item
 * overdue, because unread is not a deadline — it is a fact about whether
 * somebody has opened something yet.
 */
export const fetchReadState = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withReadState((repo, personId): ReadRecord[] => repo.allRead(personId)));

export const markRead = createServerFn({ method: "POST" })
  .validator((input: { itemType: string; itemId: string; read?: boolean }) => input)
  .handler(({ data }) =>
    withReadState((repo, personId): ReadRecord[] => {
      if (data.read === false) repo.markUnread(personId, data.itemType, data.itemId);
      else repo.markRead(personId, data.itemType, data.itemId);
      return repo.allRead(personId);
    }),
  );

/**
 * Several things seen at once — what opening the notices panel records.
 *
 * Seen is the same fact `markRead` records, for the items the panel showed as
 * new. It says nothing about whether the work is done; the asks and tasks stay
 * exactly where they are.
 */
export const markSeen = createServerFn({ method: "POST" })
  .validator((input: { items: { itemType: string; itemId: string }[] }) => {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length > 100) throw new Error("Too many items at once.");
    return {
      items: items.filter(
        (item) =>
          (item?.itemType === "escalation" || item?.itemType === "meeting-task") &&
          typeof item.itemId === "string" &&
          item.itemId.length > 0 &&
          item.itemId.length <= 200,
      ),
    };
  })
  .handler(({ data }) =>
    withReadState((repo, personId): ReadRecord[] => {
      for (const item of data.items) repo.markRead(personId, item.itemType, item.itemId);
      return repo.allRead(personId);
    }),
  );
