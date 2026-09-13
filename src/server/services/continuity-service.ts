import { readFileSync, rmSync, writeFileSync } from "node:fs";

import Database from "better-sqlite3";

import { ApiError } from "../api/response";
import { databasePath } from "../db/connection";
import {
  hasOffsiteProvider,
  localStorageProvider,
  onSeparateDevice,
  secondaryStorageProvider,
  sha256,
} from "../data/storage";
import {
  continuityConcerns,
  mayDelete,
  rejectPackage,
  type ContinuityStatus,
  type DataJob,
  type RetentionPolicy,
} from "@/domain/data-management";
import type { Database as Db } from "better-sqlite3";
import type { DataJobRepository } from "../repositories/data-job-repository";
import type { Viewer } from "@/domain/viewer";

/**
 * Backup, restore, import and retention.
 *
 * ## What a backup of this installation actually is
 *
 * The database. All of it — there is nothing else. Oikonomia stores no
 * uploaded files: a binder document is blocks in a table, and a Drive document
 * is a reference to somebody else's storage. So "database plus attachments
 * plus configuration" collapses, for this product as it stands, to one
 * consistent copy of one file. That is worth stating rather than implying,
 * because the day an upload feature lands, this stops being true and this
 * comment is where somebody will find that out.
 *
 * The copy is taken with SQLite's own online backup, not by copying the file
 * while it is being written. A file copied mid-transaction restores as
 * corruption, and corruption in a backup is worse than no backup because
 * nobody finds out until they need it.
 *
 * ## What is deliberately not here
 *
 * **No off-server destination**, and no stub pretending to be one. It needs a
 * destination the church has chosen and credentials in a secret mechanism, and
 * a provider that quietly wrote nowhere would be worse than none — the
 * dashboard would say a backup exists. `continuityConcerns` therefore reports
 * a local-only installation as insufficient, every time it is asked.
 *
 * **No scheduler.** This stack has no job runner. `runBackup` accepts a system
 * actor so a cron entry can call it, and until a church sets one up, the
 * dashboard says no backup has ever run rather than implying one has.
 */

const SCHEMA_VERSION = 31;
const APPLICATION_VERSION = "0.1.0";

