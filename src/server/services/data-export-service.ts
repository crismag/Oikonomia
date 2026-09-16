import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { localStorageProvider, sha256 } from "../data/storage";
import {
  OPK_FORMAT,
  OPK_VERSION,
  capabilityForScope,
  isScopeType,
  type DataJob,
  type PackageManifest,
  type Scope,
} from "@/domain/data-management";
import { canDiscover } from "@/domain/leadership-report";
import { isServing } from "@/domain/assignment";
import type { DataJobRepository } from "../repositories/data-job-repository";
import type { LeadershipReportRepository } from "../repositories/leadership-report-repository";
import type { MeetingRepository } from "../repositories/meeting-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { Viewer } from "@/domain/viewer";

/**
 * Taking an authorized copy of what the church has written.
 *
 * ## The mistake this service exists to not make
 *
 * An export crosses every page boundary at once. The tempting implementation
 * is one query per table filtered by nothing, and it silently hands whoever
 * asked every confidential report in the church.
 *
 * So there are two gates, and they do different jobs:
 *
 * 1. **The scope gate** decides what may be *asked for*. Exporting a campus
 *    takes campus oversight; exporting the site takes administration; exporting
 *    your own records takes nothing, because they are yours.
 * 2. **The record gate** decides what actually comes back, one record at a
 *    time, using the same `canDiscover` the Leadership Reports page uses.
 *
 * Passing the first has never implied the second. An administrator may export
 * the site and still receive none of the pastoral reports inside it — and the
 * package says how many were withheld without saying which, because naming
 * them describes records they were not allowed to know exist.
 */

/** What this build's schema is at, so an old package can be read knowingly. */
const SCHEMA_VERSION = 31;
const APPLICATION_VERSION = "0.1.0";

export interface ExportRequest {
  scope: Scope;
  format: "json" | "csv" | "opk";
}

export interface ExportResult {
  job: DataJob;
  /** What the requester may fetch. Opaque; never a path. */
  artifactRef: string;
  recordCount: number;
  withheldCount: number;
}

