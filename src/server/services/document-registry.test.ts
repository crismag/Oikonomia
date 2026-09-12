import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ministries } from "@/test/fixtures";
import { registryContext } from "@/test/registry-context";
import { createLeadershipReportRepository } from "../repositories/leadership-report-repository";
import { openDatabase } from "../db/connection";
import {
  seedDocuments,
  seedLifegroup,
  seedOrganization,
  seedReports,
  seedWork,
} from "@/test/seeds";
import { createBinderContentRepository } from "../repositories/binder-content-repository";
import { createDocumentRepository } from "../repositories/document-repository";
import { createDocumentService } from "./document-service";
import { binderSections, contextPath, sectionLabel } from "@/domain/resources";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";
import type { ResourceSearchResult } from "@/domain/types";

/**
 * How the registry behaves once it holds the binder's real material.
 *
 * These cases were written against the in-memory projection that search used
 * before there was a registry, and they moved here with it. They guard the two
 * things that make finding a resource trustworthy: that **application context
 * is the organizing idea** rather than where the bytes are, and that **nothing
 * the viewer may not discover leaks** — through a row, a tag, or a count.
 *
 * The registry is seeded from the shipped fixtures, so what is asserted below
 * is what a leader would actually see on the page.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createDocumentService>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");
const admin = viewerFor("admin");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-registry-fixtures-"));
  db = openDatabase(join(dir, "test.db"));
  seedOrganization(db);
  /* LifeGroup too: a gathering is what gives a LifeGroup resource its context,
     and the registry resolves that from the record rather than storing it. */
  seedLifegroup(db);
  /* The registry gates a document on the record it is attached to, so those
     records have to exist: a report nobody stored cannot withhold anything. */
  seedReports(db);
  seedWork(db);
  seedDocuments(db);
  service = createDocumentService(
    createDocumentRepository(db),
    createBinderContentRepository(db),
    registryContext(db),
  );
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

type Viewer = typeof maria;

const find = (results: ResourceSearchResult[], id: string) => results.find((r) => r.id === id);
/* Unpaged, because these are statements about the whole result set. */
const search = (who: Viewer, filters: Record<string, unknown> = {}) =>
  service.search(who, { ...filters, pageSize: 100 }).resources;
const titles = (who: Viewer, filters: Record<string, unknown> = {}) =>
  search(who, filters).map((r) => r.title);
const options = (who: Viewer) => service.filterOptions(who, {});

/* ======================= §47 — searching by metadata ==================== */

describe("searching finds resources by what the application knows", () => {
  it("matches a title", () => {
    expect(titles(maria, { search: "rota" }).join(" ")).toMatch(/rota/i);
  });

  it("matches a description", () => {
    const hits = search(maria, { search: "coordinate" });
    expect(hits.some((r) => (r.description ?? "").toLowerCase().includes("coordinate"))).toBe(true);
  });

  it("matches the context a resource participates in", () => {
    const hits = search(maria, { search: "music ministry" });
    expect(
      hits.every((r) =>
        r.associations.some(
          (a) => a.label?.includes("Music") || sectionLabel[a.section].includes("Ministry"),
        ),
      ),
    ).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("matches a tag with or without the hash", () => {
    const withHash = search(maria, { search: "#music" }).map((r) => r.id);
    const without = search(maria, { search: "music" }).map((r) => r.id);
    expect(withHash.length).toBeGreaterThan(0);
    for (const id of withHash) expect(without).toContain(id);
  });

  it("returns everything discoverable for an empty query", () => {
    expect(search(maria).length).toBeGreaterThan(search(maria, { search: "rota" }).length);
  });

  it("ranks a title match above a description match", () => {
    const hits = search(maria, { search: "planning", sort: "relevance" });
    const firstTitle = hits[0]?.title.toLowerCase() ?? "";
    expect(firstTitle).toContain("planning");
  });
});

/* ===================== §48 / §16 — context filtering ==================== */

describe("filtering by where the work happened", () => {
  it("filters by binder section", () => {
    const hits = search(maria, { section: "reach-out" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.associations.some((a) => a.section === "reach-out"))).toBe(true);
  });

  it("filters by a specific ministry", () => {
    const hits = search(maria, { relatedLabel: "Music Ministry" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.associations.some((a) => a.label === "Music Ministry"))).toBe(true);
  });

  it("filters by tag", () => {
    const hits = search(maria, { tag: "music" });
    expect(hits.every((r) => r.tags.includes("music"))).toBe(true);
  });

  it("filters by who added it", () => {
    const hits = search(maria, { addedById: "p-maria" });
    expect(hits.every((r) => r.addedById === "p-maria")).toBe(true);
  });

  it("combines filters", () => {
    const hits = search(maria, { section: "reach-out", query: "tracker" });
    expect(hits.every((r) => r.associations.some((a) => a.section === "reach-out"))).toBe(true);
  });

  /** §7 — storage is never the primary axis. */
  it("offers no filter keyed on where the bytes live", () => {
    const facets = options(maria);
    expect(Object.keys(facets)).toEqual(["sections", "related", "tags", "people"]);
    for (const { section } of facets.sections) expect(binderSections).toContain(section);
  });
});

/* ================== §19 / §52 — Reach-Out is not a ministry ============= */

describe("Reach-Out is a top-level working area", () => {
  const reachOut = () => search(maria).filter((r) => r.id.startsWith("doc-ro-"));

  it("associates its resources with Reach-Out itself", () => {
    const hits = reachOut();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.associations.some((a) => a.section === "reach-out"))).toBe(true);
  });

  it("never renders them as a ministry", () => {
    for (const resource of reachOut()) {
      for (const association of resource.associations) {
        expect(contextPath(association)).not.toMatch(/Ministry ›\s*Reach-Out/);
        if (association.section === "reach-out") {
          expect(contextPath(association)).toBe("Reach-Out");
        }
      }
    }
  });
});

