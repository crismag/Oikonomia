import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  publishingStatus,
  readOverlay,
  type Overlay,
  type PublishAllResult,
  type PublishingStatus,
  type RealCalendarPublisher,
} from "../google/calendar";
import type { WorkspaceConfig } from "../google/workspace";
import type { CalendarPublicationRepository } from "../repositories/calendar-publication-repository";
import type { Gathering, ScheduleEntry } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Google Calendar decisions: who may publish everything, and whose calendar a
 * leader may lay over their week.
 *
 * - **Publishing all** and its status are an administrator's — the
 *   `administration` capability, never a role name.
 * - **The overlay** is the viewer's own calendar and nobody else's. There is no
 *   input naming whose: the address is the viewer's own person record, so no
 *   request can ask for somebody else's week.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-14.");

export const overlayRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((range) => range.from <= range.to, { message: "The range ends before it starts." })
  /* A week or a month grid (six weeks). Anything longer is not what a screen
     here draws, and a whole year of somebody's calendar is not asked for. */
  .refine((range) => differenceInCalendarDays(parseISO(range.to), parseISO(range.from)) <= 45, {
    message: "Ask for a week or a month at a time.",
  });

export interface GoogleCalendarServiceParts {
  /** The publisher, when the church publishes a calendar. */
  publisher?: Pick<RealCalendarPublisher, "publishAll" | "settled">;
  publications: CalendarPublicationRepository;
  calendarId?: string;
  records: { entries: () => ScheduleEntry[]; gatherings: () => Gathering[] };
  /** The Workspace configuration, or undefined when there is none (or a demonstration). */
  workspace: () => WorkspaceConfig | undefined;
  /** The address on this person's own record. */
  emailOf: (personId: string) => string | undefined;
  timeZone: () => string;
}

export type CalendarPublishingView = PublishingStatus & { lastRun?: PublishAllResult };

function requireAdministration(viewer: Viewer) {
  if (!viewer.persona.capabilities.includes("administration")) {
    throw ApiError.forbidden("Publishing the church calendar is an administrator's to manage.");
  }
}

export function createGoogleCalendarService(parts: GoogleCalendarServiceParts) {
  return {
    publishingStatus(viewer: Viewer): PublishingStatus {
      requireAdministration(viewer);
      return publishingStatus(parts.publications, parts.publisher ? parts.calendarId : undefined);
    },

    async publishAll(viewer: Viewer): Promise<CalendarPublishingView> {
      requireAdministration(viewer);
      if (!parts.publisher) {
        throw ApiError.conflict(
          "No church calendar is set. Set OIKONOMIA_GOOGLE_CALENDAR_ID on the server first.",
        );
      }
      const lastRun = await parts.publisher.publishAll({
        entries: parts.records.entries(),
        gatherings: parts.records.gatherings(),
      });
      return { ...publishingStatus(parts.publications, parts.calendarId), lastRun };
    },

    /** The viewer's own Google Calendar for a range. Read-only; nothing is kept. */
    async overlay(viewer: Viewer, input: unknown): Promise<Overlay> {
      const range = parse(overlayRange, input);
      return readOverlay(
        parts.workspace(),
        parts.emailOf(viewer.person.id),
        range,
        parts.timeZone(),
      );
    },
  };
}

export type GoogleCalendarService = ReturnType<typeof createGoogleCalendarService>;
