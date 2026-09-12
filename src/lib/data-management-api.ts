import { createServerFn } from "@tanstack/react-start";

import type { Result } from "./api-envelope";
import type { Scope } from "@/domain/data-management";

/**
 * Data management's API.
 *
 * Every call resolves the viewer and refuses on its own. Nothing here trusts a
 * scope because the screen sent it: the services check what may be asked for,
 * and then check every record that comes back.
 */

export type DataJob = import("@/domain/data-management").DataJob;
export type ContinuityView = Awaited<
  ReturnType<import("@/server/services/continuity-service").ContinuityService["status"]>
>;

async function serverParts() {
  const [
    { ApiError },
    { requireCurrentUser },
    { getDatabase },
    { refreshConfiguration },
    { createDataJobRepository },
    { createOrganizationRepository },
    { createLeadershipReportRepository },
    { createMeetingRepository },
    { createDataExportService },
    { createContinuityService },
    { getRequest },
  ] = await Promise.all([
    import("@/server/api/response"),
    import("@/server/auth/require-user"),
    import("@/server/db/connection"),
    import("@/server/config/runtime"),
    import("@/server/repositories/data-job-repository"),
    import("@/server/repositories/organization-repository"),
    import("@/server/repositories/leadership-report-repository"),
    import("@/server/repositories/meeting-repository"),
    import("@/server/services/data-export-service"),
    import("@/server/services/continuity-service"),
    import("@tanstack/react-start/server"),
  ]);

  const db = getDatabase();
  refreshConfiguration(db);

  const jobs = createDataJobRepository(db);

  return {
    ApiError,
    jobs,
    exports: createDataExportService(jobs, {
      organization: createOrganizationRepository(db),
      reports: createLeadershipReportRepository(db),
      meetings: createMeetingRepository(db),
    }),
    continuity: createContinuityService(db, jobs),
    viewer: requireCurrentUser(getRequest(), db),
  };
}

async function withData<T>(
  work: (parts: Awaited<ReturnType<typeof serverParts>>) => T,
): Promise<Result<T>> {
  try {
    const parts = await serverParts();
    try {
      return { data: work(parts) };
    } catch (error) {
      if (error instanceof parts.ApiError) return { error: error.body() };
      throw error;
    }
  } catch (error) {
    const { ApiError } = await import("@/server/api/response");
    if (error instanceof ApiError) return { error: error.body() };
    console.error(error);
    return { error: { code: "internal", message: "That could not be done. Please try again." } };
  }
}

export const runExport = createServerFn({ method: "POST" })
  .validator((input: { scope: Scope; format: "json" | "csv" | "opk" }) => input)
  .handler(({ data }) =>
    withData(({ exports, viewer }) => {
      const result = exports.run(viewer, data);
      return {
        job: result.job,
        recordCount: result.recordCount,
        withheldCount: result.withheldCount,
      };
    }),
  );

/**
 * Fetch what an export produced.
 *
 * Base64 rather than a URL, deliberately: a downloadable path is a second way
 * in with a weaker gate in front of it, and this way every fetch passes the
 * same authorization the rest of the product uses.
 */
export const downloadExport = createServerFn({ method: "GET" })
  .validator((input: { jobId: string }) => input)
  .handler(({ data }) =>
    withData(({ exports, viewer }) => {
      const artifact = exports.download(viewer, data.jobId);
      return { filename: artifact.filename, base64: artifact.body.toString("base64") };
    }),
  );

export const fetchDataJobs = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withData(({ jobs, viewer }) => {
      /* An administrator sees the installation's operations; everybody else
         sees their own, because a job row names a scope somebody chose. */
      const all = jobs.recent(50);
      return viewer.persona.capabilities.includes("administration")
        ? all
        : all.filter((job) => job.requestedBy === viewer.person.id);
    }),
  );

export const fetchContinuity = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() => withData(({ continuity, viewer }) => continuity.status(viewer)));

export const runBackup = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() => withData(({ continuity, viewer }) => continuity.runBackup(viewer)));

export const verifyBackup = createServerFn({ method: "POST" })
  .validator((input: { jobId: string }) => input)
  .handler(({ data }) =>
    withData(({ continuity, viewer }) => continuity.verifyBackup(viewer, data.jobId)),
  );

export const validatePackage = createServerFn({ method: "POST" })
  .validator((input: { content: string }) => input)
  .handler(({ data }) =>
    withData(({ continuity, viewer }) => continuity.validatePackage(viewer, data.content)),
  );

export const runRetention = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(() => withData(({ continuity, viewer }) => continuity.runRetention(viewer)));

export const setRetentionPolicy = createServerFn({ method: "POST" })
  .validator(
    (input: {
      artifactClass: string;
      retentionDays?: number;
      enabled?: boolean;
      onHold?: boolean;
    }) => input,
  )
  .handler(({ data }) =>
    withData(({ continuity, viewer }) => continuity.setRetention(viewer, data.artifactClass, data)),
  );

export const fetchDataAudit = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withData(({ jobs, viewer }) => {
      if (!viewer.persona.capabilities.includes("administration")) {
        throw new Error("forbidden");
      }
      return jobs.auditTrail();
    }),
  );