export function createContinuityService(db: Db, jobs: DataJobRepository) {
  const requireAdministration = (viewer: Viewer): void => {
    if (!viewer.persona.capabilities.includes("administration")) {
      throw ApiError.forbidden("Data management is an administrator's to do.");
    }
  };

  return {
    /**
     * Take a backup.
     *
     * `actor` may be `system`, for a scheduled run: a cron job is not an
     * administrator with a login, and recording it as one would make the audit
     * trail lie about who did what.
     */
    runBackup(viewer: Viewer | null): DataJob {
      if (viewer) requireAdministration(viewer);

      const job = jobs.open({
        operation: "backup",
        ...(viewer ? { requestedBy: viewer.person.id } : {}),
        executionActor: viewer ? "user" : "system",
        scope: { type: "site" },
        destination: "local",
      });

      jobs.audit({
        actorType: viewer ? "user" : "system",
        ...(viewer ? { actorId: viewer.person.id } : {}),
        action: "backup.started",
        jobId: job.id,
      });

      try {
        jobs.update(job.id, { status: "running", startedAt: new Date().toISOString() });

        /*
         * SQLite's own online backup, into a scratch file inside the artifact
         * store, then read back and stored through the provider.
         *
         * Copying the database file directly would capture it mid-transaction,
         * and a torn backup is one nobody discovers is useless until they need
         * it. `better-sqlite3` does this properly and synchronously enough for
         * a church-sized database; the scratch file is removed either way,
         * because leaving it would be a second unmanaged copy of every
         * confidential record in the church.
         */
        const storage = localStorageProvider();
        const scratch = storage.scratchPath("backup.db");

        let bytes: Buffer;
        try {
          backupTo(db, scratch);
          bytes = readFileSync(scratch);
        } finally {
          rmSync(scratch, { force: true });
        }

        const name = `oikonomia-backup-${new Date().toISOString().slice(0, 19)}.db`;
        const stored = storage.put(name, bytes);

        /*
         * And again, to the destination meant to survive this machine.
         *
         * After the local copy rather than instead of it: if the second write
         * fails — an unmounted volume, a full disk, a network share that has
         * gone away — the backup that already succeeded is still a backup, and
         * the job records that the copy did not happen rather than throwing
         * the whole thing away. A failure to duplicate is not a failure to
         * back up, and treating it as one would mean a bad mount loses the
         * only copy too.
         */
        const second = secondaryStorageProvider();
        let copiedTo: string | undefined;
        let copyError: string | undefined;

        if (second) {
          try {
            second.put(name, bytes);
            copiedTo = second.id;
          } catch (error) {
            copyError = error instanceof Error ? error.message : "Unknown failure";
            console.error("Backup copy to the secondary destination failed:", error);
          }
        }

        const completed = jobs.update(job.id, {
          status: "completed",
          progress: 100,
          completedAt: new Date().toISOString(),
          artifactRef: stored.reference,
          artifactBytes: stored.bytes,
          checksum: stored.checksum,
          schemaVersion: SCHEMA_VERSION,
          applicationVersion: APPLICATION_VERSION,
        })!;

        jobs.audit({
          actorType: viewer ? "user" : "system",
          ...(viewer ? { actorId: viewer.person.id } : {}),
          action: "backup.completed",
          jobId: job.id,
          metadata: {
            offsite: hasOffsiteProvider(),
            bytes: stored.bytes,
            ...(copiedTo ? { copiedTo } : {}),
            ...(copyError ? { copyFailed: copyError } : {}),
          },
        });

        return completed;
      } catch (error) {
        const failed = jobs.update(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          errorCode: "backup_failed",
          errorSummary: error instanceof Error ? error.message : "Unknown failure",
        })!;
        jobs.audit({
          actorType: viewer ? "user" : "system",
          ...(viewer ? { actorId: viewer.person.id } : {}),
          action: "backup.failed",
          jobId: job.id,
          result: "error",
        });
        return failed;
      }
    },

    /**
     * Prove a backup can be restored, without touching the live installation.
     *
     * A backup nobody has restored is a backup nobody knows works. This opens
     * the copy as a database of its own, checks its integrity and reads enough
     * of it to know the schema is there — and it does all of that beside the
     * running installation rather than over it.
     *
     * Restoring **into** production is deliberately not a button. It needs a
     * write lock, a maintenance window and somebody at a terminal; a one-click
     * control that replaces every record in the church is a control nobody
     * should have. The operator guide documents the procedure.
     */
    verifyBackup(viewer: Viewer, jobId: string): DataJob {
      requireAdministration(viewer);

      const backup = jobs.find(jobId);
      if (!backup || backup.operation !== "backup" || !backup.artifactRef) {
        throw ApiError.notFound("That backup");
      }

      const job = jobs.open({
        operation: "restore",
        requestedBy: viewer.person.id,
        scope: { type: "site" },
        destination: "verification",
      });

      jobs.audit({
        actorId: viewer.person.id,
        action: "restore.verification.started",
        jobId: job.id,
        metadata: { backupJob: backup.id },
      });

      try {
        const storage = localStorageProvider();

        if (!storage.exists(backup.artifactRef)) {
          throw new Error("The backup file is missing from the artifact store.");
        }

        /* Integrity first: a backup whose checksum has drifted is not a
           recovery point, and calling it one is the failure this check exists
           to prevent. */
        const content = storage.get(backup.artifactRef);
        if (backup.checksum && sha256(content) !== backup.checksum) {
          throw new Error("The backup's checksum does not match. It has been damaged.");
        }

        /* Open the copy as a database in its own right and ask it something
           only a coherent Oikonomia database can answer. Read-only, beside the
           running installation rather than over it. */
        const scratch = storage.scratchPath("verify.db");
        let people = 0;
        let version = 0;

        try {
          writeFileSync(scratch, content);
          const copy = new Database(scratch, { readonly: true });
          try {
            const integrity = copy.pragma("integrity_check", { simple: true });
            if (integrity !== "ok") throw new Error(`Integrity check said: ${String(integrity)}`);

            people = (copy.prepare("SELECT COUNT(*) AS n FROM person").get() as { n: number }).n;
            version = (
              copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }
            ).v;
          } finally {
            copy.close();
          }
        } finally {
          rmSync(scratch, { force: true });
        }

        const completed = jobs.update(job.id, {
          status: "completed",
          progress: 100,
          completedAt: new Date().toISOString(),
          recordCount: people,
          schemaVersion: version,
        })!;

        jobs.audit({
          actorId: viewer.person.id,
          action: "restore.verification.completed",
          jobId: job.id,
          recordCount: people,
          metadata: { backupJob: backup.id, schemaVersion: version },
        });

        return completed;
      } catch (error) {
        const failed = jobs.update(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          errorCode: "verification_failed",
          errorSummary: error instanceof Error ? error.message : "Unknown failure",
        })!;
        jobs.audit({
          actorId: viewer.person.id,
          action: "restore.verification.failed",
          jobId: job.id,
          result: "error",
        });
        return failed;
      }
    },

    /**
     * Check a package without writing anything.
     *
     * Validation has **zero authoritative writes**, which is the difference
     * between a preview and an import. What comes back is what would happen —
     * how many records of each kind, and why it would be refused if it would.
     */
    validatePackage(
      viewer: Viewer,
      content: string,
    ): {
      job: DataJob;
      ok: boolean;
      problem?: string;
      counts: Record<string, number>;
    } {
      requireAdministration(viewer);

      const job = jobs.open({
        operation: "import",
        requestedBy: viewer.person.id,
        scope: { type: "site" },
        format: "opk",
        destination: "validation",
      });

      jobs.update(job.id, { status: "validating", startedAt: new Date().toISOString() });
      jobs.audit({ actorId: viewer.person.id, action: "import.uploaded", jobId: job.id });

      /* Untrusted input. A package is a file somebody sent, and the first thing
         that happens to it is a size check and a parse that may fail. */
      if (content.length > 32 * 1024 * 1024) {
        const failed = jobs.update(job.id, {
          status: "validation_failed",
          completedAt: new Date().toISOString(),
          errorCode: "too_large",
          errorSummary: "That package is larger than this installation accepts.",
        })!;
        return {
          job: failed,
          ok: false,
          problem: "That package is larger than this installation accepts.",
          counts: {},
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        const failed = jobs.update(job.id, {
          status: "validation_failed",
          completedAt: new Date().toISOString(),
          errorCode: "unreadable",
          errorSummary: "That file could not be read as an Oikonomia package.",
        })!;
        return {
          job: failed,
          ok: false,
          problem: "That file could not be read as an Oikonomia package.",
          counts: {},
        };
      }

      const problem = rejectPackage(parsed);
      if (problem) {
        const failed = jobs.update(job.id, {
          status: "validation_failed",
          completedAt: new Date().toISOString(),
          errorCode: "rejected",
          errorSummary: problem,
        })!;
        jobs.audit({
          actorId: viewer.person.id,
          action: "import.rejected",
          jobId: job.id,
          result: "refused",
          metadata: { reason: problem },
        });
        return { job: failed, ok: false, problem, counts: {} };
      }

      const pkg = parsed as {
        manifest: { recordCounts?: Record<string, number> };
        data?: Record<string, unknown[]>;
        checksums?: Record<string, string>;
      };

      /* Integrity per section. A package damaged in transit must be refused
         before anything is written from it, not after. */
      for (const [section, expected] of Object.entries(pkg.checksums ?? {})) {
        const actual = sha256(JSON.stringify(pkg.data?.[section] ?? []));
        if (actual !== expected) {
          const message = `The ${section} in that package are damaged.`;
          const failed = jobs.update(job.id, {
            status: "validation_failed",
            completedAt: new Date().toISOString(),
            errorCode: "checksum_mismatch",
            errorSummary: message,
          })!;
          jobs.audit({
            actorId: viewer.person.id,
            action: "import.rejected",
            jobId: job.id,
            result: "refused",
            metadata: { reason: "checksum" },
          });
          return { job: failed, ok: false, problem: message, counts: {} };
        }
      }

      const counts = Object.fromEntries(
        Object.entries(pkg.data ?? {}).map(([section, rows]) => [section, rows.length]),
      );

      const ready = jobs.update(job.id, {
        status: "preview_ready",
        completedAt: new Date().toISOString(),
        recordCount: Object.values(counts).reduce((total, n) => total + n, 0),
      })!;

      jobs.audit({
        actorId: viewer.person.id,
        action: "import.validated",
        jobId: job.id,
        recordCount: ready.recordCount ?? 0,
      });

      return { job: ready, ok: true, counts };
    },

    /* ------------------------------------------------------------ status */

    status(viewer: Viewer): ContinuityStatus & { concerns: string[]; policies: RetentionPolicy[] } {
      requireAdministration(viewer);

      const secondary = secondaryStorageProvider();
      const lastBackup = jobs.lastCompleted("backup");
      const lastRestore = jobs.lastCompleted("restore");

      const status: ContinuityStatus = {
        ...(lastBackup ? { lastSuccessfulBackup: lastBackup } : {}),
        ...(lastRestore ? { lastVerifiedRestore: lastRestore } : {}),
        failedJobs: jobs.failed(),
        offsiteMissing: !hasOffsiteProvider(),
        ...(secondary
          ? {
              secondaryCopy: {
                directory: secondary.directory,
                declaredOffsite: secondary.offsite,
                separateDevice: onSeparateDevice(secondary.directory, databasePath()),
              },
            }
          : {}),
      };

      return { ...status, concerns: continuityConcerns(status), policies: jobs.policies() };
    },

    /**
     * Delete what has outlived its policy.
     *
     * Three separate reasons not to delete something are checked, because
     * deleting a backup early is the one mistake in this domain that cannot be
     * undone. What is removed is recorded.
     */
    runRetention(viewer: Viewer | null): { deleted: number; kept: number } {
      if (viewer) requireAdministration(viewer);

      const policies = jobs.policies();
      const now = new Date();
      let deleted = 0;
      let kept = 0;

      const storage = localStorageProvider();

      for (const job of jobs.expiredArtifacts(now.toISOString())) {
        const artifactClass =
          job.operation === "backup" ? "backup" : job.operation === "import" ? "import" : "export";
        const policy = policies.find((candidate) => candidate.artifactClass === artifactClass);

        const ageDays = (now.getTime() - new Date(job.requestedAt).getTime()) / 86_400_000;

        if (!mayDelete(policy, ageDays)) {
          kept += 1;
          continue;
        }

        if (job.artifactRef) storage.delete(job.artifactRef);
        jobs.update(job.id, { status: "expired", artifactRef: null, checksum: null });
        deleted += 1;
      }

      jobs.audit({
        actorType: viewer ? "user" : "system",
        ...(viewer ? { actorId: viewer.person.id } : {}),
        action: "retention.ran",
        metadata: { deleted, kept },
      });

      return { deleted, kept };
    },

    setRetention(
      viewer: Viewer,
      artifactClass: string,
      values: { retentionDays?: number; enabled?: boolean; onHold?: boolean },
    ): RetentionPolicy {
      requireAdministration(viewer);

      const saved = jobs.setPolicy(artifactClass, { ...values, updatedBy: viewer.person.id });
      if (!saved) throw ApiError.notFound("That retention policy");

      jobs.audit({
        actorId: viewer.person.id,
        action: "retention.changed",
        metadata: { artifactClass, ...values },
      });

      return saved;
    },
  };
}

/**
 * Take SQLite's own consistent copy.
 *
 * `better-sqlite3`'s `backup` is asynchronous; `VACUUM INTO` is the
 * synchronous equivalent and produces the same thing — a consistent copy taken
 * while the database is in use, rather than a file read out from under a
 * writer.
 */
function backupTo(db: Db, path: string): void {
  db.prepare("VACUUM INTO ?").run(path);
}

export type ContinuityService = ReturnType<typeof createContinuityService>;
