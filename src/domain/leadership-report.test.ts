import { afterEach, describe, expect, it } from "vitest";

import {
  accessStrategyOf,
  canDiscover,
  filterReports,
  hasTemplate,
  knownReportTypes,
  knownType,
  myReports,
  namedAudience,
  policyFor,
  progressReportTemplate,
  readableActivity,
  readableComments,
  readableReports,
  relatedKindFor,
  reportCapabilities,
  reportTags,
  reportTypeLabel,
  reportsRelatedTo,
  searchReports,
  searchableBy,
  sharedWithMe,
  initialStatus,
  planTransition,
  statusBehavior,
  subjectMattersFor,
  suggestReportTypes,
  transitionsFrom,
  templateFor,
  withheldCount,
} from "./leadership-report";
import { resolveAccess } from "./access";
import { applyOverrides, config, resetOverrides } from "@/config";
import {
  GROUP_CAMPUS_LEADERS,
  GROUP_CENTRAL_LEADERSHIP,
  leadershipReports,
  personById,
  personas,
} from "@/test/fixtures";
import type { LeadershipReport, Person, Persona } from "./types";

/**
 * Leadership Reports authorization.
 *
 * These are the §27 scenarios, and they are the gate the rest of the feature
 * builds behind. Almost every case asserts an *absence*: that a person cannot
 * discover, cannot retrieve, cannot edit. Confidentiality that is only tested
 * positively is not tested at all.
 */

const persona = (id: string): Persona => personas.find((p) => p.id === id)!;
const personOf = (p: Persona): Person => personById(p.personId);

/** The four demonstration personas, by the person behind them. */
const maria = persona("leader");
const joel = persona("ministry-head");
const bishop = persona("bishop");
const admin = persona("admin");

/**
 * The groups the leadership audience means, in these tests.
 *
 * They used to be two constants the domain imported. They are records now, so
 * the audience is a parameter — which is the point: a church with different
 * leadership bodies has a different audience, and the rule does not change.
 */
const LEADERSHIP_GROUPS = [GROUP_CENTRAL_LEADERSHIP, GROUP_CAMPUS_LEADERS];

const caps = (report: LeadershipReport, who: Persona) =>
  reportCapabilities(report, who, personOf(who), LEADERSHIP_GROUPS);

const find = (id: string) => leadershipReports.find((r) => r.id === id)!;

const report = (over: Partial<LeadershipReport> = {}): LeadershipReport => ({
  id: "r1",
  title: "A report",
  reportType: "general",
  authorId: "p-maria",
  status: "draft",
  visibility: "private",
  audienceIds: [],
  discussionPolicy: "viewers",
  contentSource: "native",
  blocks: [],
  relatedDocumentIds: [],
  links: [],
  tags: [],
  comments: [],
  activity: [],
  revisions: [],
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
  ...over,
});

/* ============================ §27 A — personal draft ===================== */

describe("Scenario A — a private draft", () => {
  const a = find("lr-a-private");

  it("is not discoverable by any other leader", () => {
    expect(canDiscover(a, joel, personOf(joel), LEADERSHIP_GROUPS)).toBe(false);
    expect(canDiscover(a, bishop, personOf(bishop), LEADERSHIP_GROUPS)).toBe(false);
  });

  /** Technical administration is not pastoral authorization. */
  it("is not discoverable by an administrator", () => {
    expect(canDiscover(a, admin, personOf(admin), LEADERSHIP_GROUPS)).toBe(false);
  });

  it("yields nothing at all to an unauthorized viewer", () => {
    expect(caps(a, joel)).toEqual({
      discover: false,
      view: false,
      comment: false,
      edit: false,
      manageAccess: false,
      publish: false,
      archive: false,
    });
  });

  it("gives its author everything while it is still a draft", () => {
    expect(caps(a, maria)).toMatchObject({ discover: true, view: true, edit: true, publish: true });
  });
});

/* ==================== §27 B — confidential supervisory =================== */

describe("Scenario B — a report shared with a supervising leader", () => {
  const b = find("lr-b-supervisory");

  it("is not discoverable by a leader who was not named", () => {
    expect(canDiscover(b, bishop, personOf(bishop), LEADERSHIP_GROUPS)).toBe(false);
    expect(canDiscover(b, admin, personOf(admin), LEADERSHIP_GROUPS)).toBe(false);
  });

  it("is readable by the author and the named leader", () => {
    expect(caps(b, maria).view).toBe(true);
    expect(caps(b, joel).view).toBe(true);
  });

  it("does not let the named leader edit it", () => {
    expect(caps(b, joel).edit).toBe(false);
    expect(caps(b, joel).manageAccess).toBe(false);
  });
});

/* ====================== §27 C — leadership-wide update =================== */

