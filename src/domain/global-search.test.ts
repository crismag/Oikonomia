import { describe, expect, it } from "vitest";

import { globalSearch, kindOrder } from "./global-search";
import { leadershipReports, ministries, people, personById, personas } from "@/test/fixtures";
import { readableReports } from "./leadership-report";
import type { LeadershipReport, Person, Persona, ResourceSearchResult } from "./types";

/**
 * Global search.
 *
 * The field in the application chrome. Two things matter: that it actually
 * finds things — it was decorative before, which is worse than absent — and
 * that it cannot become a way around any module's authorization.
 */

const persona = (id: string): Persona => personas.find((p) => p.id === id)!;
const personOf = (p: Persona): Person => personById(p.personId);

const maria = persona("leader");
const joel = persona("ministry-head");
const admin = persona("admin");

/**
 * Callers hand in what they may already read; the page does the same.
 *
 * Resources come from the document registry, which has already withheld what
 * this viewer may not discover — so the tests below hand them in explicitly,
 * which is also how they check that this file never searches on its own.
 */
const search = (q: string, who: Persona, resources: ResourceSearchResult[] = []) =>
  globalSearch(
    q,
    who,
    personOf(who),
    readableReports(leadershipReports, who, personOf(who)),
    resources,
    { people, ministries },
  );

const resource = (title: string): ResourceSearchResult => ({
  id: `doc-${title}`,
  title,
  associations: [{ section: "ministry", label: "Music Ministry" }],
  tags: [],
  external: true,
});

describe("it finds what the placeholder promises", () => {
  it("finds people", () => {
    const hits = search("maria", maria).filter((r) => r.kind === "person");
    expect(hits.map((r) => r.label)).toContain("Maria Santos");
    expect(hits[0]?.to).toBe("/people/p-maria");
  });

  it("finds people by their role", () => {
    expect(search("ministry head", maria).some((r) => r.kind === "person")).toBe(true);
  });

  it("finds ministries", () => {
    const hits = search("victuals", maria).filter((r) => r.kind === "ministry");
    expect(hits.map((r) => r.label)).toContain("Victuals Ministry");
  });

  it("finds leadership reports", () => {
    const hits = search("evaluation", joel).filter((r) => r.kind === "report");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.to).toMatch(/^\/leadership-reports\//);
  });

  it("finds resources", () => {
    const hits = search("rota", maria, [resource("Ushers rota")]);
    expect(hits.some((r) => r.kind === "resource" && r.label === "Ushers rota")).toBe(true);
  });

  it("doubles as a way to reach a page", () => {
    const hits = search("attendance", maria).filter((r) => r.kind === "page");
    expect(hits.map((r) => r.to)).toContain("/attendance");
  });

  it("stays quiet until there is something to go on", () => {
    expect(search("", maria)).toEqual([]);
    expect(search("m", maria)).toEqual([]);
  });

  it("groups results in a stable order", () => {
    const kinds = search("music", maria).map((r) => r.kind);
    const positions = kinds.map((k) => kindOrder.indexOf(k));
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i - 1]! <= positions[i]!).toBe(true);
    }
  });

  it("caps each group so one kind cannot flood the list", () => {
    const hits = search("ministry", maria);
    for (const kind of kindOrder) {
      expect(hits.filter((r) => r.kind === kind).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("it cannot widen access", () => {
  /**
   * The confidential assessment is discoverable only by its author. Global
   * search must not become the place it leaks — not as a result, and not as a
   * resource attached to it.
   */
  it("does not surface a report the viewer cannot discover", () => {
    const forMaria = search("confidential", maria);
    expect(forMaria.some((r) => r.label.includes("Confidential"))).toBe(false);

    const forAdmin = search("confidential", admin);
    expect(forAdmin.some((r) => r.label.includes("Confidential"))).toBe(false);
  });

  it("does surface it for the leader who may discover it", () => {
    expect(search("confidential", joel).some((r) => r.label.includes("Confidential"))).toBe(true);
  });

  /**
   * The strongest form of "it cannot widen access": this file has no way to
   * reach a resource at all. It shows what the registry handed it and nothing
   * else, so a withheld resource cannot appear here however the query is
   * phrased.
   */
  it("shows no resource it was not handed, whatever is typed", () => {
    for (const q of ["development guide", "confidential", "rota", "planning"]) {
      expect(search(q, maria).some((r) => r.kind === "resource")).toBe(false);
    }
  });

  /** An administrator manages structure, not confidential content. */
  it("gives an administrator no reports at all", () => {
    expect(search("leadership", admin).filter((r) => r.kind === "report")).toEqual([]);
  });
});
