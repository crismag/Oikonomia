import type { Database as Db } from "better-sqlite3";

import { formDefinitions, formRecords } from "@/test/form-fixtures";
import { createFormsRepository } from "@/server/repositories/forms-repository";
import type { DefinitionValues, RecordValues } from "@/server/repositories/forms-repository";

/**
 * Development seed for Forms.
 *
 * The shipped checklists — the Victuals weekly sheet the form builder was
 * derived from, and the records already filled against it — so the feature is
 * demonstrable rather than a blank page.
 *
 * Written into an **empty** table only.
 */
export function seedForms(db: Db): boolean {
  const repo = createFormsRepository(db);
  if (!repo.isEmpty()) return false;

  const seed = db.transaction(() => {
    for (const definition of formDefinitions) {
      const { id, createdAt: _c, updatedAt: _u, ...values } = definition;
      repo.insertDefinition(values as DefinitionValues, id);
    }
    for (const record of formRecords) {
      const { id, createdAt: _c, updatedAt: _u, ...values } = record;
      repo.insertRecord(values as RecordValues, id);
    }
  });

  seed();
  return true;
}