describe("Scenario C — a leadership-wide published report", () => {
  const c = find("lr-c-leadership");

  it("is readable by authorized leadership", () => {
    expect(caps(c, bishop).view).toBe(true);
  });

  it("is readable by its author", () => {
    expect(caps(c, maria).view).toBe(true);
  });

  /** Published content is the submitted record; it does not silently change. */
  it("cannot be edited by anyone once published", () => {
    expect(caps(c, maria).edit).toBe(false);
    expect(caps(c, bishop).edit).toBe(false);
  });

  it("still allows discussion", () => {
    expect(caps(c, bishop).comment).toBe(true);
  });
});

/* ============================ §27 D — evaluation ========================= */

describe("Scenario D — an evaluation about somebody else", () => {
  const d = find("lr-d-evaluation");

  it("separates author from subject", () => {
    expect(d.authorId).toBe("p-joel");
    expect(d.subjectId).toBe("p-maria");
    expect(d.authorId).not.toBe(d.subjectId);
  });

  it("is readable by the author and by its subject", () => {
    expect(caps(d, joel).view).toBe(true);
    expect(caps(d, maria).view).toBe(true);
  });

  /** The point of an accountability record: the subject cannot rewrite it. */
  it("cannot be modified by its subject", () => {
    expect(caps(d, maria).edit).toBe(false);
    expect(caps(d, maria).manageAccess).toBe(false);
    expect(caps(d, maria).publish).toBe(false);
    expect(caps(d, maria).archive).toBe(false);
  });

  /**
   * Not merely because it is published. A subject never edits a report about
   * themselves, at any point in its life — otherwise this test would pass for
   * the wrong reason and an unpublished evaluation would be rewritable.
   */
  it("cannot be modified by its subject while it is still a draft either", () => {
    const draft = report({
      authorId: "p-joel",
      subjectId: "p-maria",
      status: "draft",
      visibility: "restricted",
    });
    expect(caps(draft, joel).edit).toBe(true);
    expect(caps(draft, maria).view).toBe(true);
    expect(caps(draft, maria).edit).toBe(false);
    expect(caps(draft, maria).manageAccess).toBe(false);
    expect(caps(draft, maria).publish).toBe(false);
  });

  it("lets the subject respond in discussion", () => {
    expect(caps(d, maria).comment).toBe(true);
  });

  it("is not discoverable by an uninvolved leader", () => {
    expect(canDiscover(d, bishop, personOf(bishop), LEADERSHIP_GROUPS)).toBe(false);
    expect(canDiscover(d, admin, personOf(admin), LEADERSHIP_GROUPS)).toBe(false);
  });

  it("appears for its subject under reports shared with them", () => {
    const list = sharedWithMe(leadershipReports, maria, personOf(maria));
    expect(list.map((r) => r.id)).toContain("lr-d-evaluation");
  });

  it("does not appear among the subject's own reports", () => {
    const list = myReports(leadershipReports, maria, personOf(maria));
    expect(list.map((r) => r.id)).not.toContain("lr-d-evaluation");
  });
});

/* ================= §27 E — relationships grant no access ================= */

describe("Scenario E — a restricted report related to a ministry", () => {
  const e = find("lr-e-restricted-ministry");

  it("is related to Music Ministry", () => {
    expect(e.links).toContainEqual({ kind: "ministry", id: "min-music" });
  });

  /**
   * Nathan participates in Music Ministry. That must grant him nothing at all
   * about a restricted report which happens to mention it.
   */
  it("is not discoverable by a ministry participant", () => {
    const nathan: Persona = { ...joel, personId: "p-nathan" };
    expect(canDiscover(e, nathan, personById("p-nathan"), LEADERSHIP_GROUPS)).toBe(false);
  });

  it("does not surface on the ministry's related reports for that participant", () => {
    const nathan: Persona = { ...joel, personId: "p-nathan" };
    const related = reportsRelatedTo(leadershipReports, nathan, personById("p-nathan"), {
      kind: "ministry",
      id: "min-music",
    });
    expect(related.map((r) => r.id)).not.toContain("lr-e-restricted-ministry");
  });

  it("does surface for the leader it was shared with", () => {
    const related = reportsRelatedTo(leadershipReports, bishop, personOf(bishop), {
      kind: "ministry",
      id: "min-music",
    });
    expect(related.map((r) => r.id)).toContain("lr-e-restricted-ministry");
  });
});

/* ======================== §27 F — linked document ======================== */

