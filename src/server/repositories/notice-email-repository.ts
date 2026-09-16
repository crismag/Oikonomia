import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";
import {
  EMAIL_NOTICE_KINDS,
  noEmailNotices,
  type EmailNoticeKind,
  type EmailNoticePreferences,
} from "@/domain/email-notices";

/**
 * Which notices a person wants by email (migration 043).
 *
 * A row is a yes. Kinds the domain no longer names are ignored when read, so a
 * retired kind cannot come back as a switch nobody can see to turn off.
 */
export function createNoticeEmailRepository(db: Db) {
  const known = new Set<string>(EMAIL_NOTICE_KINDS);

  return {
    preferencesOf(personId: string): EmailNoticePreferences {
      const rows = db
        .prepare("SELECT kind FROM notice_email_preference WHERE person_id = ?")
        .all(personId) as { kind: string }[];
      const preferences = noEmailNotices();
      for (const { kind } of rows) {
        if (known.has(kind)) preferences[kind as EmailNoticeKind] = true;
      }
      return preferences;
    },

    wants(personId: string, kind: EmailNoticeKind): boolean {
      return Boolean(
        db
          .prepare("SELECT 1 FROM notice_email_preference WHERE person_id = ? AND kind = ?")
          .get(personId, kind),
      );
    },

    set(personId: string, kind: EmailNoticeKind, enabled: boolean): void {
      if (enabled) {
        db.prepare(
          `INSERT INTO notice_email_preference (person_id, kind, enabled_at)
           VALUES (?, ?, ?)
           ON CONFLICT (person_id, kind) DO NOTHING`,
        ).run(personId, kind, nowIso());
      } else {
        db.prepare("DELETE FROM notice_email_preference WHERE person_id = ? AND kind = ?").run(
          personId,
          kind,
        );
      }
    },
  };
}

export type NoticeEmailRepository = ReturnType<typeof createNoticeEmailRepository>;
