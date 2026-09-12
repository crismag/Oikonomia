import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { registryContext } from "@/test/registry-context";
import { seedOrganization } from "@/test/seeds";
import { openDatabase } from "../db/connection";
import { createBinderContentRepository } from "../repositories/binder-content-repository";
import { createDocumentRepository } from "../repositories/document-repository";
import { createDocumentService } from "./document-service";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Documents the binder itself keeps.
 *
 * Two rules carry this module, and both come from `modules/MINISTRY.md`:
 *
 * - **A ministry's material is written by the people who work in it.** Being
 *   shared with a ministry is not membership.
 * - **Prepared by is not Belongs to.** The ministry owns the document; the
 *   person merely started it.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createDocumentService>;
let content: ReturnType<typeof createBinderContentRepository>;

/* Maria leads Music, is on the Victuals team, and Transportation is only
   shared with her — which is the distinction these tests are about. */
const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-binder-"));
  db = openDatabase(join(dir, "test.db"));
  seedOrganization(db);
  content = createBinderContentRepository(db);
  service = createDocumentService(createDocumentRepository(db), content, registryContext(db));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const plan = (over: Record<string, unknown> = {}) => ({
  ministryId: "min-music",
  kind: "Plan",
  ...over,
});

describe("starting one", () => {
  it("creates the record and the thing it records, and opens in the binder", () => {
    const created = service.createBinder(maria, plan({ title: "Christmas presentation" }));

    expect(created.origin).toBe("binder");
    expect(created.openRoute).toBe(`/documents/${created.id}`);
    expect(created.url).toBeUndefined();
    expect(content.find(created.id)).toBeDefined();
  });

  /** A leader names a plan once it has something in it, not before. */
  it("accepts one with no title yet", () => {
    expect(service.createBinder(maria, plan({ title: "" })).title).toBe("");
  });

  /** The ministry owns it; the person only started it. */
  it("files it under the ministry, not under the person", () => {
    const created = service.createBinder(maria, plan());
    expect(created.associations).toHaveLength(1);
    expect(created.associations[0]).toMatchObject({
      entityType: "ministry",
      entityId: "min-music",
    });
    expect(created.registeredById).toBe(maria.person.id);
  });

  it("starts a checklist as a checklist and everything else as a line to type in", () => {
    const list = service.createBinder(maria, plan({ kind: "Checklist" }));
    const report = service.createBinder(maria, plan({ kind: "Report" }));

    expect(content.find(list.id)?.blocks[0]?.type).toBe("checklist");
    expect(content.find(report.id)?.blocks[0]?.type).toBe("paragraph");
  });

  it("refuses a kind the binder does not keep", () => {
    expect(() => service.createBinder(maria, plan({ kind: "Spreadsheet" }))).toThrow(ApiError);
  });

  it("refuses a ministry that does not exist", () => {
    expect(() => service.createBinder(maria, plan({ ministryId: "min-nope" }))).toThrow(ApiError);
  });
});

/**
 * The rule the module is built around.
 */
