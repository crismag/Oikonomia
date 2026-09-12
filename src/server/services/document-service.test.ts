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
import { createMeetingRepository } from "../repositories/meeting-repository";
import { createDocumentService } from "./document-service";
import { canView } from "@/domain/authorize";
import { viewerFor } from "@/test/viewer";
import type { NoteValues } from "../repositories/meeting-repository";
import type { Database as Db } from "better-sqlite3";

/**
 * The document registry.
 *
 * Two things are worth testing hardest here, and they are the two the registry
 * contract calls invariants: **a document and its association are different
 * concepts**, and **discoverability is enforced before anything is counted.**
 */

let dir: string;
let db: Db;
let repo: ReturnType<typeof createDocumentRepository>;
let notes: ReturnType<typeof createMeetingRepository>;
let service: ReturnType<typeof createDocumentService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-registry-"));
  db = openDatabase(join(dir, "test.db"));
  seedOrganization(db);
  repo = createDocumentRepository(db);
  notes = createMeetingRepository(db);
  service = createDocumentService(repo, createBinderContentRepository(db), registryContext(db));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const doc = (over: Record<string, unknown> = {}) => ({
  title: "September planning sheet",
  url: "https://docs.google.com/spreadsheets/d/abc",
  kind: "Spreadsheet",
  ...over,
});

describe("registering a resource", () => {
  it("persists it and gives it an id", () => {
    const registered = service.register(maria, doc());
    expect(registered.id).toMatch(/^doc-/);
    expect(service.get(maria, registered.id).title).toBe("September planning sheet");
  });

  it("records who registered it", () => {
    expect(service.register(maria, doc()).registeredById).toBe(maria.person.id);
  });

  it("refuses one with no name to look for it by", () => {
    expect(() => service.register(maria, doc({ title: "  " }))).toThrow(ApiError);
  });

  /* A resource kept elsewhere and registered without saying where cannot be
     opened and cannot be found again. */
  it("refuses one with no address", () => {
    expect(() => service.register(maria, doc({ url: "not a url" }))).toThrow(ApiError);
  });

  /**
   * Invariant 8: storage differences must not leak into the user-facing model.
   * The origin is read off the address and used as a supporting line; it never
   * becomes a category and nothing is checked, fetched or connected to.
   */
  it("reads where the resource lives off its address", () => {
    expect(service.register(maria, doc()).origin).toBe("drive");
    expect(service.register(maria, doc({ url: "https://example.org/a.pdf" })).origin).toBe("link");
  });
});

/**
 * §3 of the registry contract, and the gap it was written to close.
 */
