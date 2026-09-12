import type { Database as Db } from "better-sqlite3";

import { newId, nowIso } from "../db/records";
import type {
  DataJob,
  DataOperation,
  JobStatus,
  RetentionPolicy,
  Scope,
} from "@/domain/data-management";

/**
 * Jobs, audit and retention policy.
 *
 * One repository because the three are written together — a job completing is
 * also an audit event — and splitting them would mean two writers for one
 * fact. They stay separate **tables** because their lifetimes differ: a job is
 * cleaned up when its artifact expires, and an audit row is not.
 */

interface JobRow {
  id: string;
  operation: string;
  requested_by: string | null;
  execution_actor: string;
  scope_type: string;
  scope_json: string;
  format: string | null;
  destination: string;
  status: string;
  progress: number;
  schema_version: number | null;
  application_version: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  artifact_ref: string | null;
  artifact_bytes: number | null;
  checksum: string | null;
  record_count: number | null;
  withheld_count: number;
  error_code: string | null;
  error_summary: string | null;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorType: "user" | "system";
  actorId?: string;
  action: string;
  scopeType?: string;
  jobId?: string;
  result: string;
  recordCount?: number;
  /* JSON, kept as text on the wire. Anything worth keeping that is safe to
     keep — never exported content. */
  metadata: string;
}

