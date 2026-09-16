import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createEscalationRepository } from "../repositories/escalation-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createEscalationService } from "./escalation-service";
import { viewerOf } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Asking something of leadership.
 *
 * These tests are about one product claim: **information does not become
 * work**. Nothing here can turn a submitted report into somebody's task, and
 * an obligation exists only where a person asked for one. The rest is about
 * the difference between the three kinds of asking — consider, act, decide —
 * which is not a difference of label.
 */

let dir: string;
let db: Db;
let org: ReturnType<typeof createOrganizationRepository>;
let service: ReturnType<typeof createEscalationService>;

let maria: ReturnType<typeof viewerOf>;
let joel: ReturnType<typeof viewerOf>;
let ruth: ReturnType<typeof viewerOf>;

const report = {
  sourceType: "leadership-report" as const,
  sourceId: "rep-1",
  contextLabel: "Outreach Ministry · September",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-escalation-"));
  db = openDatabase(join(dir, "test.db"));
  org = createOrganizationRepository(db);

  const campus = org.insertCampus({ name: "Scarborough" });
  const joelRecord = org.insertPerson({
    name: "Joel Tan",
    accessRole: "ministry-head",
    campusId: campus.id,
  });
  const mariaRecord = org.insertPerson({
    name: "Maria Santos",
    accessRole: "leader",
    campusId: campus.id,
    reportsToId: joelRecord.id,
  });
  const ruthRecord = org.insertPerson({
    name: "Ruth Alvarez",
    accessRole: "bishop",
    campusId: campus.id,
  });
  org.insertMinistry({ name: "Outreach", campusId: campus.id, leadId: joelRecord.id });

  /* Leadership is a group the church named, not an access role. Ruth holds it
     because she is in this group — nothing about her record says so. */
  const elders = org.insertGroup({ name: "Elders", leadershipAudience: true });
  org.setGroupMembership(elders.id, ruthRecord.id, true);

  maria = viewerOf(org.findPerson(mariaRecord.id)!);
  joel = viewerOf(org.findPerson(joelRecord.id)!);
  ruth = viewerOf(org.findPerson(ruthRecord.id)!);

  service = createEscalationService(createEscalationRepository(db), org);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ask = (type: "attention" | "action" | "approval", extra: Record<string, unknown> = {}) =>
  service.raise(maria, {
    type,
    ...report,
    request: "Please confirm whether Room B can be used on 18 September.",
    requestedFromRole: "reporting-leader",
    ...extra,
  });

describe("information does not become work", () => {
  it("has an empty inbox until somebody asks for something", () => {
    const inbox = service.inbox(joel);
    expect(inbox.mine).toEqual([]);
    expect(inbox.attention).toEqual([]);
    expect(inbox.actions).toEqual([]);
    expect(inbox.approvals).toEqual([]);
  });

  it("puts nothing in a leader's inbox merely because they could read the source", () => {
    /* Ruth oversees everything. A request Maria addressed to her own reporting
       leader is still not Ruth's to deal with. */
    ask("action");
    expect(service.inbox(ruth).mine).toEqual([]);
  });
});

describe("asking", () => {
  it("refuses an ask with no words", () => {
    expect(() => ask("attention", { request: "   " })).toThrow(ApiError);
  });

  it("refuses an ask addressed to nobody", () => {
    expect(() =>
      service.raise(maria, { type: "attention", ...report, request: "Something is wrong." }),
    ).toThrow(ApiError);
  });

  it("refuses a named recipient who does not exist", () => {
    expect(() =>
      ask("action", { requestedFromRole: undefined, requestedFromPersonId: "per-nobody" }),
    ).toThrow(ApiError);
  });

  it("reaches the position, resolved now rather than stored as a name", () => {
    ask("action");
    expect(service.inbox(joel).actions).toHaveLength(1);

    /* Maria's reporting line changes. The request follows the position. */
    org.updatePerson(maria.person.id, { reportsToId: ruth.person.id });
    const service2 = createEscalationService(createEscalationRepository(db), org);

    expect(service2.inbox(joel).actions).toHaveLength(0);
    expect(service2.inbox(ruth).actions).toHaveLength(1);
  });

  it("records what was asked, by whom, and from which position", () => {
    const raised = ask("approval", { neededBy: "2026-09-15" });

    expect(raised.type).toBe("approval");
    expect(raised.status).toBe("requested");
    expect(raised.requestedById).toBe(maria.person.id);
    expect(raised.requestedFromRole).toBe("reporting-leader");
    expect(raised.neededBy).toBe("2026-09-15");
    expect(service.get(joel, raised.id).activity[0]?.note).toContain("Room B");
  });

  it("carries the entry it came from, so one paragraph can be the ask", () => {
    const raised = ask("attention", { entryId: "blk-4" });
    expect(raised.entryId).toBe("blk-4");
  });
});

describe("attention is not a task", () => {
  it("is finished by being noticed", () => {
    const raised = ask("attention");
    const noted = service.move(joel, { id: raised.id, status: "noted" });

    expect(noted.status).toBe("noted");
    expect(service.inbox(joel).attention).toHaveLength(0);
  });

  it("cannot be completed, assigned or approved — those are other things", () => {
    const raised = ask("attention");
    for (const status of ["completed", "assigned", "approved"] as const) {
      expect(() => service.move(joel, { id: raised.id, status })).toThrow(ApiError);
    }
  });
});

describe("an action is work, and stops being work", () => {
  it("runs requested → in progress → completed", () => {
    const raised = ask("action");

    const started = service.move(joel, { id: raised.id, status: "in-progress" });
    expect(started.status).toBe("in-progress");
    expect(started.assigneeId).toBe(joel.person.id);

    const done = service.move(joel, { id: raised.id, status: "completed" });
    expect(done.status).toBe("completed");
    expect(service.inbox(joel).actions).toHaveLength(0);
  });

  it("can end as unable or not required, which are real outcomes", () => {
    const a = ask("action");
    expect(service.move(joel, { id: a.id, status: "unable", note: "No room free." }).status).toBe(
      "unable",
    );

    const b = ask("action");
    expect(service.move(joel, { id: b.id, status: "not-required" }).status).toBe("not-required");
  });

  it("lets whoever asked withdraw it, and nobody else", () => {
    const raised = ask("action");
    expect(() => service.move(ruth, { id: raised.id, status: "not-required" })).toThrow(ApiError);
    expect(service.move(maria, { id: raised.id, status: "not-required" }).status).toBe(
      "not-required",
    );
  });
});

describe("an approval is a decision, and is recorded as one", () => {
  it("records who decided, when, and what they said", () => {
    const raised = ask("approval");
    const approved = service.move(joel, {
      id: raised.id,
      status: "approved",
      note: "Room B is free.",
    });

    expect(approved.status).toBe("approved");
    expect(approved.decidedById).toBe(joel.person.id);
    expect(approved.decidedAt).toBeTruthy();
    expect(approved.decisionNote).toBe("Room B is free.");
  });

  it("will not let a decline go unexplained", () => {
    const raised = ask("approval");
    expect(() => service.move(joel, { id: raised.id, status: "declined" })).toThrow(ApiError);
  });

  it("can ask for more information without becoming a refusal", () => {
    const raised = ask("approval");
    const asked = service.move(joel, {
      id: raised.id,
      status: "more-information",
      note: "How many people?",
    });
    expect(asked.status).toBe("more-information");

    /* And it can still be decided afterwards. */
    expect(service.move(joel, { id: raised.id, status: "approved" }).status).toBe("approved");
  });

  it("keeps a decision once made", () => {
    const raised = ask("approval");
    service.move(joel, { id: raised.id, status: "approved" });
    expect(() => service.withdraw(maria, raised.id)).toThrow(ApiError);
  });

  it("refuses approval on something that is not an approval request", () => {
    const raised = ask("action");
    expect(() => service.move(joel, { id: raised.id, status: "approved" })).toThrow(ApiError);
  });
});

describe("who may act on a request", () => {
  it("is the leader it was sent to", () => {
    const raised = ask("action");
    expect(() => service.move(ruth, { id: raised.id, status: "in-progress" })).toThrow(ApiError);
    expect(() => service.move(joel, { id: raised.id, status: "in-progress" })).not.toThrow();
  });

  it("is a named person when one was named", () => {
    const raised = ask("action", {
      requestedFromRole: undefined,
      requestedFromPersonId: ruth.person.id,
    });
    expect(service.inbox(ruth).actions).toHaveLength(1);
    expect(service.inbox(joel).actions).toHaveLength(0);
  });
});

describe("the positions a person holds", () => {
  it("are derived from the organisation, never stored on the request", () => {
    expect(service.roles(joel)).toContain("reporting-leader");
    expect(service.roles(joel)).toContain("ministry-head");
    expect(service.roles(maria)).toEqual([]);
    expect(service.roles(ruth)).toContain("church-leadership");
  });

  /**
   * The one that used to be impossible to get wrong.
   *
   * "Church leadership" was whoever the product called a bishop, so it was
   * never empty. It is a membership now, which means a church that has named
   * no leadership body addresses requests to **nobody** — they wait, visibly,
   * rather than reaching someone the church never appointed.
   */
  it("gives an unappointed bishop no leadership position at all", () => {
    const unappointed = org.insertPerson({ name: "Solomon Reyes", accessRole: "bishop" });
    const viewer = viewerOf(org.findPerson(unappointed.id)!);
    expect(service.roles(viewer)).not.toContain("church-leadership");
    expect(service.roles(viewer)).not.toContain("campus-leadership");
  });

  it("addresses church leadership to the group's members, and to nobody else", () => {
    expect(service.recipientsOf("church-leadership", maria.person.id)).toEqual([ruth.person.id]);
  });

  it("resolves a reporting leader to nobody when the church has not said", () => {
    const orphan = org.insertPerson({ name: "New Leader" });
    expect(service.recipientsOf("reporting-leader", orphan.id)).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts decisions first, then work, then things to consider", () => {
    ask("attention");
    ask("action");
    ask("approval");

    expect(service.inbox(joel).mine.map((item) => item.type)).toEqual([
      "approval",
      "action",
      "attention",
    ]);
  });
});

/**
 * Categories that ask to be looked at.
 *
 * A report can need attention without anybody having asked for it — a pastoral
 * concern is a concern whether or not its author thought to file a request.
 * Two things have to hold at once, and they pull in opposite directions:
 * the flag must reach the people who can act on it, and it must not reach
 * anybody who could not have read the report in the first place.
 */
describe("records that ask for attention by their category", () => {
  const report = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: `lr-${Math.random().toString(16).slice(2)}`,
      title: "Concern about a member",
      reportType: "Pastoral",
      authorId: maria.person.id,
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
      category: "attention-required",
      contextType: "lifegroup-gathering",
      contextId: "gat-1",
      ...over,
    }) as never;

  const withReports = (visible: unknown[]) =>
    createEscalationService(createEscalationRepository(db), org, {
      discoverable: () => visible as never[],
    });

  it("surfaces a flagged report without anybody having asked", () => {
    const service2 = withReports([report()]);
    const flagged = service2.inbox(joel).flagged;

    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.categoryLabel).toBe("Attention required");
    expect(flagged[0]?.contextLabel).toBe("LifeGroup gathering");
    /* A projection, pointing at the report — never a copy of it. */
    expect(flagged[0]?.path).toContain("/leadership-reports/");
  });

  it("leaves ordinary information alone", () => {
    const service2 = withReports([report({ category: "general" }), report({ category: "prayer" })]);
    expect(service2.inbox(joel).flagged).toEqual([]);
  });

  it("shows nothing to somebody the report was withheld from", () => {
    /* The gate runs before the projection: a viewer who cannot discover the
       report is handed a list without it, so there is nothing to leak — not
       the title, not the subject, not a count. */
    const service2 = createEscalationService(createEscalationRepository(db), org, {
      discoverable: (viewer) => (viewer.person.id === joel.person.id ? [report()] : []),
    });

    expect(service2.inbox(joel).flagged).toHaveLength(1);
    expect(service2.inbox(ruth).flagged).toEqual([]);
  });

  it("stops flagging one that was archived, and keeps the record itself", () => {
    const archived = report({ status: "archived" });
    const service2 = withReports([archived]);

    expect(service2.inbox(joel).flagged).toEqual([]);
    /* Nothing here deletes or moves a report; it is still the caller's list. */
    expect(archived).toBeTruthy();
  });

  it("keeps asked-of-me and flagged-by-category apart", () => {
    ask("attention");
    const service2 = withReports([report()]);
    const inbox = service2.inbox(joel);

    expect(inbox.attention).toHaveLength(1);
    expect(inbox.flagged).toHaveLength(1);
    /* Different lists, different meanings: one was addressed to this leader,
       the other is flagged by what it is. Neither is counted twice. */
    expect(inbox.mine.some((item) => item.id === inbox.flagged[0]?.id)).toBe(false);
  });
});

