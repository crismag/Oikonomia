import type { Persona } from "./types";

/**
 * Moving, preserving and recovering what the church has written.
 *
 * ## The rule this domain exists to not break
 *
 * Export and backup cross every page boundary at once, which makes them the
 * easiest place in a product to lose an access model. `if (admin) exportAll()`
 * is one line, and it silently hands somebody every confidential report in the
 * church.
 *
 * So every operation here has an **explicit scope**, expressed as selectors
 * that a service can check — never as a query. And every record that leaves is
 * fetched through the module that owns it, so the gate that protects a report
 * on its own page is the same gate that protects it in an export.
 *
 * Anything unrecognised — a scope, a visibility, a package version, a record
 * type — is refused. There is no best guess here, because a wrong guess is a
 * disclosure.
 */

/* ------------------------------------------------------------------ scope */

export const scopeTypes = [
  /** One record, named. */
  "record",
  /** Everything this person owns. The only scope needing no capability. */
  "owned",
  /** One ministry's own records. */
  "ministry",
  /** One responsibility group's own records. */
  "group",
  /** One campus. */
  "campus",
  /** The whole installation. */
  "site",
] as const;

export type ScopeType = (typeof scopeTypes)[number];

export interface Scope {
  type: ScopeType;
  /** The ministry, group, campus or record this is about. */
  id?: string;
  /** Optional period, for scopes that span time. */
  from?: string;
  to?: string;
}

export function isScopeType(value: unknown): value is ScopeType {
  return typeof value === "string" && (scopeTypes as readonly string[]).includes(value);
}

/* ----------------------------------------------------------- capabilities */

/**
 * What a data operation requires, in terms of what the product already
 * enforces.
 *
 * Deliberately **not** a new permission vocabulary. The brief suggests names
 * like `data.export.site`; inventing those would be the second authorization
 * model it also forbids. So each operation maps onto the capabilities
 * `domain/capabilities.ts` already owns, plus the ownership and membership
 * rules the modules already apply.
 *
 * | Scope      | What it takes                                              |
 * | ---------- | ---------------------------------------------------------- |
 * | `owned`    | Nothing. Your own records are yours to take a copy of      |
 * | `record`   | Whatever reading that record takes — the module decides    |
 * | `ministry` | Leading it, or oversight                                   |
 * | `group`    | Membership, or oversight                                   |
 * | `campus`   | `campus-oversight`                                         |
 * | `site`     | `administration`                                           |
 *
 * Being able to export a scope never means being able to read every record in
 * it. The scope decides what is *asked for*; the modules decide what comes
 * back, one record at a time.
 */
export function capabilityForScope(scope: ScopeType): Persona["capabilities"][number] | null {
  switch (scope) {
    case "site":
      return "administration";
    case "campus":
      return "campus-oversight";
    default:
      return null;
  }
}

/** Operations only somebody who administers the installation may ask for. */
export const administrativeOperations = ["import", "backup", "restore", "retention"] as const;

/* ------------------------------------------------------------------- jobs */