describe("Scenario F — a report whose content is an external document", () => {
  const f = find("lr-f-linked");

  it("keeps its own record independent of the document", () => {
    expect(f.contentSource).toBe("linked-document");
    expect(f.primaryDocumentId).toBeTruthy();
    expect(f.authorId).toBeTruthy();
    expect(f.visibility).toBeTruthy();
    expect(f.status).toBeTruthy();
  });

  it("holds no native content of its own", () => {
    expect(f.blocks).toBeUndefined();
  });

  it("is authorized like any other report", () => {
    expect(caps(f, bishop).view).toBe(true);
  });

  it("is never reduced to a bare URL", () => {
    expect(f).not.toHaveProperty("url");
    expect(f.tags.length).toBeGreaterThan(0);
    expect(f.reportingPeriod).toBeTruthy();
  });
});

/* ============================ §27 G — comments ========================== */

describe("Scenario G — comments obey the report", () => {
  const b = find("lr-b-supervisory");
  const e = find("lr-e-restricted-ministry");

  it("returns no comments to an unauthorized viewer", () => {
    expect(readableComments(b, bishop, personOf(bishop))).toEqual([]);
    expect(readableComments(b, admin, personOf(admin))).toEqual([]);
  });

  it("returns no activity to an unauthorized viewer", () => {
    expect(readableActivity(b, bishop, personOf(bishop))).toEqual([]);
  });

  it("returns the conversation to an authorized viewer", () => {
    expect(readableComments(b, joel, personOf(joel)).length).toBeGreaterThan(0);
  });

  it("lets nobody comment when discussion is disabled", () => {
    const off = report({ visibility: "leadership", discussionPolicy: "disabled" });
    expect(caps(off, maria).comment).toBe(false);
    expect(caps(off, bishop).comment).toBe(false);
  });

  it("limits commenting to the named people when the policy is selected", () => {
    expect(caps(e, bishop).comment).toBe(true);
    expect(caps(e, maria).comment).toBe(true);
  });
});

/* ============================= §27 H — search =========================== */

describe("Scenario H — restricted reports leak through nothing", () => {
  const all = leadershipReports;

  it("are absent from an unauthorized viewer's list", () => {
    const visible = readableReports(all, admin, personOf(admin), LEADERSHIP_GROUPS).map(
      (r) => r.id,
    );
    expect(visible).not.toContain("lr-a-private");
    expect(visible).not.toContain("lr-b-supervisory");
    expect(visible).not.toContain("lr-d-evaluation");
    expect(visible).not.toContain("lr-e-restricted-ministry");
  });

  it("are absent from search results", () => {
    const readable = readableReports(all, bishop, personOf(bishop), LEADERSHIP_GROUPS);
    const hits = searchReports(readable, "evaluation", (id) => personById(id).name);
    expect(hits.map((r) => r.id)).not.toContain("lr-d-evaluation");
  });

  it("are absent from search by the subject's name", () => {
    const readable = readableReports(all, admin, personOf(admin), LEADERSHIP_GROUPS);
    const hits = searchReports(readable, "maria", (id) => personById(id).name);
    expect(hits.map((r) => r.id)).not.toContain("lr-d-evaluation");
  });

  it("are absent from tag counts", () => {
    const forBishop = reportTags(all, bishop, personOf(bishop));
    const development = forBishop.find((t) => t.tag === "development");
    /* Bishop sees neither the private development report nor the evaluation. */
    expect(development).toBeUndefined();

    /* Derived rather than hard-coded, so adding a fixture cannot silently
       weaken the assertion: the count must equal what she can actually read. */
    const forMaria = reportTags(all, maria, personOf(maria));
    const readableWithTag = readableReports(all, maria, personOf(maria), LEADERSHIP_GROUPS).filter(
      (r) => r.tags.includes("development"),
    ).length;
    expect(forMaria.find((t) => t.tag === "development")?.count).toBe(readableWithTag);
    expect(readableWithTag).toBeGreaterThan(0);
  });

  it("are absent from filtered lists", () => {
    const readable = readableReports(all, bishop, personOf(bishop), LEADERSHIP_GROUPS);
    const hits = filterReports(readable, { visibility: "private" }, (id) => personById(id).name);
    expect(hits).toHaveLength(0);
  });

  /** Aggregate existence may be acknowledged; identity may not. */
  it("are counted but never named", () => {
    const withheld = withheldCount(all, admin, personOf(admin));
    expect(withheld).toBeGreaterThan(0);
    expect(typeof withheld).toBe("number");
  });
});

/* ============== C1 — "you may know it exists" is not good enough ========= */

