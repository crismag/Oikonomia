import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
export type EmailNoticeSettings =
  import("@/server/services/notice-email-service").EmailNoticeSettings;

/**
 * Which notices reach you by email — yours to read and change, nobody else's.
 *
 * The person is always the signed-in viewer; neither function takes a person
 * id. Whether this installation can send mail is on the session
 * (`emailDeliveryConfigured`), not here, so the page can say so beside the
 * switches.
 */

type Service = import("@/server/services/notice-email-service").NoticeEmailService;
type Viewer = import("@/domain/viewer").Viewer;

async function withNoticeEmail<T>(
  work: (service: Service, viewer: Viewer) => T,
): Promise<Result<T>> {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createNoticeEmailRepository },
    { createNoticeEmailService },
    { getRequest },
    { createOrganizationRepository },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/notice-email-repository"),
    import("@/server/services/notice-email-service"),
    import("@tanstack/react-start/server"),
    import("@/server/repositories/organization-repository"),
  ]);

  try {
    const db = getDatabase();
    refreshConfiguration(db);
    const viewer = requireCurrentUser(getRequest(), db);
    const organization = createOrganizationRepository(db);
    const service = createNoticeEmailService(
      createNoticeEmailRepository(db),
      (personId) => organization.findPerson(personId)?.email,
    );
    return { data: work(service, viewer) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be saved." } };
  }
}

export const fetchEmailNotices = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withNoticeEmail((service, viewer): EmailNoticeSettings => service.mine(viewer)));

export const setEmailNotice = createServerFn({ method: "POST" })
  .validator((input: { kind: string; enabled: boolean }) => input)
  .handler(({ data }) =>
    withNoticeEmail((service, viewer): EmailNoticeSettings => service.set(viewer, data)),
  );