/* ================ §18 / §53 — LifeGroup context is an occurrence ======== */

describe("LifeGroup context names an occurrence, never a standing group", () => {
  it("builds a venue-and-date path", () => {
    const path = contextPath({
      section: "lifegroup",
      label: "Thomson Park",
      secondaryLabel: "3 September",
    });
    expect(path).toBe("LifeGroup › Thomson Park › 3 September");
  });

  it("labels a real LifeGroup resource by venue and date", () => {
    const notes = find(search(maria), "doc-lg-thomson-notes");
    expect(notes).toBeDefined();
    const lifegroup = notes!.associations.find((a) => a.section === "lifegroup");
    expect(lifegroup).toBeDefined();
    expect(lifegroup!.label).toBe("Thomson Park");
    expect(lifegroup!.secondaryLabel).toBeTruthy();
    expect(contextPath(lifegroup!)).toMatch(/^LifeGroup › Thomson Park › /);
  });

  it("never implies permanent membership", () => {
    for (const resource of search(maria)) {
      for (const association of resource.associations) {
        /* The discarded model named a standing group; the corrected one names
           the place and the day it happened. */
        expect(contextPath(association)).not.toMatch(/Lifegroup Members|Group Member/i);
        expect(contextPath(association)).not.toMatch(/East Lifegroup|West Lifegroup/i);
      }
    }
  });
});

/* ================== §26 / §50 — one resource, many contexts ============= */

describe("a resource with several associations", () => {
  it("appears once, not once per association", () => {
    const results = search(bishop);
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries every context on the single row", () => {
    const many = search(bishop).find((r) => r.associations.length > 1);
    expect(many).toBeDefined();
    expect(many!.associations.length).toBeGreaterThan(1);
  });
});

/* =================== §32 / §33 / §54 — permission leakage =============== */

describe("nothing withheld leaks", () => {
  /**
   * `doc-lr-development-guide` is reachable only through a restricted
   * assessment. Joel wrote it and may discover it; nobody else may — not
   * through a row, a tag, a count or a filter option.
   */
  const guide = "doc-lr-development-guide";

  it("shows the resource to the leader who may discover its report", () => {
    expect(find(search(joel), guide)).toBeDefined();
  });

  it("hides it from everyone else", () => {
    expect(find(search(maria), guide)).toBeUndefined();
    expect(find(search(bishop), guide)).toBeUndefined();
    expect(find(search(admin), guide)).toBeUndefined();
  });

  it("hides it from a search that would otherwise match it", () => {
    expect(find(search(maria, { search: "development guide" }), guide)).toBeUndefined();
    expect(find(search(admin, { search: "leadership" }), guide)).toBeUndefined();
  });

  /** §33 — `#leadership-assessment (4)` when all four are hidden is a leak. */
  it("keeps its tags out of everyone else's tag options", () => {
    const forMaria = options(maria);
    expect(forMaria.tags.map((t) => t.tag)).not.toContain("leadership-assessment");
  });

  it("keeps it out of the counts behind every filter option", () => {
    const forMaria = options(maria);
    const visible = search(maria);
    for (const { section, count } of forMaria.sections) {
      const actual = visible.filter((r) =>
        r.associations.some((a) => a.section === section),
      ).length;
      expect(count).toBe(actual);
    }
  });

  it("keeps it out of the related-record options", () => {
    const forMaria = options(maria);
    expect(forMaria.related.map((r) => r.label)).not.toContain(
      "Confidential Leadership Assessment",
    );
  });

  /** Filtering must never be a way around the gate. */
  it("cannot be reached by filtering directly for it", () => {
    const forced = search(maria, { relatedLabel: "Confidential Leadership Assessment" });
    expect(forced).toHaveLength(0);
  });
});

/* ============================ §34 — sorting ============================= */