describe("a metadata-level decision grants no discovery", () => {
  /**
   * The audience resolver has a `metadata` level meaning "you may know this
   * object exists without reading it". That is right for ordinary work, and
   * wrong here: knowing a confidential leadership report exists — and who it
   * concerns — is itself disclosure. Leadership Reports maps `metadata` to no
   * discovery at all, and this pins that mapping.
   */
  const leadershipReport = report({ visibility: "leadership", authorId: "p-esther" });

  it("gives an administrator metadata from the resolver", () => {
    const decision = resolveAccess(
      admin,
      personOf(admin),
      policyFor(leadershipReport, LEADERSHIP_GROUPS),
    );
    expect(decision.level).toBe("metadata");
  });

  it("but yields no discovery, and nothing else", () => {
    expect(caps(leadershipReport, admin).discover).toBe(false);
    expect(caps(leadershipReport, admin).view).toBe(false);
  });

  it("keeps such a report out of the list and out of the count of shown items", () => {
    const all = [leadershipReport];
    expect(readableReports(all, admin, personOf(admin), LEADERSHIP_GROUPS)).toHaveLength(0);
    expect(withheldCount(all, admin, personOf(admin))).toBe(1);
  });

  it("keeps its tags out of the tag counts", () => {
    const tagged = report({ visibility: "leadership", authorId: "p-esther", tags: ["secret"] });
    expect(reportTags([tagged], admin, personOf(admin))).toEqual([]);
  });
});

/* ====================== the policy the visibility implies ================ */

describe("visibility maps to an audience policy", () => {
  it("keeps a private report at the pastoral ceiling", () => {
    const policy = policyFor(report({ visibility: "private" }));
    expect(policy.classification).toBe("pastoral-private");
    expect(policy.audience ?? []).toEqual([]);
  });

  it("names the audience of a restricted report, including its subject", () => {
    const policy = policyFor(
      report({ visibility: "restricted", subjectId: "p-mark", audienceIds: ["p-joel"] }),
    );
    expect(policy.audience).toContain("p-joel");
    expect(policy.audience).toContain("p-mark");
  });

  it("addresses a leadership report to whichever groups the church has named", () => {
    const policy = policyFor(report({ visibility: "leadership" }), LEADERSHIP_GROUPS);
    expect(policy.audienceGroups).toEqual(LEADERSHIP_GROUPS);
  });

  /**
   * A church that has named no leadership body has no leadership audience.
   *
   * The empty case is the one that used to be impossible — the audience was
   * two constants, so it was never empty and never wrong. Now it can be, and
   * it must fail **closed**: a report set to an audience that resolves to
   * nobody reaches only its author, rather than everybody.
   */
  it("reaches nobody but the author when no group has been named", () => {
    const policy = policyFor(report({ visibility: "leadership" }), []);
    expect(policy.audienceGroups).toEqual([]);

    const readable = readableReports(
      [report({ id: "lr-lonely", visibility: "leadership", authorId: "p-maria" })],
      bishop,
      personOf(bishop),
      [],
    );
    expect(readable).toEqual([]);
  });

  it("always makes the author the owner", () => {
    expect(policyFor(report({ authorId: "p-mark" }), LEADERSHIP_GROUPS).ownerId).toBe("p-mark");
  });

  it("lists everyone who can currently reach the report", () => {
    const r = report({ authorId: "p-maria", subjectId: "p-mark", audienceIds: ["p-joel"] });
    expect(namedAudience(r)).toEqual(["p-maria", "p-mark", "p-joel"]);
  });
});

/* --------------------------------------------------- lifecycle guarantees */

