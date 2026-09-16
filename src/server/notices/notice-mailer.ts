import type { DeliveryAdapter } from "../auth/delivery";
import type { ComposedEmail, EmailNoticeKind } from "@/domain/email-notices";
import type { Person, PersonaId } from "@/domain/types";

/**
 * Sending a notice by email, for the people who asked for it.
 *
 * ## Where the rules live
 *
 * Services decide *that* something happened and *who* it concerns — they own
 * the write and know who was asked or assigned. This decides who of those
 * actually receives an email, and it is the same for every kind:
 *
 * - never the person who acted: doing something is not news to yourself;
 * - only people who turned that kind on (default off);
 * - only people with an address, who are still part of the church.
 *
 * ## Why it cannot fail a write
 *
 * The ask or the task is the record; the email is a courtesy about it. A
 * Google outage must not make "Assign" fail, so `notify` never throws and
 * never waits: each message is handed to delivery and its failure is logged
 * with the kind and recipient id, never the message.
 */

/** A person as the organisation stores them: enough to address, and to ask what they may read. */
export interface NoticeRecipient extends Person {
  email?: string;
  accessRole?: PersonaId;
}

export interface Notice {
  kind: EmailNoticeKind;
  /** Who did the thing. Never emailed about it. */
  actorId: string;
  recipientIds: readonly string[];
  /** The message for one recipient; the recipient decides what it may say. */
  compose: (context: {
    recipient: NoticeRecipient;
    actor: NoticeRecipient | undefined;
    /** This installation's address, for links. */
    base: string;
  }) => ComposedEmail;
}

export interface NoticeMailer {
  notify(notice: Notice): void;
}

export function createNoticeMailer(deps: {
  wants: (personId: string, kind: EmailNoticeKind) => boolean;
  findPerson: (id: string) => NoticeRecipient | undefined;
  /** Asked at send time, so Demo Mode's suppression is always consulted. */
  delivery: () => DeliveryAdapter;
  /** `siteUrl()`: throws in production when unset, which sends nothing. */
  baseUrl: () => string;
}): NoticeMailer {
  return {
    notify(notice) {
      try {
        const recipients = [...new Set(notice.recipientIds)]
          .filter((id) => id !== notice.actorId)
          .filter((id) => deps.wants(id, notice.kind))
          .map((id) => deps.findPerson(id))
          .filter((person): person is NoticeRecipient & { email: string } =>
            Boolean(person?.email && person.active !== false),
          );
        if (recipients.length === 0) return;

        const actor = deps.findPerson(notice.actorId);
        const base = deps.baseUrl();
        const adapter = deps.delivery();
        for (const recipient of recipients) {
          const failed = (error: unknown) =>
            console.error(
              `[notices] ${notice.kind} email to ${recipient.id} was not sent:`,
              error instanceof Error ? error.message : error,
            );
          try {
            const message = notice.compose({ recipient, actor, base });
            adapter.send({ to: recipient.email, ...message }).catch(failed);
          } catch (error) {
            failed(error);
          }
        }
      } catch (error) {
        console.error(
          `[notices] ${notice.kind} emails were not sent:`,
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}

/** The mailer for a real request: this database's people and preferences. */
export async function noticeMailerFor(
  db: import("better-sqlite3").Database,
): Promise<NoticeMailer> {
  const [
    { createNoticeEmailRepository },
    { createOrganizationRepository },
    { delivery },
    { siteUrl },
  ] = await Promise.all([
    import("../repositories/notice-email-repository"),
    import("../repositories/organization-repository"),
    import("../auth/delivery"),
    import("../auth/site-url"),
  ]);
  const preferences = createNoticeEmailRepository(db);
  const organization = createOrganizationRepository(db);
  return createNoticeMailer({
    wants: preferences.wants,
    findPerson: (id) => organization.findPerson(id),
    delivery,
    baseUrl: siteUrl,
  });
}
