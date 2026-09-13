#!/usr/bin/env -S npx tsx
/**
 * Fill the operational gaps a curated-content import alone leaves empty.
 *
 *   npx tsx scripts/demo-content/build-operational-schedule.mts --to <builder.db>
 *
 * Run after `import-data-play.mts` and before `mark-demo-baseline.mjs`, against
 * the same builder database. The authoring corpus is rich in reports,
 * reflections and lifegroup story content, but it does not (and should not)
 * author routine operational scaffolding: a ministry meeting on the calendar
 * every week, a note on this week's agenda, the ministry that nobody's
 * profile happened to lead. Those are mechanical, not narrative, so this
 * script generates them directly rather than asking the content authors to
 * write "Tuesday, 10am, weekly" fifty times.
 *
 * Everything here goes through the same repositories `import-data-play.mts`
 * uses — no schema duplicated, no table written by hand.
 *
 * ## What this adds
 *
 * - **Ministry staffing**: any ministry that already has a lead and fewer
 *   than three confirmed team members is topped up from the pool of
 *   designated identities. A ministry with no lead is left exactly as
 *   written — the corpus may have a real narrative reason (Gifts and Arrows'
 *   vacancy is itself a Leadership Council goal). A ministry with no goal at
 *   all gets one.
 * - **Calendar**: one recurring weekly "ministry meeting" per ministry
 *   (`schedule_entry`, `Recurrence`), spanning August through the end of the
 *   year — so Monthly Calendar and Weekly Agenda, which read the same ranged
 *   query, are never empty for any ministry's leader.
 * - **Weekly Agenda**: a couple of items in the current week for every
 *   ministry lead and bishop, so "This week" has something in it the first
 *   time anyone looks, not only after they add something themselves.
 * - **LifeGroup**: a weekly Thursday gathering, August through the demo's
 *   "today", for every ministry lead or bishop the authored corpus never
 *   gave one — past occurrences completed with a short generic report,
 *   coming ones left open the way a real schedule is.
 *
 * Idempotent in the sense that matters: each of the four additions above
 * checks for its own prior existence (a ministry already having a recurring
 * entry, a person already having a gathering) before writing, so running it
 * twice does not double the calendar. It is still meant to run once, on a
 * freshly imported builder, before the baseline is marked.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import type { Ministry } from "@/domain/types";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = (path: string) => join(REPO_ROOT, "src", path);

const { createOrganizationRepository } = await import(
  repo("server/repositories/organization-repository.ts")
);
const { createCalendarRepository } = await import(
  repo("server/repositories/calendar-repository.ts")
);
const { createLifegroupRepository } = await import(
  repo("server/repositories/lifegroup-repository.ts")
);
const { createGoalsRepository } = await import(repo("server/repositories/goals-repository.ts"));

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const targetPath = option("to");
if (!targetPath) {
  console.error(
    "usage: npx tsx scripts/demo-content/build-operational-schedule.mts --to <builder.db>",
  );
  process.exit(1);
}
if (!existsSync(targetPath)) {
  console.error(`build-operational-schedule: no database at ${targetPath}.`);
  process.exit(1);
}

const db: Db = new Database(targetPath);
db.pragma("foreign_keys = ON");

const peopleCount = (db.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number }).n;
if (peopleCount === 0) {
  console.error(
    "build-operational-schedule: this database has no people yet — run import-data-play.mts first.",
  );
  process.exit(1);
}

const organization = createOrganizationRepository(db);
const calendar = createCalendarRepository(db);
const lifegroup = createLifegroupRepository(db);
const goals = createGoalsRepository(db);

/** "Today" for this demo build — matches the corpus's own active window. */
const TODAY = "2026-09-13";
const CAMPUS_ID = (db.prepare("SELECT id FROM campus LIMIT 1").get() as { id: string } | undefined)
  ?.id;

