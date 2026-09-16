import { z } from "zod";

import { parse } from "../api/validation";
import { EMAIL_NOTICE_KINDS, type EmailNoticePreferences } from "@/domain/email-notices";
import type { NoticeEmailRepository } from "../repositories/notice-email-repository";
import type { Viewer } from "@/domain/viewer";

/**
 * A person's own choice of which notices reach them by email.
 *
 * There is no way to read or set anybody else's: the person is always the
 * signed-in viewer, never an id from the request. Whether mail can actually
 * be sent is the installation's business and is not checked here — a
 * preference made before mail is configured takes effect once it is.
 */

const setPreference = z.object({
  kind: z.enum(EMAIL_NOTICE_KINDS),
  enabled: z.boolean(),
});

export interface EmailNoticeSettings {
  preferences: EmailNoticePreferences;
  /**
   * Where notices would go: the address on this person's record, which is
   * what the mailer uses — not necessarily the one they sign in with.
   */
  address?: string;
}

export function createNoticeEmailService(
  repo: NoticeEmailRepository,
  emailOf: (personId: string) => string | undefined,
) {
  const settingsOf = (viewer: Viewer): EmailNoticeSettings => {
    const address = emailOf(viewer.person.id);
    return { preferences: repo.preferencesOf(viewer.person.id), ...(address ? { address } : {}) };
  };

  return {
    mine: settingsOf,

    set(viewer: Viewer, input: unknown): EmailNoticeSettings {
      const { kind, enabled } = parse(setPreference, input);
      repo.set(viewer.person.id, kind, enabled);
      return settingsOf(viewer);
    },
  };
}

export type NoticeEmailService = ReturnType<typeof createNoticeEmailService>;
