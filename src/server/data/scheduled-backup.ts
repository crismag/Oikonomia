import type { ContinuityService } from "../services/continuity-service";
import type { alertMaintenanceFailure } from "./alert";

/**
 * `task=backup`, as cron sees it.
 *
 * Apart from the route so the part that decides what counts as a failure —
 * and who is told — can be tested without an HTTP server.
 *
 * A backup that failed or was stopped is a 500 and an alert. So is a backup
 * that completed while its copy to the second destination did not: the local
 * backup stands, and the response says so (`backupCompleted: true`), but the
 * copy meant to survive this machine is the one a hung mount quietly stops
 * making, and silence would let that go on for months.
 */
export async function scheduledBackup(
  continuity: Pick<ContinuityService, "runBackup">,
  alert: typeof alertMaintenanceFailure,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const task = "backup";

  /* `null` viewer: taken by the system, not by an administrator. */
  const job = await continuity.runBackup(null);

  if (job.status !== "completed") {
    const reason = job.errorSummary ?? "The backup did not complete.";
    const alerted = await alert({ task, reason, jobId: job.id });
    return { status: 500, body: { ok: false, task, jobId: job.id, error: reason, alerted } };
  }

  if (job.copyFailed) {
    const reason = `The backup completed on this server, but the copy to the second destination failed: ${job.copyFailed}`;
    const alerted = await alert({ task, reason, jobId: job.id });
    return {
      status: 500,
      body: {
        ok: false,
        task,
        jobId: job.id,
        backupCompleted: true,
        bytes: job.artifactBytes ?? 0,
        error: reason,
        alerted,
      },
    };
  }

  return {
    status: 200,
    body: { ok: true, task, jobId: job.id, bytes: job.artifactBytes ?? 0 },
  };
}