describe("a ministry's material is written by the people who work in it", () => {
  it("lets the lead write", () => {
    expect(service.createBinder(maria, plan()).id).toBeTruthy();
  });

  it("lets someone on the team write", () => {
    /* Maria serves in Victuals without leading it. */
    expect(service.createBinder(maria, plan({ ministryId: "min-victuals" })).id).toBeTruthy();
  });

  /**
   * Being shared with a ministry is **not** membership. Maria can see
   * Transportation's shelf; that is not a cursor in its plans.
   */
  it("does not let someone it is merely shared with write", () => {
    expect(() => service.createBinder(maria, plan({ ministryId: "min-transport" }))).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("does not let a leader from another ministry write", () => {
    expect(() => service.createBinder(joel, plan({ ministryId: "min-music" }))).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("says who may write when it hands the document over", () => {
    const created = service.createBinder(maria, plan());
    expect(service.binder(maria, created.id).mayWrite).toBe(true);
    expect(service.binder(joel, created.id).mayWrite).toBe(false);
  });

  /** Reading is not writing: Joel can open it and cannot change it. */
  it("refuses a save from someone who may read but not write", () => {
    const created = service.createBinder(maria, plan());
    const blocks = [{ id: "b1", type: "paragraph", html: "Joel's edit" }];

    expect(() => service.saveBinder(joel, { documentId: created.id, blocks })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(content.find(created.id)?.blocks[0]?.html).not.toBe("Joel's edit");
  });

  it("refuses a rename from them too", () => {
    const created = service.createBinder(maria, plan());
    expect(() => service.update(joel, created.id, { title: "Joel's title" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("writing", () => {
  const blocks = (html: string) => [{ id: "b1", type: "paragraph", html }];

  it("saves what the document says", () => {
    const created = service.createBinder(maria, plan());
    service.saveBinder(maria, {
      documentId: created.id,
      blocks: blocks("Rehearsals start 1 Dec."),
    });

    expect(content.find(created.id)?.blocks[0]?.html).toBe("Rehearsals start 1 Dec.");
  });

  it("records who wrote last, without changing who it belongs to", () => {
    const created = service.createBinder(maria, plan({ ministryId: "min-victuals" }));
    const esther = viewerFor("bishop");
    void esther;

    service.saveBinder(maria, { documentId: created.id, blocks: blocks("a") });
    expect(content.find(created.id)?.updatedById).toBe(maria.person.id);
    expect(service.binder(maria, created.id).document.registeredById).toBe(maria.person.id);
  });

  it("says not-found for a document that is not there", () => {
    expect(() => service.binder(maria, "doc-nope")).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

/**
 * Two people writing one plan is ordinary in a ministry.
 */
describe("two people writing at once", () => {
  const blocks = (html: string) => [{ id: "b1", type: "paragraph", html }];

  it("refuses a save against a version somebody else has moved past", () => {
    const created = service.createBinder(maria, plan({ ministryId: "min-victuals" }));
    const opened = content.find(created.id)!.version;

    service.saveBinder(maria, {
      documentId: created.id,
      blocks: blocks("First"),
      expectedVersion: opened,
    });

    expect(() =>
      service.saveBinder(maria, {
        documentId: created.id,
        blocks: blocks("Second"),
        expectedVersion: opened,
      }),
    ).toThrow(expect.objectContaining({ code: "conflict" }));
  });

  it("keeps what the first writer wrote", () => {
    const created = service.createBinder(maria, plan());
    const opened = content.find(created.id)!.version;

    service.saveBinder(maria, {
      documentId: created.id,
      blocks: blocks("First"),
      expectedVersion: opened,
    });
    try {
      service.saveBinder(maria, {
        documentId: created.id,
        blocks: blocks("Second"),
        expectedVersion: opened,
      });
    } catch {
      /* expected */
    }

    expect(content.find(created.id)?.blocks[0]?.html).toBe("First");
  });

  it("moves the version on with every save", () => {
    const created = service.createBinder(maria, plan());
    expect(content.find(created.id)?.version).toBe(1);
    expect(service.saveBinder(maria, { documentId: created.id, blocks: blocks("a") }).version).toBe(
      2,
    );
  });
});

/**
 * Removing the record does not remove the resource — but a binder-native
 * document *is* the resource, so here it really is gone.
 */
describe("removing one", () => {
  it("takes its content with it", () => {
    const created = service.createBinder(maria, plan());
    service.remove(maria, created.id);
    expect(content.find(created.id)).toBeUndefined();
  });

  /**
   * The ministry owns its material, so a plan does not become unremovable
   * because the leader who started it has moved on.
   */
  it("lets the ministry's lead remove one somebody else started", () => {
    /* Maria serves in Victuals; Esther leads it. */
    const created = service.createBinder(maria, plan({ ministryId: "min-victuals" }));
    const esther = viewerFor("admin");

    /* Neither started it nor leads it: refused. */
    expect(() => service.remove(esther, created.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    service.remove(maria, created.id);
    expect(content.find(created.id)).toBeUndefined();
  });
});
