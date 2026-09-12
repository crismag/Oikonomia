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
 * A stamp — how many overrides there are and when the newest was written — is
 * one indexed query against a tiny table. When it matches what this process
 * already applied, nothing is re-read and nothing is re-parsed. When it does
 * not, the overrides are loaded and the registry's cache is dropped.
 *
 * This also makes **multiple processes** consistent: each notices the change on
 * its next request, because the stamp is read from the shared database rather
 * than from memory.
 *
 * > **Known limit.** Two writes in the same millisecond that leave the row
 * > count unchanged — deleting one override and adding another — would produce
 * > an identical stamp. Writes go through one service that records a change row
 * > each time, so this has no path to occur in practice; a version counter
 * > would close it entirely if configuration ever becomes high-traffic.
 */

let applied = "";

/** Load configuration if it has changed since this process last looked. */
export function refreshConfiguration(db: Db): void {
  const row = db
    .prepare("SELECT COUNT(*) AS n, IFNULL(MAX(updated_at), '') AS at FROM configuration_setting")
    .get() as { n: number; at: string };

  const stamp = `${row.n}:${row.at}`;
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