describe("a document and its association are different concepts", () => {
  it("takes part in several places without being duplicated", () => {
    const registered = service.register(
      maria,
      doc({
        associations: [
          { entityType: "ministry", entityId: "min-music" },
          { entityType: "leadership-report", entityId: "lr-1", relationship: "supporting" },
        ],
      }),
    );

    const found = service.search(maria, { search: "September planning" }).resources;
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(registered.id);
    expect(found[0]!.associations.map((a) => a.section).sort()).toEqual([
      "leadership-reports",
      "ministry",
    ]);
  });

  it("filing it in the same place twice does not make a second record", () => {
    const registered = service.register(maria, doc());
    service.associate(maria, {
      documentId: registered.id,
      entityType: "ministry",
      entityId: "min-music",
    });
    service.associate(maria, {
      documentId: registered.id,
      entityType: "ministry",
      entityId: "min-music",
    });

    expect(service.get(maria, registered.id).associations).toHaveLength(1);
  });

  /** Gap 3: the relationship is recorded, not inferred from a field name. */
  it("records how the document takes part, not only that it does", () => {
    const registered = service.register(
      maria,
      doc({
        associations: [
          { entityType: "leadership-report", entityId: "lr-1", relationship: "report-content" },
        ],
      }),
    );
    expect(service.get(maria, registered.id).associations[0]!.relationship).toBe("report-content");
  });

  it("unfiling it from one place leaves the document and its other places", () => {
    const registered = service.register(
      maria,
      doc({
        associations: [
          { entityType: "ministry", entityId: "min-music" },
          { entityType: "ministry", entityId: "min-victuals" },
        ],
      }),
    );
    const first = service.get(maria, registered.id).associations[0]!;
    service.removeAssociation(maria, first.id);

    const after = service.get(maria, registered.id);
    expect(after.associations).toHaveLength(1);
  });

  it("removing the record removes its filings with it", () => {
    const registered = service.register(
      maria,
      doc({ associations: [{ entityType: "ministry", entityId: "min-music" }] }),
    );
    service.remove(maria, registered.id);

    const left = db
      .prepare("SELECT COUNT(*) AS n FROM document_association WHERE document_id = ?")
      .get(registered.id) as { n: number };
    expect(left.n).toBe(0);
  });

  /**
   * Removing the record does not remove the resource. Nobody else's account of
   * where something lives is theirs to delete either.
   */
  it("lets only whoever registered it remove it", () => {
    const registered = service.register(maria, doc());
    expect(() => service.remove(joel, registered.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("finding things", () => {
  it("searches the title, the description, the kind and the tags", () => {
    service.register(maria, doc({ title: "Camp master sheet", tags: ["camp"] }));
    service.register(maria, doc({ title: "Ushers rota", description: "Who is on the door." }));

    const titles = (q: string) =>
      service.search(maria, { search: q }).resources.map((r) => r.title);
    expect(titles("camp")).toEqual(["Camp master sheet"]);
    expect(titles("door")).toEqual(["Ushers rota"]);
    expect(titles("spreadsheet")).toHaveLength(2);
  });

  it("pages, and says how many there are", () => {
    for (let i = 0; i < 30; i += 1) service.register(maria, doc({ title: `Sheet ${i}` }));
    const first = service.search(maria, { page: 1, pageSize: 25 });
    expect(first.resources).toHaveLength(25);
    expect(first.page).toMatchObject({ pageCount: 2, total: 30 });
  });

  it("puts a title match above a description match", () => {
    service.register(maria, doc({ title: "Something else", description: "About the rota." }));
    service.register(maria, doc({ title: "Rota" }));

    expect(service.search(maria, { search: "rota" }).resources[0]!.title).toBe("Rota");
  });

  it("names the place a document takes part in, so a result is not unplaced", () => {
    service.register(
      maria,
      doc({ associations: [{ entityType: "ministry", entityId: "min-music" }] }),
    );
    const [found] = service.search(maria, {}).resources;
    expect(found!.associations[0]).toMatchObject({ section: "ministry", label: "Music Ministry" });
  });
});

/**
 * Boundary 1. The part that matters.
 */
describe("discoverability", () => {
  const personalNote = (authorId: string) =>
    notes.insertNote({
      title: "Personal reflections",
      noteType: "personal",
      date: "2026-09-01",
      status: "draft",
      authorId,
    } as NoteValues);

  it("hides a document reachable only through a note the viewer cannot read", () => {
    const note = personalNote(maria.person.id);
    service.register(
      maria,
      doc({
        title: "Attached to a private note",
        associations: [{ entityType: "meeting-note", entityId: note.id }],
      }),
    );

    expect(service.search(maria, {}).resources).toHaveLength(1);
    expect(service.search(joel, {}).resources).toHaveLength(0);
  });

  /** A count that includes withheld resources is a leak whether or not any
      title is shown. */
  it("does not count it in the total", () => {
    const note = personalNote(maria.person.id);
    service.register(
      maria,
      doc({ associations: [{ entityType: "meeting-note", entityId: note.id }] }),
    );
    service.register(maria, doc({ title: "Ordinary" }));

    expect(service.search(joel, {}).page.total).toBe(1);
  });

  it("does not count it in a filter suggestion either", () => {
    const note = personalNote(maria.person.id);
    service.register(
      maria,
      doc({
        tags: ["private-thing"],
        associations: [{ entityType: "meeting-note", entityId: note.id }],
      }),
    );

    expect(service.filterOptions(joel, {}).tags.map((t) => t.tag)).not.toContain("private-thing");
    expect(service.filterOptions(maria, {}).tags.map((t) => t.tag)).toContain("private-thing");
  });

  /** A deep link must not reveal what search would not — and "you may not see
      this" still says that it exists, so withholding is a 404. */
  it("withholds it from a direct link, as not-found", () => {
    const note = personalNote(maria.person.id);
    const registered = service.register(
      maria,
      doc({ associations: [{ entityType: "meeting-note", entityId: note.id }] }),
    );

    expect(() => service.get(joel, registered.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  /** Filed in two places, one of them readable: still findable through that one. */
  it("shows it when any one of its places is one the viewer may know about", () => {
    const note = personalNote(maria.person.id);
    service.register(
      maria,
      doc({
        associations: [
          { entityType: "meeting-note", entityId: note.id },
          { entityType: "ministry", entityId: "min-music" },
        ],
      }),
    );
    expect(service.search(joel, {}).resources).toHaveLength(1);
  });

  /**
   * Binder material carries no rule, and that is a stated position rather than
   * an oversight. This test exists so that the day someone adds a filter, it
   * fails and they have to come and say what the rule now is.
   */
  it("shows ordinary binder material to every leader, because no rule exists yet", () => {
    service.register(
      maria,
      doc({ associations: [{ entityType: "ministry", entityId: "min-music" }] }),
    );
    expect(service.search(joel, {}).resources).toHaveLength(1);
  });

  /**
   * The SQL in `note-readability.ts` and the rule in `domain/authorize.ts` are
   * the same rule written twice. This compares them directly, so the day one
   * moves without the other, a test says so.
   */
  it("agrees with the rule stated in the domain", () => {
    const mine = personalNote(maria.person.id);
    const theirs = personalNote(joel.person.id);
    const minutes = notes.insertNote({
      title: "Leaders' meeting",
      noteType: "minutes",
      date: "2026-09-02",
      status: "draft",
      authorId: joel.person.id,
      participantIds: [maria.person.id],
    } as NoteValues);

    for (const note of [mine, theirs, minutes]) {
      const registered = service.register(maria, {
        ...doc({ title: `For ${note.id}` }),
        associations: [{ entityType: "meeting-note", entityId: note.id }],
      });

      for (const viewer of [maria, joel]) {
        const byRegistry = service.search(viewer, {}).resources.some((r) => r.id === registered.id);
        const byDomain = canView(viewer, { kind: "meeting-note", note });
        expect(byRegistry, `${note.id} for ${viewer.person.id}`).toBe(byDomain);
      }
    }
  });
});