export const jobStatuses = [
  "queued",
  "validating",
  "preview_ready",
  "running",
  "completed",
  "validation_failed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

export type DataOperation = "export" | "import" | "backup" | "restore" | "retention" | "archive";

export interface DataJob {
  id: string;
  operation: DataOperation;
  requestedBy?: string;
  executionActor: "user" | "system";
  scope: Scope;
  format?: string;
  destination: string;
  status: JobStatus;
  progress: number;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  artifactRef?: string;
  artifactBytes?: number;
  checksum?: string;
  recordCount?: number;
  /** How many records were left out because the requester may not have them. */
  withheldCount: number;
  errorCode?: string;
  errorSummary?: string;
  schemaVersion?: number;
  applicationVersion?: string;
}

/** Whether this job produced something that can still be fetched. */
export function isDownloadable(job: DataJob, now: string): boolean {
  if (job.status !== "completed" || !job.artifactRef) return false;
  if (!job.expiresAt) return true;
  return job.expiresAt > now;
}

/** Terminal, one way or another. */
export const isFinished = (status: JobStatus): boolean =>
  ["completed", "validation_failed", "failed", "cancelled", "expired"].includes(status);

export const jobStatusLabel: Record<JobStatus, string> = {
  queued: "Queued",
  validating: "Checking",
  preview_ready: "Ready to review",
  running: "Running",
  completed: "Done",
  validation_failed: "Refused",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/* --------------------------------------------------------------- packages */

/**
 * The package format version this build writes and reads.
 *
 * An importer must **support a version explicitly**. A newer package is
 * refused with a sentence saying so, rather than half-read: a best guess at an
 * unknown schema is how an import writes nonsense into a church's records.
 */
export const OPK_FORMAT = "oikonomia-portable-package";
export const OPK_VERSION = "1.0";

/** Versions this build can read. Older ones would be migrated, when there are any. */
export const readableVersions = [OPK_VERSION];

export interface PackageManifest {
  format: string;
  formatVersion: string;
  createdAt: string;
  applicationVersion: string;
  schemaVersion: number;
  scope: Scope;
  includes: string[];
  recordCounts: Record<string, number>;
  generator: string;
}

/**
 * Why a package is not acceptable, as a sentence somebody can act on.
 *
 * `null` means it is. Order matters: shape before version before integrity,
 * so the message names the first thing that is actually wrong.
 */
export function rejectPackage(pkg: unknown): string | null {
  if (!pkg || typeof pkg !== "object") return "That file is not an Oikonomia package.";

  const manifest = (pkg as { manifest?: Partial<PackageManifest> }).manifest;
  if (!manifest || typeof manifest !== "object") {
    return "That package has no manifest, so there is no way to know what it is.";
  }
  if (manifest.format !== OPK_FORMAT) {
    return "That file is not an Oikonomia package.";
  }
  if (!manifest.formatVersion) {
    return "That package does not say which version it is, and guessing is not safe.";
  }
  if (!readableVersions.includes(manifest.formatVersion)) {
    return `That package is version ${manifest.formatVersion}, which this installation cannot read.`;
  }
  if (!manifest.scope || !isScopeType(manifest.scope.type)) {
    return "That package does not say what it contains.";
  }
  return null;
}

/* -------------------------------------------------------------- retention */

export const artifactClasses = ["export", "import", "backup", "archive"] as const;
export type ArtifactClass = (typeof artifactClasses)[number];

export interface RetentionPolicy {
  artifactClass: ArtifactClass;
  retentionDays: number;
  enabled: boolean;
  /** Stops deletion regardless of age. */
  onHold: boolean;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * Whether an artifact of this class may be deleted yet.
 *
 * Three separate reasons not to, and each is checked: the policy is off, the
 * class is on hold, or it is not old enough. Deleting a backup early is the
 * one mistake in this domain that cannot be undone.
 */
export function mayDelete(policy: RetentionPolicy | undefined, ageDays: number): boolean {
  if (!policy) return false;
  if (!policy.enabled) return false;
  if (policy.onHold) return false;
  return ageDays >= policy.retentionDays;
}

/* ------------------------------------------------------------- continuity */

export interface ContinuityStatus {
  lastSuccessfulBackup?: DataJob;
  lastVerifiedRestore?: DataJob;
  failedJobs: DataJob[];
  /** True when every backup this installation has is on the machine it runs on. */
  offsiteMissing: boolean;
  /**
   * Whether backup files are encrypted: no key, a usable key, or a key that
   * is set but cannot be used (every backup fails until it is corrected).
   * Optional so a status built before encryption existed still reads.
   */
  encryption?: "off" | "on" | "invalid";
  /**
   * The second destination, when one is configured.
   *
   * Three states are genuinely different and are reported as three, because
   * collapsing them is how somebody believes they have a backup they do not:
   * nothing configured; a second copy that shares a disk with the database;
   * and a copy the operator has asserted is elsewhere.
   */
  secondaryCopy?: {
    /** Where it writes. Shown to an administrator so they can check it. */
    directory: string;
    /** The operator asserted this survives the loss of this machine. */
    declaredOffsite: boolean;
    /** Measured, not asserted: a different filesystem device to the database. */
    separateDevice: boolean;
  };
}

/**
 * What an administrator should be told about continuity, and how loudly.
 *
 * The product's organizing question is "what needs my attention?", and a
 * failed backup that only exists in a log is the exact opposite of an answer.
 *
 * **A local-only backup is reported as insufficient**, not as success. It is
 * genuinely useful for a bad deploy and genuinely useless for a dead machine,
 * and saying "Backup complete" would leave a church one hardware failure from
 * losing everything while believing otherwise.
 */
export function continuityConcerns(status: ContinuityStatus): string[] {
  const concerns: string[] = [];

  if (!status.lastSuccessfulBackup) {
    concerns.push("No backup has ever completed. Nothing here could be recovered.");
  }
  /* Before anything else about backups: until this is fixed, none will run. */
  if (status.encryption === "invalid") {
    concerns.push(
      "OIKONOMIA_BACKUP_KEY is set but is not a usable key, so every backup will fail until it is corrected.",
    );
  }
  if (status.offsiteMissing) {
    concerns.push(
      status.secondaryCopy
        ? /* Configured, but the operator has not said it leaves the machine.
             Better than nothing and not what it needs to be, so it is still a
             concern — with the reason, so it can be acted on. */
          `A second copy is written to ${status.secondaryCopy.directory}, but nothing says it leaves this machine. Set OIKONOMIA_BACKUP_OFFSITE=true once it does.`
        : "Every backup is on this server. A failure of this machine would take the backups with it.",
    );
  }

  /* The one thing about a directory that can be measured rather than believed,
     and the mistake people actually make. */
  if (status.secondaryCopy && !status.secondaryCopy.separateDevice) {
    concerns.push(
      `The backup directory ${status.secondaryCopy.directory} is on the same disk as the database, so one disk failure loses both.`,
    );
  }
  if (!status.lastVerifiedRestore) {
    concerns.push(
      "No restore has been verified. A backup nobody has restored is a backup nobody knows works.",
    );
  }
  if (status.failedJobs.length > 0) {
    concerns.push(
      `${status.failedJobs.length} data ${status.failedJobs.length === 1 ? "operation" : "operations"} failed and nobody has looked.`,
    );
  }

  return concerns;
}