export function createDataExportService(
  jobs: DataJobRepository,
  repos: {
    organization: OrganizationRepository;
    reports: LeadershipReportRepository;
    meetings: MeetingRepository;
  },
) {
  /**
   * Whether this viewer may ask for this scope at all.
   *
   * Fails closed on anything it does not recognise: an unresolved scope is not
   * an empty export, it is a refusal, because "I could not work out what you
   * asked for, so here is everything" is the failure mode that matters.
   */
  function requireScope(viewer: Viewer, scope: Scope): void {
    if (!isScopeType(scope.type)) {
      throw ApiError.validation({ scope: text("refusal.export.unknownScope") });
    }

    const capability = capabilityForScope(scope.type);
    if (capability && !viewer.persona.capabilities.includes(capability)) {
      throw ApiError.forbidden(text("refusal.export.tooWide"));
    }

    if (scope.type === "ministry") {
      if (!scope.id) throw ApiError.validation({ scope: text("refusal.export.ministryMissing") });
      const ministry = repos.organization.findMinistry(scope.id);
      if (!ministry) throw ApiError.notFound("That ministry");

      /* Leading it, being on it, or holding oversight. Anything else is
         refused rather than quietly returning nothing. */
      const leads = ministry.leadId === viewer.person.id;
      const serves = repos.organization
        .assignmentsFor(viewer.person.id)
        .some((a) => a.scope === "ministry" && a.targetId === scope.id && isServing(a.status));
      const oversight =
        viewer.persona.capabilities.includes("campus-oversight") ||
        viewer.persona.capabilities.includes("cross-ministry-oversight");

      if (!leads && !serves && !oversight) {
        throw ApiError.forbidden(text("refusal.export.ministryNotYours"));
      }
      return;
    }

    if (scope.type === "group") {
      if (!scope.id) throw ApiError.validation({ scope: text("refusal.export.groupMissing") });
      const group = repos.organization.findGroup(scope.id);
      if (!group) throw ApiError.notFound("That group");

      const belongs = group.memberIds.includes(viewer.person.id);
      const oversight = viewer.persona.capabilities.includes("cross-ministry-oversight");
      if (!belongs && !oversight) {
        throw ApiError.forbidden(text("refusal.export.groupNotYours"));
      }
    }
  }

  /**
   * The reports in scope that this viewer may actually read.
   *
   * Every one goes through `canDiscover` — the same gate the module uses —
   * rather than through a WHERE clause written for exports. Two statements of
   * one rule is how they drift apart, and the one that drifts is always the one
   * fewer people look at.
   */
  function reportsIn(viewer: Viewer, scope: Scope): { kept: unknown[]; withheld: number } {
    const groups = repos.organization.leadershipGroupIds();
    const all = repos.reports.allUnguarded();

    const inScope = all.filter((report) => {
      if (scope.type === "owned") return report.authorId === viewer.person.id;
      if (scope.type === "record") return report.id === scope.id;
      if (scope.type === "ministry") {
        return report.contextType === "ministry" && report.contextId === scope.id;
      }
      if (scope.type === "campus") {
        const author = repos.organization.findPerson(report.authorId);
        return author?.campusId === scope.id;
      }
      return scope.type === "site" || scope.type === "group";
    });

    const withinPeriod = inScope.filter((report) => {
      if (scope.from && report.createdAt < scope.from) return false;
      if (scope.to && report.createdAt > scope.to) return false;
      return true;
    });

    const kept = withinPeriod.filter((report) =>
      canDiscover(report, viewer.persona, viewer.person, groups),
    );

    return { kept, withheld: withinPeriod.length - kept.length };
  }

  /** Organisational records, which are directory-level rather than content. */
  function organizationIn(scope: Scope) {
    const people = repos.organization.people();
    const ministries = repos.organization.ministries();
    const groups = repos.organization.groups();

    if (scope.type === "ministry") {
      const ministry = ministries.filter((m) => m.id === scope.id);
      const memberIds = new Set(ministry.flatMap((m) => [...m.teamIds, m.leadId]));
      return {
        people: people.filter((person) => memberIds.has(person.id)),
        ministries: ministry,
        groups: [],
      };
    }
    if (scope.type === "group") {
      const group = groups.filter((g) => g.id === scope.id);
      const memberIds = new Set(group.flatMap((g) => g.memberIds));
      return {
        people: people.filter((person) => memberIds.has(person.id)),
        ministries: [],
        groups: group,
      };
    }
    if (scope.type === "campus") {
      return {
        people: people.filter((person) => person.campusId === scope.id),
        ministries: ministries.filter((m) => m.campusId === scope.id),
        groups: groups.filter((g) => g.campusId === scope.id),
      };
    }
    if (scope.type === "site") {
      return { people, ministries, groups };
    }
    return { people: [], ministries: [], groups: [] };
  }

  /** CSV of one flat list. Quoted properly, because a name may contain a comma. */
  function toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return "";
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const cell = (value: unknown) => {
      const text =
        value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      columns.join(","),
      ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
    ].join("\n");
  }

  return {
    /**
     * Produce an export, and record that it happened.
     *
     * Synchronous: this installation is one process with a local database, and
     * a queue whose worker is the same process is a queue in name only. The job
     * record exists regardless, because the audit question — who exported what,
     * and when — is worth answering whether or not the work took a while.
     */
    run(viewer: Viewer, request: ExportRequest): ExportResult {
      requireScope(viewer, request.scope);

      const job = jobs.open({
        operation: "export",
        requestedBy: viewer.person.id,
        scope: request.scope,
        format: request.format,
        destination: "download",
      });

      jobs.audit({
        actorId: viewer.person.id,
        action: "export.requested",
        scope: request.scope,
        jobId: job.id,
      });

      try {
        jobs.update(job.id, { status: "running", startedAt: new Date().toISOString() });

        const { kept, withheld } = reportsIn(viewer, request.scope);
        const organization = organizationIn(request.scope);

        const counts = {
          reports: kept.length,
          people: organization.people.length,
          ministries: organization.ministries.length,
          groups: organization.groups.length,
        };
        const recordCount = Object.values(counts).reduce((total, n) => total + n, 0);

        let body: string;
        let name: string;

        if (request.format === "csv") {
          /* One flat list, because a CSV with four shapes in it is not a CSV
             anybody can open. Reports are the list worth analysing. */
          body = toCsv(kept as Record<string, unknown>[]);
          name = `oikonomia-${request.scope.type}-reports.csv`;
        } else if (request.format === "opk") {
          const manifest: PackageManifest = {
            format: OPK_FORMAT,
            formatVersion: OPK_VERSION,
            createdAt: new Date().toISOString(),
            applicationVersion: APPLICATION_VERSION,
            schemaVersion: SCHEMA_VERSION,
            scope: request.scope,
            includes: Object.keys(counts).filter((key) => counts[key as keyof typeof counts] > 0),
            recordCounts: counts,
            generator: "Oikonomia",
          };

          const data = {
            reports: kept,
            people: organization.people,
            ministries: organization.ministries,
            groups: organization.groups,
          };

          /* Checksums over each section, so a package damaged in transit is
             detected before anything is written from it. */
          const checksums: Record<string, string> = {};
          for (const [section, value] of Object.entries(data)) {
            checksums[section] = sha256(JSON.stringify(value));
          }

          body = JSON.stringify({ manifest, data, checksums }, null, 2);
          name = `oikonomia-${request.scope.type}-${Date.now()}.opk`;
        } else {
          body = JSON.stringify(
            { scope: request.scope, counts, withheld, ...organization, reports: kept },
            null,
            2,
          );
          name = `oikonomia-${request.scope.type}.json`;
        }

        const stored = localStorageProvider().put(name, body);

        /* Staged artifacts expire. One sitting on the server indefinitely is a
           copy of confidential material with a weaker gate in front of it than
           the records it came from. */
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const completed = jobs.update(job.id, {
          status: "completed",
          progress: 100,
          completedAt: new Date().toISOString(),
          expiresAt: expires,
          artifactRef: stored.reference,
          artifactBytes: stored.bytes,
          checksum: stored.checksum,
          recordCount,
          withheldCount: withheld,
          schemaVersion: SCHEMA_VERSION,
          applicationVersion: APPLICATION_VERSION,
        })!;

        jobs.audit({
          actorId: viewer.person.id,
          action: "export.completed",
          scope: request.scope,
          jobId: job.id,
          recordCount,
          metadata: { withheld, format: request.format },
        });

        return {
          job: completed,
          artifactRef: stored.reference,
          recordCount,
          withheldCount: withheld,
        };
      } catch (error) {
        jobs.update(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          errorCode: "export_failed",
          errorSummary: error instanceof Error ? error.message : "Unknown failure",
        });
        jobs.audit({
          actorId: viewer.person.id,
          action: "export.failed",
          scope: request.scope,
          jobId: job.id,
          result: "error",
        });
        throw error;
      }
    },

    /**
     * Fetch what an export produced.
     *
     * Authorized **on retrieval**, not only when it was made: a reference is
     * not a capability, and the person asking now may not be the person who
     * asked then. Expired means gone, and gone reads as not found — an
     * artifact somebody may not have should not be distinguishable from one
     * that was never there.
     */
    download(viewer: Viewer, jobId: string): { filename: string; body: Buffer } {
      const job = jobs.find(jobId);
      if (!job || job.operation !== "export" || !job.artifactRef) {
        throw ApiError.notFound("That export");
      }
      if (job.requestedBy !== viewer.person.id) {
        throw ApiError.notFound("That export");
      }
      if (job.expiresAt && job.expiresAt < new Date().toISOString()) {
        throw ApiError.notFound("That export");
      }

      const storage = localStorageProvider();
      if (!storage.exists(job.artifactRef)) throw ApiError.notFound("That export");

      /* Verify before handing it over: a corrupted artifact should be a clear
         failure rather than a file somebody tries to import next week. */
      if (job.checksum && storage.checksum(job.artifactRef) !== job.checksum) {
        jobs.audit({
          actorId: viewer.person.id,
          action: "export.corrupt",
          jobId: job.id,
          result: "error",
        });
        throw ApiError.conflict(text("refusal.export.damaged"));
      }

      jobs.audit({
        actorId: viewer.person.id,
        action: "export.downloaded",
        scope: job.scope,
        jobId: job.id,
      });

      const name = job.artifactRef.split("-").slice(2).join("-") || "oikonomia-export";
      return { filename: name, body: storage.get(job.artifactRef) };
    },
  };
}

export type DataExportService = ReturnType<typeof createDataExportService>;