/**
 * What is said on an ask stays between the people party to it.
 *
 * A record's page lists its asks to anybody who may open the record, so the
 * ask itself is not secret — but a question, a reason for declining or why
 * something could not be done was said to one person, not to the audience.
 */
describe("notes on an ask", () => {
  it("reach the requester and the recipient", () => {
    const raised = ask("approval");
    service.move(joel, { id: raised.id, status: "more-information", note: "How many people?" });

    const asRequester = service.inbox(maria).raisedByMe[0]!;
    expect(asRequester.askedByMe).toBe(true);
    expect(asRequester.activity.map((a) => a.note)).toContain("How many people?");

    const asRecipient = service.inbox(joel).approvals[0]!;
    expect(asRecipient.activity.map((a) => a.note)).toContain("How many people?");
  });

  it("are withheld from somebody who only reads the record", () => {
    const raised = ask("approval");
    service.move(joel, { id: raised.id, status: "declined", note: "Room B is booked." });

    const onTheRecord = service.forSource(ruth, report.sourceType, report.sourceId);
    expect(onTheRecord).toHaveLength(1);
    expect(onTheRecord[0]!.activity).toEqual([]);
    expect(onTheRecord[0]!.decisionNote).toBeUndefined();

    expect(service.forSource(maria, report.sourceType, report.sourceId)[0]!.decisionNote).toBe(
      "Room B is booked.",
    );
  });

  it("do not open one ask to somebody who is not party to it", () => {
    const raised = ask("action");
    expect(() => service.get(ruth, raised.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

describe("answering a question about your own ask", () => {
  const questioned = () => {
    const raised = ask("approval");
    service.move(joel, { id: raised.id, status: "more-information", note: "How many people?" });
    return raised;
  };

  it("returns the ask to the recipient, with the answer on it", () => {
    const raised = questioned();
    const answered = service.reply(maria, { id: raised.id, note: "About forty." });

    expect(answered.status).toBe("requested");
    const back = service.inbox(joel).approvals.find((item) => item.id === raised.id)!;
    expect(back.activity.at(-1)).toMatchObject({
      actorId: maria.person.id,
      note: "About forty.",
    });
    /* The recipient's controls are unchanged: it can still be decided. */
    expect(service.move(joel, { id: raised.id, status: "approved" }).status).toBe("approved");
  });

  it("needs words", () => {
    const raised = questioned();
    expect(() => service.reply(maria, { id: raised.id, note: "  " })).toThrow(
      expect.objectContaining({ code: "validation" }),
    );
  });

  it("is only for whoever asked", () => {
    const raised = questioned();
    expect(() => service.reply(joel, { id: raised.id, note: "Forty." })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("looks like nothing to somebody who is not party to the ask", () => {
    const raised = questioned();
    expect(() => service.reply(ruth, { id: raised.id, note: "Forty." })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
    expect(() => service.reply(maria, { id: "esc-nothing", note: "Forty." })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("is refused when nobody has asked a question", () => {
    const raised = ask("approval");
    expect(() => service.reply(maria, { id: raised.id, note: "Forty." })).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });
});

describe("answered asks", () => {
  it("stay in front of whoever asked, with the reason", () => {
    const raised = ask("approval");
    service.move(joel, { id: raised.id, status: "declined", note: "Room B is booked." });

    const inbox = service.inbox(maria);
    expect(inbox.raisedByMe).toEqual([]);
    expect(inbox.answeredForMe.map((item) => item.id)).toEqual([raised.id]);
    expect(inbox.answeredForMe[0]!.decisionNote).toBe("Room B is booked.");
    expect(service.inbox(ruth).answeredForMe).toEqual([]);
  });
});

describe("withdrawing an ask", () => {
  it("takes an open ask back for whoever made it", () => {
    const raised = ask("action");
    service.withdraw(maria, raised.id);
    expect(service.inbox(joel).actions).toEqual([]);
    expect(service.inbox(maria).raisedByMe).toEqual([]);
  });

  it("is refused to the recipient, and invisible to anybody else", () => {
    const raised = ask("action");
    expect(() => service.withdraw(joel, raised.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => service.withdraw(ruth, raised.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("leaves a finished ask on the record", () => {
    const raised = ask("action");
    service.move(joel, { id: raised.id, status: "completed" });
    expect(() => service.withdraw(maria, raised.id)).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });
});