const richness = (personId: string): number =>
  (
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM leadership_report WHERE author_id = ?) +
           (SELECT COUNT(*) FROM gathering WHERE primary_leader_id = ?) AS n`,
      )
      .get(personId, personId) as { n: number }
  ).n;

const counts = {
  ministriesToppedUp: 0,
  ministryGoalsAdded: 0,
  recurringMinistryMeetings: 0,
  agendaItemsAdded: 0,
  lifegroupGatheringsAdded: 0,
};

const run = db.transaction(() => {
  /* --------------------------------------------------- 1. ministry staffing */

  const designated = (
    db
      .prepare(
        `SELECT p.id, p.name FROM demo_identity d JOIN person p ON p.id = d.person_id WHERE d.kind = 'designated'`,
      )
      .all() as { id: string; name: string }[]
  )
    .map((p) => ({ ...p, richness: richness(p.id) }))
    .sort((a, b) => b.richness - a.richness);

  /* A ministry with no lead is left exactly as the corpus wrote it: Gifts and
     Arrows is deliberately unled — the vacancy is itself a Leadership Council
     goal — and a script assigning one over that narrative would be a worse
     mistake than leaving a ministry looking incomplete. Only a ministry that
     already has a lead is topped up, when its confirmed, non-shared team —
     lead included — is thinner than three people ("one or two more"). */
  for (const ministry of organization.ministries()) {
    if (!ministry.leadId) continue;
    const teamSize = ministry.teamIds.length;
    if (teamSize >= 3) continue;
    const need = 3 - teamSize;
    const already = new Set(ministry.teamIds);
    const additions = designated.filter((p) => !already.has(p.id)).slice(0, need);
    for (const person of additions) {
      organization.addMember(ministry.id, person.id, false);
      counts.ministriesToppedUp++;
    }
  }

  /* ------------------------------------------------------- 2. ministry goals */

  for (const ministry of organization.ministries()) {
    const hasGoal = (
      db.prepare("SELECT COUNT(*) AS n FROM goal WHERE ministry_id = ?").get(ministry.id) as {
        n: number;
      }
    ).n;
    if (hasGoal > 0 || !ministry.leadId) continue;
    goals.insertGoal({
      year: 2026,
      title: `${ministry.name} — steady the weekly rhythm through Q4`,
      description:
        `Keep ${ministry.name}'s weekly meeting, team coverage and handovers dependable through the rest of 2026, ` +
        "rather than reacting week to week.",
      ministryId: ministry.id,
      ownerId: ministry.leadId,
      ...(CAMPUS_ID ? { campusId: CAMPUS_ID } : {}),
      target: { precision: "month", value: "2026-12" },
      status: "active",
    });
    counts.ministryGoalsAdded++;
  }

  /* --------------------------------------------------- 3. weekly calendar */

  const WEEKDAYS = [1, 2, 3, 4, 5]; // Monday .. Friday
  let ministryIndex = 0;
  for (const ministry of organization.ministries()) {
    if (!ministry.leadId) continue;
    const already = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM schedule_entry WHERE ministry_id = ? AND rec_frequency IS NOT NULL",
        )
        .get(ministry.id) as { n: number }
    ).n;
    if (already > 0) continue;

    const weekday = WEEKDAYS[ministryIndex % WEEKDAYS.length]!;
    ministryIndex++;
    calendar.insertEntry({
      title: `${ministry.name} weekly check-in`,
      recurrence: { frequency: "weekly", weekday, from: "2026-08-03", until: "2026-12-27" },
      startTime: "18:30",
      endTime: "19:15",
      category: "ministry-meeting",
      ministryId: ministry.id,
      organizerId: ministry.leadId,
      createdBy: ministry.leadId,
      source: "ministry",
    });
    counts.recurringMinistryMeetings++;
  }

  /* ------------------------------------------------------- 4. this week's agenda */

  const weekOf = "2026-09-07"; // the Monday of the demo's "today"
  const agendaFor = new Set(
    [...organization.ministries().map((m: Ministry) => m.leadId), ...bishopsAndAdmin()].filter(
      (id): id is string => Boolean(id),
    ),
  );
  for (const personId of agendaFor) {
    const already = (
      db
        .prepare("SELECT COUNT(*) AS n FROM agenda_item WHERE assignee_id = ? AND week_of = ?")
        .get(personId, weekOf) as { n: number }
    ).n;
    if (already > 0) continue;
    const ministry = organization.ministries().find((m: Ministry) => m.leadId === personId);
    calendar.insertAgendaItem({
      text: ministry
        ? `Send this week's ${ministry.name} update`
        : "Read the week's leadership reports",
      weekOf,
      category: ministry ? "ministry-meeting" : "other",
      ...(ministry ? { ministryId: ministry.id } : {}),
      assigneeId: personId,
    });
    calendar.insertAgendaItem({
      text: "Check in with anyone whose report flagged something this week",
      weekOf,
      assigneeId: personId,
    });
    counts.agendaItemsAdded += 2;
  }

  /* -------------------------------------------------- 5. weekly lifegroups */

  const THURSDAY_DATES = [
    "2026-08-06",
    "2026-08-13",
    "2026-08-20",
    "2026-08-27",
    "2026-09-03",
    "2026-09-10",
    "2026-09-17",
    "2026-09-24",
  ];
  for (const personId of agendaFor) {
    const hasAny = (
      db
        .prepare("SELECT COUNT(*) AS n FROM gathering WHERE primary_leader_id = ?")
        .get(personId) as {
        n: number;
      }
    ).n;
    if (hasAny > 0) continue;

    for (const date of THURSDAY_DATES) {
      const completed = date < TODAY;
      const gathering = lifegroup.insertGathering({
        date,
        assignedLeaderIds: [personId],
        primaryLeaderId: personId,
        ...(CAMPUS_ID ? { campusId: CAMPUS_ID } : {}),
        status: completed ? "completed" : "confirmed",
      } as never);
      if (completed) {
        lifegroup.setExhortation(gathering.id, {
          topic: "Steady faithfulness in the ordinary week",
        });
        lifegroup.setReport(gathering.id, {
          summary:
            "A quieter week: we walked through the passage together and prayed for one another.",
          completedAt: `${date}T20:00:00.000Z`,
          completedById: personId,
        });
      }
      counts.lifegroupGatheringsAdded++;
    }
  }
});

function bishopsAndAdmin(): string[] {
  return (
    db.prepare("SELECT id FROM person WHERE access_role IN ('bishop', 'admin')").all() as {
      id: string;
    }[]
  ).map((r) => r.id);
}

run();

console.log(JSON.stringify(counts, null, 1));
console.log(`\nAdded operational scaffolding to ${targetPath}.`);
db.close();