export function createDataJobRepository(db: Db) {
  const toJob = (row: JobRow): DataJob => ({
    id: row.id,
    operation: row.operation as DataOperation,
    ...(row.requested_by ? { requestedBy: row.requested_by } : {}),
    executionActor: row.execution_actor === "system" ? "system" : "user",
    scope: JSON.parse(row.scope_json) as Scope,
    ...(row.format ? { format: row.format } : {}),
    destination: row.destination,
    status: row.status as JobStatus,
    progress: row.progress,
    requestedAt: row.requested_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.artifact_ref ? { artifactRef: row.artifact_ref } : {}),
    ...(row.artifact_bytes !== null ? { artifactBytes: row.artifact_bytes } : {}),
    ...(row.checksum ? { checksum: row.checksum } : {}),
    ...(row.record_count !== null ? { recordCount: row.record_count } : {}),
    withheldCount: row.withheld_count,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_summary ? { errorSummary: row.error_summary } : {}),
    ...(row.schema_version !== null ? { schemaVersion: row.schema_version } : {}),
    ...(row.application_version ? { applicationVersion: row.application_version } : {}),
  });

  return {
    open(values: {
      operation: DataOperation;
      requestedBy?: string | undefined;
      executionActor?: "user" | "system";
      scope: Scope;
      format?: string | undefined;
      destination?: string | undefined;
    }): DataJob {
      const id = newId("job");
      db.prepare(
        `INSERT INTO data_job
           (id, operation, requested_by, execution_actor, scope_type, scope_json,
            format, destination, status, progress, requested_at)
         VALUES (@id, @operation, @by, @actor, @scopeType, @scope, @format, @destination,
                 'queued', 0, @at)`,
      ).run({
        id,
        operation: values.operation,
        by: values.requestedBy ?? null,
        actor: values.executionActor ?? "user",
        scopeType: values.scope.type,
        scope: JSON.stringify(values.scope),
        format: values.format ?? null,
        destination: values.destination ?? "download",
        at: nowIso(),
      });
      return this.find(id)!;
    },

    find(id: string): DataJob | undefined {
      const row = db.prepare("SELECT * FROM data_job WHERE id = ?").get(id) as JobRow | undefined;
      return row ? toJob(row) : undefined;
    },

    /** Most recent first. The administration screen's list. */
    recent(limit = 25): DataJob[] {
      return (
        db
          .prepare("SELECT * FROM data_job ORDER BY requested_at DESC LIMIT ?")
          .all(limit) as JobRow[]
      ).map(toJob);
    },

    ofOperation(operation: DataOperation, limit = 25): DataJob[] {
      return (
        db
          .prepare("SELECT * FROM data_job WHERE operation = ? ORDER BY requested_at DESC LIMIT ?")
          .all(operation, limit) as JobRow[]
      ).map(toJob);
    },

    lastCompleted(operation: DataOperation): DataJob | undefined {
      const row = db
        .prepare(
          `SELECT * FROM data_job WHERE operation = ? AND status = 'completed'
            ORDER BY completed_at DESC LIMIT 1`,
        )
        .get(operation) as JobRow | undefined;
      return row ? toJob(row) : undefined;
    },

    /** Anything that failed and has not been looked at. */
    failed(limit = 25): DataJob[] {
      return (
        db
          .prepare(
            `SELECT * FROM data_job WHERE status IN ('failed', 'validation_failed')
              ORDER BY requested_at DESC LIMIT ?`,
          )
          .all(limit) as JobRow[]
      ).map(toJob);
    },

    /** Completed artifacts past their expiry. What retention deletes. */
    expiredArtifacts(now: string): DataJob[] {
      return (
        db
          .prepare(
            `SELECT * FROM data_job
              WHERE artifact_ref IS NOT NULL AND expires_at IS NOT NULL AND expires_at < ?`,
          )
          .all(now) as JobRow[]
      ).map(toJob);
    },

    update(
      id: string,
      values: Partial<{
        status: JobStatus;
        progress: number;
        startedAt: string;
        completedAt: string;
        expiresAt: string | null;
        artifactRef: string | null;
        artifactBytes: number | null;
        checksum: string | null;
        recordCount: number;
        withheldCount: number;
        errorCode: string | null;
        errorSummary: string | null;
        schemaVersion: number;
        applicationVersion: string;
      }>,
    ): DataJob | undefined {
      const current = this.find(id);
      if (!current) return undefined;

      db.prepare(
        `UPDATE data_job SET
            status = @status, progress = @progress,
            started_at = @startedAt, completed_at = @completedAt, expires_at = @expiresAt,
            artifact_ref = @artifactRef, artifact_bytes = @artifactBytes, checksum = @checksum,
            record_count = @recordCount, withheld_count = @withheldCount,
            error_code = @errorCode, error_summary = @errorSummary,
            schema_version = @schemaVersion, application_version = @applicationVersion
          WHERE id = @id`,
      ).run({
        id,
        status: values.status ?? current.status,
        progress: values.progress ?? current.progress,
        startedAt: values.startedAt ?? current.startedAt ?? null,
        completedAt: values.completedAt ?? current.completedAt ?? null,
        expiresAt: "expiresAt" in values ? values.expiresAt : (current.expiresAt ?? null),
        artifactRef: "artifactRef" in values ? values.artifactRef : (current.artifactRef ?? null),
        artifactBytes:
          "artifactBytes" in values ? values.artifactBytes : (current.artifactBytes ?? null),
        checksum: "checksum" in values ? values.checksum : (current.checksum ?? null),
        recordCount: values.recordCount ?? current.recordCount ?? null,
        withheldCount: values.withheldCount ?? current.withheldCount,
        errorCode: "errorCode" in values ? values.errorCode : (current.errorCode ?? null),
        errorSummary:
          "errorSummary" in values ? values.errorSummary : (current.errorSummary ?? null),
        schemaVersion: values.schemaVersion ?? current.schemaVersion ?? null,
        applicationVersion: values.applicationVersion ?? current.applicationVersion ?? null,
      });
      return this.find(id);
    },

    /* ------------------------------------------------------------- audit */

    /**
     * Record that a sensitive thing happened.
     *
     * Never the content: an audit row naming what a confidential report said
     * has widened the disclosure it exists to record. Scope, counts and
     * outcome — enough to answer "who exported the safeguarding ministry, and
     * when" without being a second copy of it.
     */
    audit(values: {
      actorType?: "user" | "system";
      actorId?: string | undefined;
      action: string;
      scope?: Scope | undefined;
      jobId?: string | undefined;
      result?: string;
      recordCount?: number | undefined;
      metadata?: Record<string, unknown>;
    }): void {
      db.prepare(
        `INSERT INTO data_audit
           (id, at, actor_type, actor_id, action, scope_type, scope_json, job_id,
            result, record_count, metadata)
         VALUES (@id, @at, @actorType, @actorId, @action, @scopeType, @scope, @jobId,
                 @result, @recordCount, @metadata)`,
      ).run({
        id: newId("aud"),
        at: nowIso(),
        actorType: values.actorType ?? "user",
        actorId: values.actorId ?? null,
        action: values.action,
        scopeType: values.scope?.type ?? null,
        scope: values.scope ? JSON.stringify(values.scope) : null,
        jobId: values.jobId ?? null,
        result: values.result ?? "ok",
        recordCount: values.recordCount ?? null,
        metadata: JSON.stringify(values.metadata ?? {}),
      });
    },

    auditTrail(limit = 50): AuditEvent[] {
      const rows = db.prepare("SELECT * FROM data_audit ORDER BY at DESC LIMIT ?").all(limit) as {
        id: string;
        at: string;
        actor_type: string;
        actor_id: string | null;
        action: string;
        scope_type: string | null;
        job_id: string | null;
        result: string;
        record_count: number | null;
        metadata: string;
      }[];

      return rows.map((row) => ({
        id: row.id,
        at: row.at,
        actorType: row.actor_type === "system" ? "system" : "user",
        ...(row.actor_id ? { actorId: row.actor_id } : {}),
        action: row.action,
        ...(row.scope_type ? { scopeType: row.scope_type } : {}),
        ...(row.job_id ? { jobId: row.job_id } : {}),
        result: row.result,
        ...(row.record_count !== null ? { recordCount: row.record_count } : {}),
        metadata: row.metadata,
      }));
    },

    /* --------------------------------------------------------- retention */

    policies(): RetentionPolicy[] {
      const rows = db.prepare("SELECT * FROM retention_policy ORDER BY artifact_class").all() as {
        artifact_class: string;
        retention_days: number;
        enabled: number;
        on_hold: number;
        updated_by: string | null;
        updated_at: string;
      }[];

      return rows.map((row) => ({
        artifactClass: row.artifact_class as RetentionPolicy["artifactClass"],
        retentionDays: row.retention_days,
        enabled: row.enabled === 1,
        onHold: row.on_hold === 1,
        updatedAt: row.updated_at,
        ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
      }));
    },

    setPolicy(
      artifactClass: string,
      values: { retentionDays?: number; enabled?: boolean; onHold?: boolean; updatedBy?: string },
    ): RetentionPolicy | undefined {
      const current = this.policies().find((policy) => policy.artifactClass === artifactClass);
      if (!current) return undefined;

      db.prepare(
        `UPDATE retention_policy
            SET retention_days = @days, enabled = @enabled, on_hold = @hold,
                updated_by = @by, updated_at = @at
          WHERE artifact_class = @class`,
      ).run({
        class: artifactClass,
        days: values.retentionDays ?? current.retentionDays,
        enabled: (values.enabled ?? current.enabled) ? 1 : 0,
        hold: (values.onHold ?? current.onHold) ? 1 : 0,
        by: values.updatedBy ?? current.updatedBy ?? null,
        at: nowIso(),
      });

      return this.policies().find((policy) => policy.artifactClass === artifactClass);
    },
  };
}

export type DataJobRepository = ReturnType<typeof createDataJobRepository>;
