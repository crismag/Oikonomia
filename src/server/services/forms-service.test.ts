import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createFormsRepository } from "../repositories/forms-repository";
import { createFormsService } from "./forms-service";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Forms.
 *
 * The invariant worth protecting is that **a filled-in record outlives the
 * design it came from**. Editing a master checklist must not rewrite what
 * somebody already answered, and a completed record must not quietly change.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createFormsService>;
let repo: ReturnType<typeof createFormsRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");

const section = (id: string, title: string) => ({
  id,
  title,
  fields: [{ id: `${id}-f1`, label: title, type: "text" }],
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-forms-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createFormsRepository(db);
  service = createFormsService(repo);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("designing a form", () => {
  it("starts at version 1, as a draft, owned by whoever made it", () => {
    const definition = service.createDefinition(maria, { title: "Weekly check" });
    expect(definition.version).toBe(1);
    expect(definition.status).toBe("draft");
    expect(definition.ownerId).toBe(maria.person.id);
  });

  it("publishes and moves the version on when the structure is saved", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    const saved = service.saveDefinition(maria, {
      id: created.id,
      sections: [section("s1", "Who checked?")],
      summary: "First draft",
    });
    expect(saved.version).toBe(2);
    expect(saved.status).toBe("published");
    expect(saved.history[0]?.summary).toBe("First draft");
  });

  it("refuses a title that is only whitespace", () => {
    expect(() => service.createDefinition(maria, { title: "   " })).toThrow(ApiError);
  });

  it("refuses to let somebody else redesign it", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    expect(() => service.saveDefinition(joel, { id: created.id, sections: [] })).toThrow(ApiError);
    expect(() => service.renameDefinition(joel, { id: created.id, title: "Mine now" })).toThrow(
      ApiError,
    );
    expect(() => service.deleteDefinition(joel, created.id)).toThrow(ApiError);
  });

  it("gives a copy its own life rather than the original's history", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.saveDefinition(maria, { id: created.id, sections: [section("s1", "Who checked?")] });

    const copy = service.copyDefinition(joel, created.id, "Youth weekly check");
    expect(copy.ownerId).toBe(joel.person.id);
    expect(copy.version).toBe(1);
    expect(copy.history).toHaveLength(1);
    expect(copy.sections.map((s) => s.id)).toEqual(["s1"]);
  });

  it("is not found once deleted", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.deleteDefinition(maria, created.id);
    expect(() => service.saveDefinition(maria, { id: created.id, sections: [] })).toThrow(ApiError);
  });
});

describe("a record outliving its design", () => {
  it("captures the structure and the version it was started from", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    const published = service.saveDefinition(maria, {
      id: created.id,
      sections: [section("s1", "Who checked?")],
    });

    const record = service.createRecord(joel, { definitionId: created.id, period: "September" });
    expect(record.formVersion).toBe(published.version);
    expect(record.sections.map((s) => s.title)).toEqual(["Who checked?"]);
  });

  it("does not rewrite a started record when the master is edited", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.saveDefinition(maria, { id: created.id, sections: [section("s1", "Who checked?")] });
    const record = service.createRecord(joel, { definitionId: created.id });

    service.saveDefinition(maria, {
      id: created.id,
      sections: [section("s9", "Totally different")],
      summary: "Rewritten",
    });

    const after = service.all(joel).records.find((r) => r.id === record.id);
    expect(after?.formVersion).toBe(2);
    expect(after?.sections.map((s) => s.title)).toEqual(["Who checked?"]);
  });

  it("keeps answers under their field, replacing rather than duplicating", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.saveDefinition(maria, { id: created.id, sections: [section("s1", "Who checked?")] });
    const record = service.createRecord(joel, { definitionId: created.id });

    service.setResponse(joel, {
      recordId: record.id,
      response: { fieldId: "s1-f1", value: "Maria" },
    });
    const second = service.setResponse(joel, {
      recordId: record.id,
      response: { fieldId: "s1-f1", value: "Joel" },
      label: "Answered",
    });

    expect(second.responses).toHaveLength(1);
    expect(second.responses[0]?.value).toBe("Joel");
    expect(second.history.at(-1)?.text).toBe("Answered");
  });

  it("refuses to change a completed record until it is reopened", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.saveDefinition(maria, { id: created.id, sections: [section("s1", "Who checked?")] });
    const record = service.createRecord(joel, { definitionId: created.id });

    const completed = service.completeRecord(joel, record.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();

    expect(() =>
      service.setResponse(joel, {
        recordId: record.id,
        response: { fieldId: "s1-f1", value: "changed" },
      }),
    ).toThrow(ApiError);

    const reopened = service.reopenRecord(joel, record.id);
    expect(reopened.status).toBe("in-progress");
    expect(reopened.completedAt).toBeUndefined();
    expect(() =>
      service.setResponse(joel, {
        recordId: record.id,
        response: { fieldId: "s1-f1", value: "changed" },
      }),
    ).not.toThrow();
  });

  it("cannot be started from a form that does not exist", () => {
    expect(() => service.createRecord(joel, { definitionId: "nope" })).toThrow(ApiError);
  });
});

/**
 * Deleting a form's design never deletes what was filled in with it. A form
 * nobody used is removed; a form with records is archived, and its records stay.
 */
describe("deleting a form", () => {
  it("removes a form nothing was made from", () => {
    const created = service.createDefinition(maria, { title: "Unused" });
    expect(service.deleteDefinition(maria, created.id)).toEqual({ outcome: "deleted" });
    expect(repo.findDefinition(created.id)).toBeUndefined();
  });

  it("archives a form that has records, and keeps every record", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.saveDefinition(maria, { id: created.id, sections: [section("s1", "Lights off?")] });
    const record = service.createRecord(maria, { definitionId: created.id });

    expect(service.deleteDefinition(maria, created.id)).toEqual({ outcome: "archived" });
    expect(repo.findDefinition(created.id)?.archivedAt).toBeTruthy();
    expect(repo.findRecord(record.id)?.sections.map((s) => s.id)).toEqual(["s1"]);
  });

  it("offers an archived form for no new records", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    service.createRecord(maria, { definitionId: created.id });
    service.deleteDefinition(maria, created.id);
    expect(() => service.createRecord(maria, { definitionId: created.id })).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("is refused by the database too, so a record is never deleted with its form", () => {
    const created = service.createDefinition(maria, { title: "Weekly check" });
    const record = service.createRecord(maria, { definitionId: created.id });
    expect(() => repo.deleteDefinition(created.id)).toThrow();
    expect(repo.findRecord(record.id)).toBeDefined();
  });
});
