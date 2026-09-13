import { createHash } from "node:crypto";

import type { Database as Db } from "better-sqlite3";

import { applyOverrides, config } from "@/config";
import { createConfigurationRepository } from "../repositories/configuration-repository";

/**
 * Making an administrator's configuration effective **now**.
 *
 * Saving a change must not require a rebuild, a redeploy or a restart. That is
 * a product requirement, and it is not satisfied by writing the change to the
 * database — it is satisfied by every request reading it.
 *
 * ## The defect this closes
 *
 * Overrides used to be applied in one place: the session endpoint. Every other
 * server function ran on whatever that process happened to have applied last,
 * which in a fresh process was nothing at all — the shipped defaults. So a
 * renamed status was correct on one request and stale on the next, depending
 * on which handler ran first and which process answered. With more than one
 * process it could never be consistent.
 *
 * ## How it is cheap enough to do every time
 *
 * A stamp — a digest of every stored override — is read from a table that
 * holds only what an administrator changed, a handful of rows. When it matches
 * what this process already applied, nothing is parsed or re-applied. When it
 * does not, the overrides are loaded and the registry's cache is dropped.
 *
 * This also makes **multiple processes** consistent: each notices the change on
 * its next request, because the stamp is read from the shared database rather
 * than from memory.
 *
 * ## Why a digest, not a count and a time
 *
 * The stamp used to be the row count and the newest `updated_at`. That only
 * held while every save inserted a new row. Since migration 034 a save updates
 * its row in place, so two saves of the same setting within one millisecond
 * left both the count and the time unchanged — and the process went on serving
 * the first value. A digest of the stored content cannot miss a change to it.
 */

let applied = "";

/** Load configuration if it has changed since this process last looked. */
export function refreshConfiguration(db: Db): void {
  const rows = db
    .prepare(
      `SELECT namespace, option_id, field, value, is_addition, updated_at
         FROM configuration_setting
        ORDER BY namespace, IFNULL(option_id, ''), IFNULL(field, '')`,
    )
    .all();

  const stamp = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  if (stamp === applied) return;

  try {
    const overrides = createConfigurationRepository(db).all();
    applyOverrides(overrides);
    /* Read a namespace to force validation now, while there is still a
       last-good configuration to fall back to. */
    config.get("reports.visibility");
    lastGood = overrides;
    applied = stamp;
  } catch (error) {
    /*
     * Configuration that will not validate must not take the application down.
     *
     * The service validates everything it writes, so this is the hand-edited
     * row, the partial restore, the future schema change. The last
     * configuration that *did* load stays in force, the stamp is not advanced
     * so a corrected row is picked up on the next request, and the failure is
     * loud in the log rather than silent on the page.
     */
    console.error("Configuration could not be applied; keeping the last good one.", error);
    restoreLastGood();
  }
}

/**
 * Put back what was working.
 *
 * Overrides are re-applied from what this process last accepted — which, on a
 * process that has never accepted any, is nothing at all: the values Oikonomia
 * ships with. Those always validate.
 */
function restoreLastGood(): void {
  applyOverrides(lastGood);
}

let lastGood: Parameters<typeof applyOverrides>[0] = [];

/** Forget what this process thinks it has applied. For tests. */
export function forgetConfiguration(): void {
  applied = "";
  lastGood = [];
}
