import type { Database as Db } from "better-sqlite3";

import { createFormsRepository } from "@/server/repositories/forms-repository";
import { createLeadershipReportRepository } from "@/server/repositories/leadership-report-repository";
import { createOrganizationRepository } from "@/server/repositories/organization-repository";
import { createWorkRepository } from "@/server/repositories/work-repository";
import type { RegistryContext } from "@/server/services/document-service";

/** The registry's lookups, assembled from one test database. */
export function registryContext(db: Db): RegistryContext {
  return {
    organization: createOrganizationRepository(db),
    reports: createLeadershipReportRepository(db),
    work: createWorkRepository(db),
    forms: createFormsRepository(db),
  };
}