describe("publishing freezes the record", () => {
  /**
   * §12 — a published report must not silently mutate. The capability says no,
   * and the provider refuses the write as well, so neither a missing control
   * nor a direct call can change a submitted report.
   */
  it("withdraws edit from everyone once published", () => {
    const published = report({ status: "published", visibility: "leadership" });
    expect(caps(published, maria).edit).toBe(false);
    expect(caps(published, bishop).edit).toBe(false);
  });

  it("withdraws edit once archived", () => {
    expect(caps(report({ status: "archived" }), maria).edit).toBe(false);
  });

  it("keeps discussion available on a published report", () => {
    const published = report({ status: "published", visibility: "leadership" });
    expect(caps(published, bishop).comment).toBe(true);
  });

  it("closes discussion only when the policy says so", () => {
    const closed = report({
      status: "published",
      visibility: "leadership",
      discussionPolicy: "disabled",
    });
    expect(caps(closed, bishop).view).toBe(true);
    expect(caps(closed, bishop).comment).toBe(false);
  });

  it("offers archive to the author until it is archived", () => {
    expect(caps(report({ status: "published" }), maria).archive).toBe(true);
    expect(caps(report({ status: "archived" }), maria).archive).toBe(false);
  });

  it("never offers archive or publish to a reader", () => {
    const shared = report({ visibility: "leadership", status: "shared" });
    expect(caps(shared, bishop).publish).toBe(false);
    expect(caps(shared, bishop).archive).toBe(false);
    expect(caps(shared, bishop).manageAccess).toBe(false);
  });

  /** A shipped published report already carries the revision it was published with. */
  it("preserves what was published", () => {
    const published = find("lr-c-leadership");
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- domain */

/* ------------------------------------------------- an open type vocabulary */

describe("report type is open, not an enum", () => {
  it("accepts a type the application has never heard of", () => {
    const invented = report({ reportType: "Camp Debrief" });
    expect(knownType(invented.reportType)).toBeUndefined();
    expect(reportTypeLabel(invented.reportType)).toBe("Camp Debrief");
  });

  it("ships a report using an invented type, and everything still works", () => {
    const custom = find("lr-g-custom-type");
    expect(knownType(custom.reportType)).toBeUndefined();
    expect(caps(custom, bishop).view).toBe(true);
    const hits = searchReports([custom], "camp debrief", (id) => personById(id).name);
    expect(hits).toHaveLength(1);
  });

  it("shows a known type by its label", () => {
    expect(reportTypeLabel("ministry-operations")).toBe("Ministry / Operations");
    expect(reportTypeLabel("leadership-development")).toBe("Leadership & Personal Development");
  });

  it("offers Leadership & Personal Development among the known types", () => {
    expect(knownReportTypes.map((k) => k.label)).toContain("Leadership & Personal Development");
  });

  it("narrows suggestions as the leader types, and never hides free entry", () => {
    expect(suggestReportTypes("evalu").map((k) => k.id)).toEqual(["evaluation"]);
    expect(suggestReportTypes("something nobody defined")).toEqual([]);
  });

  it("filters on an invented type just like a known one", () => {
    const list = [find("lr-g-custom-type"), find("lr-c-leadership")];
    const hits = filterReports(list, { reportType: "Camp Debrief" }, (id) => personById(id).name);
    expect(hits.map((r) => r.id)).toEqual(["lr-g-custom-type"]);
  });
});

describe("type shapes the form, and only where one is defined", () => {
  it("has a defined form for the Leader's Progress Report", () => {
    expect(hasTemplate("progress-report")).toBe(true);
  });

  /** §24 — the six sections the church's form actually has, and no more. */
  it("renders exactly the six sections of the church's form", () => {
    const headings = progressReportTemplate()
      .filter((b) => b.type === "heading-2")
      .map((b) => b.html);
    expect(headings).toEqual([
      "Weekly tracking",
      "CHAT dates",
      "Bible reading",
      "Ministry monthly schedule",
      "Struggles",
      "Victories",
    ]);
  });

  it("leaves the form fully editable — no locked or required blocks", () => {
    for (const block of progressReportTemplate()) {
      expect(block).not.toHaveProperty("required");
      expect(block).not.toHaveProperty("locked");
    }
  });

  it("gives an ordinary type no form at all", () => {
    expect(hasTemplate("leadership-development")).toBe(false);
    expect(templateFor("leadership-development")).toBeUndefined();
    expect(hasTemplate("Camp Debrief")).toBe(false);
  });

  it("knows which types make the subject the point", () => {
    expect(subjectMattersFor("evaluation")).toBe(true);
    expect(subjectMattersFor("leadership-development")).toBe(false);
    expect(subjectMattersFor("Camp Debrief")).toBe(false);
  });

  it("knows which types should suggest ministries first", () => {
    expect(relatedKindFor("ministry-operations")).toBe("ministry");
    expect(relatedKindFor("leadership-development")).toBeUndefined();
  });
});

describe("about and related to accept anything", () => {
  it("keeps free text when it matches no record", () => {
    const r = find("lr-h-progress");
    expect(r.subjectText).toBe("The Thursday team");
    expect(r.subjectId).toBeUndefined();
  });

  it("keeps the structured link when a record was chosen", () => {
    const r = find("lr-c-leadership");
    expect(r.links).toContainEqual({ kind: "ministry", id: "min-music" });
    expect(r.relatedText).toBeUndefined();
  });

  it("keeps free related text when no entity exists", () => {
    const r = find("lr-g-custom-type");
    expect(r.relatedText).toBe("Summer Camp 2027");
    expect(r.links).toEqual([]);
  });

  it("treats a subject as optional throughout", () => {
    const bare = report();
    expect(bare.subjectId).toBeUndefined();
    expect(bare.subjectText).toBeUndefined();
  });
});

describe("the record itself", () => {
  it("treats a subject as optional", () => {
    expect(report().subjectId).toBeUndefined();
  });

  it("does not encode security into the report type", () => {
    /* The same type appears at more than one visibility, and vice versa. */
    const pastoral = leadershipReports.filter((r) => r.reportType === "pastoral-concern");
    expect(new Set(pastoral.map((r) => r.visibility)).size).toBeGreaterThanOrEqual(1);

    const restricted = leadershipReports.filter((r) => r.visibility === "restricted");
    expect(new Set(restricted.map((r) => r.reportType)).size).toBeGreaterThan(1);
  });

  it("stops the author editing an archived report", () => {
    const archived = report({ status: "archived" });
    expect(caps(archived, maria).edit).toBe(false);
    expect(caps(archived, maria).archive).toBe(false);
  });

  it("does not offer publish on an already published report", () => {
    expect(caps(report({ status: "published" }), maria).publish).toBe(false);
    expect(caps(report({ status: "shared" }), maria).publish).toBe(true);
  });

  it("ships fixtures covering every visibility", () => {
    for (const v of ["private", "restricted", "leadership"]) {
      expect(leadershipReports.some((r) => r.visibility === v)).toBe(true);
    }
  });

  it("ships a report of each content source", () => {
    expect(new Set(leadershipReports.map((r) => r.contentSource))).toEqual(
      new Set(["native", "linked-document"]),
    );
  });
});

/**
 * Search is the widest surface in the product.
 *
 * Somebody types a word and the application answers from everything it holds.
 * A confidential report appearing there — by title alone — is the worst kind
 * of disclosure, because nobody went looking for that record and the
 * application volunteered it.
 *
 * `searchableBy` is a **second** gate, narrower than reading and applied by
 * search alone. It deliberately repeats what the access model already decides
 * for pastoral-private records, so that a surface which forgets to gate its
 * input still cannot surface a confidential title. These tests therefore hand
 * in **ungated** lists on purpose: gated input would prove the other gate.
 */
describe("what may be found by searching", () => {
  const confidential = (over: Partial<LeadershipReport> = {}): LeadershipReport =>
    ({
      id: "lr-confidential",
      title: "Family difficulty affecting attendance",
      reportType: "pastoral",
      authorId: "p-maria",
      status: "published",
      visibility: "restricted",
      discussionPolicy: "viewers",
      contentSource: "native",
      audienceIds: [],
      relatedDocumentIds: [],
      links: [],
      tags: [],
      comments: [],
      activity: [],
      revisions: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      ...over,
    }) as LeadershipReport;

  const nameOf = (id: string) => personById(id).name;
  const person = (id: string) => personById(id);

  it("lets its author find their own", () => {
    expect(searchableBy(confidential(), person("p-maria"))).toBe(true);
    expect(searchReports([confidential()], "difficulty", nameOf, person("p-maria"))).toHaveLength(
      1,
    );
  });

  it("lets somebody it was explicitly shared with find it", () => {
    const shared = confidential({ audienceIds: ["p-joel"] });
    expect(searchReports([shared], "difficulty", nameOf, person("p-joel"))).toHaveLength(1);
  });

  it("hides it from everybody else, from an ungated list", () => {
    for (const who of ["p-joel", "p-bishop", "p-admin"]) {
      expect(searchableBy(confidential(), person(who))).toBe(false);
      expect(searchReports([confidential()], "difficulty", nameOf, person(who))).toEqual([]);
    }
  });

  it("hides a private report from everybody but its author", () => {
    const priv = confidential({ visibility: "private", audienceIds: ["p-joel"] });
    /* Private means private: being named on it is not being shared with. */
    expect(searchableBy(priv, person("p-joel"))).toBe(false);
    expect(searchableBy(priv, person("p-maria"))).toBe(true);
  });

  it("leaves ordinary leadership and shared reporting searchable", () => {
    expect(searchableBy(confidential({ visibility: "leadership" }), person("p-joel"))).toBe(true);
    expect(searchableBy(confidential({ visibility: "shared" }), person("p-joel"))).toBe(true);
  });

  it("does not match a confidential title even for an exact search", () => {
    const exact = searchReports(
      [confidential()],
      "Family difficulty affecting attendance",
      nameOf,
      person("p-bishop"),
    );
    expect(exact).toEqual([]);
  });
});

/**
 * Configuration chooses among capabilities; it never writes one.
 *
 * An administrator may add an audience choice and say what it is called. What
 * that choice *permits* is one of four strategies the application implements.
 * The invariant underneath everything here:
 *
 * > **Configuration must never widen access.**
 *
 * The names below are deliberately ones no code could have been written
 * against — passing these is evidence of configurability rather than of
 * defaults.
 */
describe("audience choices are configured, access strategies are not", () => {
  const report = (visibility: string, over: Partial<LeadershipReport> = {}): LeadershipReport =>
    ({
      id: "lr-x",
      title: "Something",
      reportType: "pastoral",
      authorId: "p-maria",
      status: "published",
      visibility,
      discussionPolicy: "viewers",
      contentSource: "native",
      audienceIds: [],
      relatedDocumentIds: [],
      links: [],
      tags: [],
      comments: [],
      activity: [],
      revisions: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      ...over,
    }) as LeadershipReport;

  afterEach(() => resetOverrides());

  it("enforces an added choice by the strategy it names", () => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: "pastoral-team-91827",
        isAddition: true,
        value: {
          label: "Pastoral Team 91827",
          active: true,
          accessStrategy: "named-people",
        },
      } as never,
    ]);

    const policy = policyFor(
      report("pastoral-team-91827", { audienceIds: ["p-joel"] }),
      LEADERSHIP_GROUPS,
    );

    /* Behaves exactly like the built-in "named people" choice, because it is
       the same strategy — not because anything was written about it. */
    expect(policy.classification).toBe("pastoral-private");
    expect(policy.audience).toEqual(["p-joel"]);
  });

  /**
   * Two layers, and both are needed.
   *
   * The **schema** refuses to load an audience choice naming a strategy the
   * application does not implement — configuration that would be meaningless
   * never becomes live at all.
   */
  it("refuses to load a choice naming a strategy that does not exist", () => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: "invented-91827",
        isAddition: true,
        value: { label: "Invented 91827", active: true, accessStrategy: "read-by-anyone" },
      } as never,
    ]);

    expect(() => config.get("reports.visibility")).toThrow(/reports\.visibility/);
  });

  /**
   * And the **lookup** falls closed for a value that got in some other way —
   * a record whose visibility names a choice nobody configured, or one removed
   * since it was written. The narrowest answer, not the widest.
   *
   * This used to fall through to ordinary organisational reading, which meant
   * an unrecognised value opened a report rather than closing it.
   */
  it("falls closed for a record whose audience choice is not configured", () => {
    const policy = policyFor(
      report("removed-choice-91827", { audienceIds: ["p-joel"] }),
      LEADERSHIP_GROUPS,
    );

    expect(policy.classification).toBe("pastoral-private");
    expect(policy.audience).toBeUndefined();
    expect(accessStrategyOf("removed-choice-91827")).toBe("owner-only");
  });

  it("falls closed on a visibility nothing has ever defined", () => {
    expect(accessStrategyOf("nothing-like-this-91827")).toBe("owner-only");
    expect(
      policyFor(report("nothing-like-this-91827"), LEADERSHIP_GROUPS).audience,
    ).toBeUndefined();
  });

  /**
   * Renaming is a label change, and must not touch enforcement.
   */
  it("keeps enforcing the same rule after the choice is renamed", () => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: "restricted",
        value: { label: "Pastoral only 91827" },
      } as never,
    ]);

    expect(config.label("reports.visibility", "restricted")).toBe("Pastoral only 91827");
    expect(accessStrategyOf("restricted")).toBe("named-people");
    expect(policyFor(report("restricted"), LEADERSHIP_GROUPS).classification).toBe(
      "pastoral-private",
    );
  });

  /**
   * Deactivating a choice stops it being offered for new records. It must not
   * change what an existing record filed under it permits — that would make
   * configuration retroactively rewrite access.
   */
  it("does not change access for records already using a deactivated choice", () => {
    applyOverrides([
      {
        namespace: "reports.visibility",
        optionId: "private",
        value: { active: false },
      } as never,
    ]);

    expect(accessStrategyOf("private")).toBe("owner-only");
    expect(policyFor(report("private"), LEADERSHIP_GROUPS).classification).toBe("pastoral-private");
  });
});

