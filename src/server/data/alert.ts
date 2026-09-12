import { canDeliver, delivery } from "../auth/delivery";
import { siteUrl } from "../auth/site-url";

/**
 * Telling somebody when the unattended work fails.
 *
 * ## The failure this exists for
 *
 * A backup that runs at two in the morning and fails at two in the morning is
 * a backup nobody knows about. Cron gets a non-zero exit code, which is
 * visible to whoever reads cron's mail — and in a church, nobody reads cron's
 * mail. The failure mode is an installation that has had no backup since a
 * disk filled up in March and no one is aware until the day it matters.
 *
 * ## What is alerted, and what is not
 *
 * **Failures only.** An alert that arrives every night when everything worked
 * is an alert somebody makes a filter for, and then the one that matters is
 * filtered too.
 *
 * ## When there is nowhere to send
 *
 * Nothing happens, and it is not an error. `OIKONOMIA_ALERT_TO` is the address
 * an administrator reads; without it — or without a mail provider — the task's
 * own non-zero result is still what cron sees. Alerting is an addition to that
 * signal, never a replacement for it, because a mail provider is one more
 * thing that can be down at exactly the wrong moment.
 */

export function alertRecipient(): string | undefined {
  const to = process.env["OIKONOMIA_ALERT_TO"]?.trim();
  return to || undefined;
}

/** Whether a message about a failure would reach anybody. */
export const alertsConfigured = (): boolean => Boolean(alertRecipient()) && canDeliver();

/**
 * Report that a scheduled task failed.
 *
 * Never throws. This is called from the failure path of something that has
 * already gone wrong, and an alert that fails must not turn a failed backup
 * into a failed request — the caller still has to return its own honest
 * result.
 */
export async function alertMaintenanceFailure(detail: {
  task: string;
  reason: string;
  jobId?: string;
}): Promise<boolean> {
  const to = alertRecipient();
  if (!to || !canDeliver()) return false;

  try {
    await delivery().send({
      to,
      subject: `Oikonomia: the ${detail.task} task failed`,
      body: [
        `The scheduled ${detail.task} did not complete.`,
        "",
        `What happened: ${detail.reason}`,
        ...(detail.jobId ? [`Job: ${detail.jobId}`] : []),
        "",
        "Open Administration → Data Management to see the job and its history:",
        `${siteUrl()}/administration`,
        "",
        "This message is sent only when a scheduled task fails. Nothing is sent",
        "when they succeed, so silence here means the work is being done.",
      ].join("\n"),
    });
    return true;
  } catch (error) {
    /* The alert failed too. Say so where an operator reading logs will find
       it, and let the caller report the original failure unchanged. */
    console.error("Could not send a maintenance failure alert:", error);
    return false;
  }
}
