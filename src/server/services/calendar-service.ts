import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  createAgendaItem,
  createEntry,
  entryAfterPatch,
  entryRange,
  updateAgendaItem,
  updateEntry,
} from "@/domain/calendar-contract";
import { canEdit } from "@/domain/authorize";
import { endBefore, skipOccurrence } from "@/domain/schedule";
import type { CalendarRepository, EntryValues } from "../repositories/calendar-repository";
import type { AgendaItem, RecurrenceScope, ScheduleEntry } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Calendar decisions.
 *
 * Everything that is a judgement rather than a query: who may do this, is the
 * request valid, and what does "delete this occurrence" mean for a rhythm that
 * repeats. The repository below holds no opinions; the routes above hold no
 * rules.
 *
 * The occurrence-scope logic is deliberately lifted from the provider rather
 * than reinvented — it was already correct, and moving it here is the point of
 * the slice: the rule now applies to every caller, not only to the one screen
 * that happened to call it.
 */

export function createCalendarService(repo: CalendarRepository) {
  /** Load, or refuse in a way that does not confirm the record exists. */
  function require(id: string): ScheduleEntry {
    const entry = repo.findEntry(id);
    if (!entry) throw ApiError.notFound("That calendar entry");
    return entry;
  }

  function requireEditable(viewer: Viewer, id: string): ScheduleEntry {
    const entry = require(id);
    if (!canEdit(viewer, { kind: "schedule-entry", entry })) {
      /*
       * `forbidden`, not `not-found`: the viewer can already see this entry on
       * the calendar, so hiding its existence would only be confusing. The
       * withholding case is the one above, where they cannot.
       */
      throw ApiError.forbidden("This entry is not yours to change.");
    }
    return entry;
  }

  /**
   * Load an agenda item the viewer may act on, or refuse as if it did not
   * exist: another leader's agenda is not something to confirm the shape of.
   */
  function requireAgendaItem(viewer: Viewer, id: string): AgendaItem {
    const item = repo.findAgendaItem(id);
    const me = viewer.person.id;
    const mine =
      item &&
      (item.createdBy === me || item.assigneeId === me || (!item.createdBy && !item.assigneeId));
    if (!mine) throw ApiError.notFound("That agenda item");
    return item;
  }

  return {
    /**
     * What is on the calendar between two dates.
     *
     * The whole calendar is readable — it is shared working information, and
     * `canView` on a schedule entry is true for everyone. The agenda is not: it
     * is the viewer's own, plus what was put on it for them.
     */
    listRange(viewer: Viewer, input: unknown) {
      const range = parse(entryRange, input);
      return {
        entries: repo.entriesInRange(range.from, range.to),
        agenda: repo.agendaInRange(range.from, range.to, viewer.person.id),
      };
    },

    getEntry(_viewer: Viewer, id: string): ScheduleEntry {
      return require(id);
    },

    createEntry(viewer: Viewer, input: unknown): ScheduleEntry {
      const values = parse(createEntry, input);
      return repo.insertEntry({
        ...values,
        /* Provenance, not classification: a leader's own entry. */
        source: values.source ?? "leader",
        createdBy: viewer.person.id,
      } as EntryValues);
    },

    /**
     * Edit, at the scope the leader chose.
     *
     * "This occurrence" lifts that one day out of the rhythm as its own entry
     * and skips the date in the series, so the other weeks are untouched —
     * which is what the phrase has to mean. "This and following" ends the old
     * rhythm the day before and starts a new one. Neither rewrites history.
     */
    updateEntry(
      viewer: Viewer,
      id: string,
      input: unknown,
      occurrenceDate?: string,
      scope: RecurrenceScope = "series",
    ): ScheduleEntry {
      const entry = requireEditable(viewer, id);
      const patch = parse(updateEntry, input);

      const merged = { ...stripMeta(entry), ...patch };
      /* Moving a repeating entry to a fixed date ends the rhythm. */
      if (patch.date && merged.recurrence) delete (merged as { recurrence?: unknown }).recurrence;
      const values = parse(entryAfterPatch, merged) as EntryValues;

      if (!entry.recurrence || scope === "series") {
        const saved = repo.saveEntry(id, { ...values, createdBy: entry.createdBy });
        if (!saved) throw ApiError.notFound("That calendar entry");
        return saved;
      }

      if (!occurrenceDate) {
        throw ApiError.validation(
          { _: "Say which occurrence is being changed." },
          "This entry repeats.",
        );
      }

      if (scope === "occurrence") {
        repo.saveEntry(id, {
          ...stripMeta(entry),
          recurrence: skipOccurrence(entry.recurrence, occurrenceDate),
          createdBy: entry.createdBy,
        } as EntryValues);

        const detached = { ...values, date: patch.date ?? occurrenceDate };
        delete (detached as { recurrence?: unknown }).recurrence;
        return repo.insertEntry({ ...detached, createdBy: viewer.person.id } as EntryValues);
      }

      /* "This and following": stop the old rhythm, start a new one here. */
      repo.saveEntry(id, {
        ...stripMeta(entry),
        recurrence: endBefore(entry.recurrence, occurrenceDate),
        createdBy: entry.createdBy,
      } as EntryValues);

      const continued = {
        ...values,
        recurrence: { ...entry.recurrence, ...(patch.recurrence ?? {}), from: occurrenceDate },
      };
      delete (continued as { date?: unknown }).date;
      return repo.insertEntry({ ...continued, createdBy: viewer.person.id } as EntryValues);
    },

    /**
     * Delete, at the scope the leader chose.
     *
     * A rhythm ended before it ever ran leaves nothing behind, so it goes
     * rather than lingering as an entry with no occurrences.
     */
    deleteEntry(
      viewer: Viewer,
      id: string,
      occurrenceDate?: string,
      scope: RecurrenceScope = "series",
    ): void {
      const entry = requireEditable(viewer, id);

      if (!entry.recurrence || scope === "series") {
        repo.deleteEntry(id);
        return;
      }
      if (!occurrenceDate) {
        throw ApiError.validation(
          { _: "Say which occurrence is being removed." },
          "This entry repeats.",
        );
      }

      const recurrence =
        scope === "occurrence"
          ? skipOccurrence(entry.recurrence, occurrenceDate)
          : endBefore(entry.recurrence, occurrenceDate);

      if (recurrence.until && recurrence.until < recurrence.from) {
        repo.deleteEntry(id);
        return;
      }
      repo.saveEntry(id, { ...stripMeta(entry), recurrence, createdBy: entry.createdBy });
    },

    /** Church work repeats without being a formal series; copying is common. */
    duplicateEntry(viewer: Viewer, id: string, date: string): ScheduleEntry {
      const entry = require(id);
      const copy = { ...stripMeta(entry), title: `${entry.title} (copy)`, date };
      /* A copy is a one-off until the leader makes it a rhythm again. */
      delete (copy as { recurrence?: unknown }).recurrence;
      return repo.insertEntry({ ...copy, createdBy: viewer.person.id } as EntryValues);
    },

    /* ------------------------------------------------------------- agenda */

    createAgendaItem(viewer: Viewer, input: unknown): AgendaItem {
      const values = parse(createAgendaItem, input);
      if (values.relatedEntryId && !repo.findEntry(values.relatedEntryId)) {
        throw ApiError.validation({ relatedEntryId: "That entry no longer exists." });
      }
      return repo.insertAgendaItem({ ...values, createdBy: viewer.person.id });
    },

    updateAgendaItem(viewer: Viewer, id: string, input: unknown): AgendaItem {
      const existing = requireAgendaItem(viewer, id);

      const patch = parse(updateAgendaItem, input);
      const merged = { ...existing, ...patch };
      if (!merged.date && !merged.weekOf) {
        throw ApiError.validation({ date: "File it on a day, or on the week." });
      }

      /*
       * Ticking an item off means the leader did it. It raises no workflow
       * event, no audit record and no notification — SCHEDULE.md is explicit.
       * The only trace is when.
       */
      const completed = patch.completed ?? existing.completed;
      const completedAt = completed
        ? (existing.completedAt ?? new Date().toISOString())
        : undefined;

      const saved = repo.saveAgendaItem(id, {
        ...merged,
        /* `text` is required; a patch that omits it keeps what was there. */
        text: patch.text ?? existing.text,
        completed,
        /* Un-ticking clears the timestamp: an item that is not done was not
           done at any particular moment. Spreading `merged` would keep it. */
        completedAt: completedAt,
      });
      if (!saved) throw ApiError.notFound("That agenda item");
      return saved;
    },

    deleteAgendaItem(viewer: Viewer, id: string): void {
      requireAgendaItem(viewer, id);
      if (!repo.deleteAgendaItem(id)) throw ApiError.notFound("That agenda item");
    },
  };
}

/** Drop the fields the repository owns, so a merge cannot rewrite them. */
function stripMeta(entry: ScheduleEntry) {
  const { id: _id, ...rest } = entry;
  return rest;
}

export const entryIdInput = z.object({ id: z.string().min(1) });
export type CalendarService = ReturnType<typeof createCalendarService>;
