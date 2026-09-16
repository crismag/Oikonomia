import type { Database as Db } from "better-sqlite3";

import { config as siteConfig } from "@/config";
import { siteUrl } from "../auth/site-url";
import { createCalendarPublicationRepository } from "../repositories/calendar-publication-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import {
  createCalendarPublisher,
  publishingConfig,
  type MappingContext,
  type RealCalendarPublisher,
} from "./calendar";

/**
 * The real publisher, assembled for the process.
 *
 * Kept per database rather than per request: the publisher serialises the
 * attempts for each record, and two requests a second apart each with their
 * own queue would race into two Google events for one entry.
 */

const publishers = new WeakMap<Db, RealCalendarPublisher>();

/** Undefined when publishing is off — no Workspace, no church calendar, or a demonstration. */
export function calendarPublisherFor(db: Db): RealCalendarPublisher | undefined {
  const config = publishingConfig();
  if (!config) return undefined;

  const existing = publishers.get(db);
  if (existing) return existing;

  const organization = createOrganizationRepository(db);
  const context = (): MappingContext => {
    let url: string | undefined;
    try {
      url = siteUrl();
    } catch {
      /* A production server without its own address publishes without a link
         rather than not at all. */
      url = undefined;
    }
    return {
      timeZone: siteConfig.site.timezone,
      ...(url ? { siteUrl: url } : {}),
      ministryName: (id) => organization.findMinistry(id)?.name,
      venueName: (id) => organization.findVenue(id)?.name,
    };
  };

  const publisher = createCalendarPublisher({
    config,
    publications: createCalendarPublicationRepository(db),
    context,
  });
  publishers.set(db, publisher);
  return publisher;
}