describe("sorting", () => {
  it("defaults to recently updated with no query", () => {
    const dated = search(maria).filter((r) => r.updatedAt);
    for (let i = 1; i < dated.length; i += 1) {
      expect(dated[i - 1]!.updatedAt! >= dated[i]!.updatedAt!).toBe(true);
    }
  });

  /** A source without an ISO date must not be ordered by a display string. */
  it("sorts resources with no date last rather than guessing", () => {
    const hits = search(maria);
    const firstUndated = hits.findIndex((r) => !r.updatedAt);
    if (firstUndated >= 0) {
      expect(hits.slice(firstUndated).every((r) => !r.updatedAt)).toBe(true);
    }
  });

  it("sorts by title when asked", () => {
    const hits = search(maria, { sort: "title" });
    const sorted = [...hits].sort((a, b) => a.title.localeCompare(b.title));
    expect(hits.map((r) => r.title)).toEqual(sorted.map((r) => r.title));
  });
});

/* ========================== §29 / §30 — opening ========================= */

describe("opening a resource", () => {
  it("marks external destinations as external", () => {
    const drive = search(maria).filter((r) => r.provider === "Google Drive");
    expect(drive.length).toBeGreaterThan(0);
    expect(drive.every((r) => r.external && !!r.openUrl)).toBe(true);
  });

  it("keeps binder-native resources inside the application", () => {
    const forms = search(maria, { section: "documents-forms" });
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.every((r) => !r.external)).toBe(true);
  });

  /**
   * §30 — appearing in search is a statement about metadata, never a promise
   * that the resource opens. Nothing in the projection claims otherwise.
   */
  it("never claims a resource is accessible", () => {
    for (const resource of search(maria)) {
      expect(resource).not.toHaveProperty("accessible");
      expect(resource).not.toHaveProperty("canOpen");
    }
  });
});

/* =========================== §24 — recognition ========================== */

describe("results carry enough to recognize a resource", () => {
  it("gives most resources a description rather than a filename", () => {
    const hits = search(maria);
    const described = hits.filter((r) => r.description);
    expect(described.length).toBeGreaterThan(hits.length / 2);
  });

  it("gives every resource at least one context", () => {
    for (const resource of search(maria)) {
      expect(resource.associations.length).toBeGreaterThan(0);
    }
  });

  it("renders provider as supporting metadata, not as a section", () => {
    const facets = options(maria);
    for (const { section } of facets.sections) {
      expect(sectionLabel[section]).not.toMatch(/Drive|Local|Cloud|Link$/);
    }
  });
});

/**
 * Asking what is filed against a record is a question about that record.
 *
 * A report id travels: it is in a URL, and a URL gets pasted. If "what is
 * attached to this report?" answered for anybody who asked, the id alone would
 * reveal which documents hang off a confidential record — not its contents,
 * but its shape, which is often enough.
 */
describe("a document shelf is closed when its record is", () => {
  const confidential = () => {
    const reports = createLeadershipReportRepository(db);
    return reports.insert({
      title: "Family difficulty affecting attendance",
      reportType: "pastoral",
      authorId: maria.person.id,
      status: "published",
      visibility: "restricted",
      discussionPolicy: "viewers",
      contentSource: "native",
      audienceIds: [],
      relatedDocumentIds: [],
      links: [],
      tags: [],
    });
  };

  it("answers its author", () => {
    const report = confidential();
    service.register(maria, {
      title: "Notes from the visit",
      url: "https://example.org/notes",
      kind: "document",
      associations: [{ entityType: "leadership-report", entityId: report.id }],
    });

    expect(service.filedAgainst(maria, "leadership-report", report.id)).toHaveLength(1);
  });

  it("answers nothing to somebody who cannot discover the report", () => {
    const report = confidential();
    service.register(maria, {
      title: "Notes from the visit",
      url: "https://example.org/notes",
      kind: "document",
      associations: [{ entityType: "leadership-report", entityId: report.id }],
    });

    /* Not an error — "nothing here" and "not for you" must look the same. */
    expect(service.filedAgainst(bishop, "leadership-report", report.id)).toEqual([]);
    expect(service.filedAgainst(admin, "leadership-report", report.id)).toEqual([]);
  });

  /**
   * The case the anchor check exists for.
   *
   * A document filed in a ministry **and** on a confidential report is
   * legitimately discoverable — through the ministry. Asking for it *by the
   * report's id* is a different question, and answering it would confirm that
   * this document is attached to that report. The document stays findable
   * where it is open; the shelf that names the report does not open.
   */
  it("does not confirm the attachment through a document that is also filed elsewhere", () => {
    const report = confidential();
    const ministryId = ministries[0]!.id;

    service.register(maria, {
      title: "Rota for the visit",
      url: "https://example.org/rota",
      kind: "document",
      associations: [
        { entityType: "ministry", entityId: ministryId },
        { entityType: "leadership-report", entityId: report.id },
      ],
    });

    /* Open where it is open… */
    expect(service.filedAgainst(bishop, "ministry", ministryId).length).toBeGreaterThan(0);
    /* …and silent about the report it also hangs off. */
    expect(service.filedAgainst(bishop, "leadership-report", report.id)).toEqual([]);
  });
});