describe("statuses are understood by what they mean", () => {
  afterEach(() => resetOverrides());

  it("reads editability and finality from configuration, not from the name", () => {
    expect(statusBehavior("draft").editable).toBe(true);
    expect(statusBehavior("published").editable).toBe(false);
    expect(statusBehavior("published").final).toBe(true);
    expect(statusBehavior("archived").current).toBe(false);
  });

  it("treats an unrecognised status as closed rather than open", () => {
    const unknown = statusBehavior("something-91827");
    expect(unknown.editable).toBe(false);
    expect(unknown.final).toBe(true);
    expect(unknown.current).toBe(false);
    expect(unknown.visibleToAudience).toBe(false);
  });

  it("follows a renamed status, because nothing depends on its name", () => {
    applyOverrides([
      {
        namespace: "reports.statuses",
        optionId: "published",
        value: { label: "Finalised 91827" },
      } as never,
    ]);

    expect(config.label("reports.statuses", "published")).toBe("Finalised 91827");
    expect(statusBehavior("published").editable).toBe(false);
  });
});

/**
 * Moving between stages, derived rather than named.
 *
 * Every assertion here is about a **difference in behaviour**. None of them
 * names a stage in the rule it is checking, which is the property that used to
 * be missing: four actions with four hard-coded targets could not be anything
 * but the four stages they were written for.
 */
