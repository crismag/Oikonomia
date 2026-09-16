import type { Database as Db } from "better-sqlite3";

import { nowIso } from "../db/records";

/**
 * What has been published to the church's Google Calendar.
 *
 * Bookkeeping, not a copy of the event: the Oikonomia record stays the truth,
 * and a row here only remembers which Google event it became and how the last
 * attempt went (migration 045).
 */

export type PublishedSource = "schedule-entry" | "gathering";

export interface Publication {
  sourceType: PublishedSource;
  sourceId: string;
  calendarId: string;
  googleEventId?: string;
  lastSyncedAt?: string;
  lastAttemptAt: string;
  lastError?: string;
}

interface Row {
  source_type: PublishedSource;
  source_id: string;
  calendar_id: string;
  google_event_id: string | null;
  last_synced_at: string | null;
  last_attempt_at: string;
  last_error: string | null;
}

const toPublication = (row: Row): Publication => ({
  sourceType: row.source_type,
  sourceId: row.source_id,
  calendarId: row.calendar_id,
  ...(row.google_event_id ? { googleEventId: row.google_event_id } : {}),
  ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
  lastAttemptAt: row.last_attempt_at,
  ...(row.last_error ? { lastError: row.last_error } : {}),
});

export function createCalendarPublicationRepository(db: Db) {
  return {
    find(sourceType: PublishedSource, sourceId: string): Publication | undefined {
      const row = db
        .prepare("SELECT * FROM calendar_publication WHERE source_type = ? AND source_id = ?")
        .get(sourceType, sourceId) as Row | undefined;
      return row ? toPublication(row) : undefined;
    },

    all(): Publication[] {
      return (db.prepare("SELECT * FROM calendar_publication").all() as Row[]).map(toPublication);
    },

    /** Google has the event as it now stands. */
    synced(sourceType: PublishedSource, sourceId: string, calendarId: string, eventId: string) {
      const now = nowIso();
      db.prepare(
        `INSERT INTO calendar_publication
           (source_type, source_id, calendar_id, google_event_id, last_synced_at, last_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (source_type, source_id) DO UPDATE SET
           calendar_id = excluded.calendar_id,
           google_event_id = excluded.google_event_id,
           last_synced_at = excluded.last_synced_at,
           last_attempt_at = excluded.last_attempt_at,
           last_error = NULL`,
      ).run(sourceType, sourceId, calendarId, eventId, now, now);
    },

    /**
     * The attempt failed. Whatever was published before is still remembered,
     * so the retry updates it rather than adding another.
     */
    failed(sourceType: PublishedSource, sourceId: string, calendarId: string, error: string) {
      const now = nowIso();
      db.prepare(
        `INSERT INTO calendar_publication
           (source_type, source_id, calendar_id, last_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (source_type, source_id) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           last_error = excluded.last_error`,
      ).run(sourceType, sourceId, calendarId, now, error);
    },

    remove(sourceType: PublishedSource, sourceId: string): void {
      db.prepare("DELETE FROM calendar_publication WHERE source_type = ? AND source_id = ?").run(
        sourceType,
        sourceId,
      );
    },
  };
}

export type CalendarPublicationRepository = ReturnType<typeof createCalendarPublicationRepository>;