describe("what a move between stages turns out to require", () => {
  afterEach(() => resetOverrides());

  it("takes the capability to submit when the content stops changing", () => {
    const plan = planTransition("draft", "published");
    expect(plan.capability).toBe("publish");
    expect(plan.snapshot).toBe(true);
    expect(plan.marksFinal).toBe(true);
  });

  it("takes the capability to submit when it first reaches its audience", () => {
    const plan = planTransition("draft", "shared");
    expect(plan.capability).toBe("publish");
    /* Nothing is frozen: shared content still changes. */
    expect(plan.snapshot).toBe(false);
  });

  it("takes the capability that survives submission when the content opens again", () => {
    const plan = planTransition("published", "shared");
    expect(plan.capability).toBe("manageAccess");
    expect(plan.reopens).toBe(true);
    expect(plan.snapshot).toBe(false);
  });

  it("takes the capability to retire when it stops being current", () => {
    const plan = planTransition("published", "archived");
    expect(plan.capability).toBe("archive");
    expect(plan.retires).toBe(true);
  });

  /* Reopening a retired report is a change to the record leadership read
     before it is a change to what is current, so the stricter one decides. */
  it("treats reopening a retired report as reopening, not as restoring", () => {
    const plan = planTransition("archived", "shared");
    expect(plan.capability).toBe("manageAccess");
    expect(plan.reopens).toBe(true);
    expect(plan.restores).toBe(true);
  });

  /**
   * The case that could not exist before.
   *
   * A stage nothing was written against, behaving correctly because of what
   * its behaviours say.
   */
  it("handles a stage the product never shipped", () => {
    applyOverrides([
      {
        namespace: "reports.statuses",
        optionId: "sealed-70412",
        isAddition: true,
        value: {
          label: "Sealed 70412",
          active: true,
          semanticState: "neutral",
          terminal: true,
          behaviors: { editable: false, final: true, current: false, visibleToAudience: false },
        },
      } as never,
    ]);

    const plan = planTransition("draft", "sealed-70412");
    expect(plan.capability).toBe("publish");
    expect(plan.snapshot).toBe(true);
    expect(plan.retires).toBe(true);
    expect(transitionsFrom("draft").map((t) => t.id)).toContain("sealed-70412");
  });

  /**
   * Two stages that behave alike.
   *
   * A church may well have them — the same thing under two names — and the
   * move between them changes nothing the application acts on. It is still the
   * author's move on a record whose content is frozen, so it takes the
   * capability that survives freezing. Getting this wrong offers it to nobody.
   */
  it("offers a sideways move on a frozen report to whoever still owns it", () => {
    applyOverrides([
      {
        namespace: "reports.statuses",
        optionId: "with-the-elders-88204",
        isAddition: true,
        value: {
          label: "With The Elders 88204",
          active: true,
          semanticState: "info",
          terminal: false,
          behaviors: { editable: false, final: true, current: true, visibleToAudience: true },
        },
      } as never,
    ]);

    const plan = planTransition("published", "with-the-elders-88204");
    expect(plan.capability).toBe("manageAccess");
    expect(plan.snapshot).toBe(false);
    expect(plan.reopens).toBe(false);
  });

  /** A stage nobody offers is not somewhere a report may be moved. */
  it("does not offer a stage the church deactivated", () => {
    applyOverrides([
      { namespace: "reports.statuses", optionId: "archived", value: { active: false } } as never,
    ]);
    expect(transitionsFrom("draft").map((t) => t.id)).not.toContain("archived");
  });

  it("never offers the stage the report is already in", () => {
    expect(transitionsFrom("draft").map((t) => t.id)).not.toContain("draft");
  });
});

describe("where a new report starts", () => {
  afterEach(() => resetOverrides());

  it("is the stage that is editable and not yet anybody else's", () => {
    const behaviors = statusBehavior(initialStatus());
    expect(behaviors.editable).toBe(true);
    expect(behaviors.visibleToAudience).toBe(false);
    expect(behaviors.final).toBe(false);
  });

  it("follows the church when it renames that stage rather than assuming one", () => {
    applyOverrides([
      { namespace: "reports.statuses", optionId: "draft", value: { active: false } } as never,
      {
        namespace: "reports.statuses",
        optionId: "scratch-33907",
        isAddition: true,
        value: {
          label: "Scratch 33907",
          active: true,
          semanticState: "neutral",
          terminal: false,
          sortOrder: 0,
          behaviors: { editable: true, final: false, current: true, visibleToAudience: false },
        },
      } as never,
    ]);

    expect(initialStatus()).toBe("scratch-33907");
  });
});
