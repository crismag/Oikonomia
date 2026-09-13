import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createOrganizationService } from "./organization-service";
import { canDiscover } from "@/domain/leadership-report";
import { viewerOf } from "@/domain/viewer";
import { applyOverrides, resetOverrides } from "@/config";
import type { LeadershipReport } from "@/domain/types";
import type { Database as Db } from "better-sqlite3";

/**
 * Responsibility groups: who may name them, and what naming one does.
 *
 * A group is not a label. Marking one as the leadership audience is the only
 * thing that decides who a report set to "leadership" reaches, which makes
 * every write here an authorization change — so the refusals are the tests
 * that matter, and the reach is asserted against `canDiscover`, the same gate
 * the module uses.
 */

let dir: string;
let db: Db;
let repo: ReturnType<typeof createOrganizationRepository>;
let service: ReturnType<typeof createOrganizationService>;

let admin: ReturnType<typeof viewerOf>;
let elder: ReturnType<typeof viewerOf>;
let leader: ReturnType<typeof viewerOf>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-org-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createOrganizationRepository(db);
  service = createOrganizationService(repo);

  const adminRecord = repo.insertPerson({ name: "Perpetua Okonkwo", accessRole: "admin" });
  const elderRecord = repo.insertPerson({ name: "Tobias Wren", accessRole: "leader" });
  const leaderRecord = repo.insertPerson({ name: "Delphine Arceneaux", accessRole: "leader" });

  admin = viewerOf(repo.findPerson(adminRecord.id)!);
  elder = viewerOf(repo.findPerson(elderRecord.id)!);
  leader = viewerOf(repo.findPerson(leaderRecord.id)!);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what the session call shows a browser", () => {
  beforeEach(() => {
    const campus = repo.insertCampus({ name: "Northside" });
    repo.insertPerson({
      name: "Solène Marchetti",
      email: "solene@example.org",
      accessRole: "admin",
      campusId: campus.id,
    });
    repo.insertMinistry({ name: "Hospitality", campusId: campus.id });
  });

  it("shows nobody who is not signed in any of the directory", () => {
    const anonymous = service.visibleTo(undefined);
    expect(anonymous).toEqual({ campuses: [], people: [], ministries: [], venues: [], groups: [] });
    expect(JSON.stringify(anonymous)).not.toContain("solene@example.org");
  });

  it("shows somebody signed in the whole organisation", () => {
    const seen = service.visibleTo(leader);
    expect(seen.people.map((person) => person.email)).toContain("solene@example.org");
    expect(seen.campuses).toHaveLength(1);
    expect(seen.ministries).toHaveLength(1);
  });
});

describe("only an administrator may name a body of responsibility", () => {
  it("refuses a leader who tries to create one", () => {
    expect(() => service.addGroup(leader, { name: "Elders" })).toThrow(ApiError);
    expect(repo.groups()).toEqual([]);
  });

  /* The dangerous edit: flipping an ordinary group into the leadership
     audience widens who every future confidential report reaches. */
  it("refuses a leader who tries to make an existing group the leadership audience", () => {
    const group = service.addGroup(admin, { name: "Building Committee" });
    expect(() => service.updateGroup(leader, group.id, { leadershipAudience: true })).toThrow(
      ApiError,
    );
    expect(repo.findGroup(group.id)?.leadershipAudience).toBe(false);
  });

  it("refuses a leader who tries to add themselves to one", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    expect(() =>
      service.setGroupMembership(leader, {
        groupId: group.id,
        personId: leader.person.id,
        member: true,
      }),
    ).toThrow(ApiError);
    expect(repo.findGroup(group.id)?.memberIds).toEqual([]);
  });

  it("lets an administrator name one and put somebody in it", () => {
    const group = service.addGroup(admin, {
      name: "Elders",
      description: "Answers for the whole church.",
      leadershipAudience: true,
    });
    const saved = service.setGroupMembership(admin, {
      groupId: group.id,
      personId: elder.person.id,
      member: true,
    });
    expect(saved.memberIds).toEqual([elder.person.id]);
    expect(service.all().groups).toHaveLength(1);
  });
});

/**
 * What a group is for.
 *
 * Leadership used to be two ids compiled into the product. These assert that
 * it is now the church's own record — including the case that used to be
 * impossible, where the church has named no leadership at all.
 */
/**
 * A role the church defined is a role the church may assign.
 *
 * The list used to be a `z.enum` of the four the product ships, which meant a
 * defined role could be offered by the form and refused by the API — a control
 * that looks operational and is not.
 */
/**
 * Correcting a record, which is the half that had no way in.
 *
 * The service could always do this and nothing could reach it, so these are
 * the rules that had never been exercised: the two that stop an edit from
 * making the organisation contradict itself.
 */
describe("correcting a person's record", () => {
  it("changes what somebody is called without touching anything else", () => {
    const saved = service.updatePerson(admin, elder.person.id, { name: "Tobias Wren-Halloway" });
    expect(saved.name).toBe("Tobias Wren-Halloway");
    expect(saved.accessRole).toBe(repo.findPerson(elder.person.id)?.accessRole);
  });

  /* The reporting line is what "my reporting leader" resolves through, so a
     self-reference is an ask nobody else can ever answer. */
  it("refuses a reporting line that points at the person themselves", () => {
    expect(() =>
      service.updatePerson(admin, elder.person.id, { reportsToId: elder.person.id }),
    ).toThrow(ApiError);
    expect(repo.findPerson(elder.person.id)?.reportsToId).toBeUndefined();
  });

  it("refuses an email address somebody else already uses", () => {
    service.updatePerson(admin, elder.person.id, { email: "tobias@example.org" });
    expect(() =>
      service.updatePerson(admin, leader.person.id, { email: "tobias@example.org" }),
    ).toThrow(ApiError);
  });

  /* Saving a person's own address back to them is not a collision. */
  it("lets somebody keep the address they already have", () => {
    service.updatePerson(admin, elder.person.id, { email: "tobias@example.org" });
    expect(() =>
      service.updatePerson(admin, elder.person.id, {
        email: "tobias@example.org",
        name: "Tobias W.",
      }),
    ).not.toThrow();
  });

  it("is an administrator's to do", () => {
    expect(() => service.updatePerson(leader, elder.person.id, { name: "Anything" })).toThrow(
      ApiError,
    );
  });
});

/**
 * People leave. Ministries close.
 *
 * Deactivating is not deleting, and the distinction is the whole of what these
 * check: what is **offered** narrows, what is **stored** does not move, and
 * nothing about it decides who may read anything.
 */
/**
 * Where a person serves, and on whose authority.
 *
 * The security property under all of this: **what somebody says about
 * themselves is not an organisational fact.** Onboarding asks a leader which
 * ministries they are part of, and their answer must not become membership by
 * being typed into a form — because membership is what `access.ts` reads.
 */
describe("assignments", () => {
  let ministry: ReturnType<typeof service.addMinistry>;

  beforeEach(() => {
    ministry = service.addMinistry(admin, { name: "Music" });
  });

  it("records where somebody serves, what they do there, and who said so", () => {
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "coordinator",
    });

    const [assignment] = service.assignmentsFor(admin, leader.person.id);
    expect(assignment?.function).toBe("coordinator");
    expect(assignment?.status).toBe("confirmed");
  });

  /* The one that matters. */
  it("makes a person's claim about themselves pending, not membership", () => {
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });

    const [assignment] = service.assignmentsFor(leader, leader.person.id);
    expect(assignment?.status).toBe("pending");

    /* And the list authorization reads does not contain it. */
    expect(repo.findPerson(leader.person.id)?.ministryIds).toEqual([]);
    expect(repo.findMinistry(ministry.id)?.teamIds).toEqual([]);
  });

  it("makes a claimed group membership pending, so it reaches no audience", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    service.claimAssignment(leader, { scope: "group", targetId: group.id });

    expect(repo.findGroup(group.id)?.memberIds).toEqual([]);
    expect(repo.findPerson(leader.person.id)?.groupIds).toEqual([]);
  });

  it("becomes membership once somebody who may decide confirms it", () => {
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      status: "confirmed",
    });

    expect(repo.findPerson(leader.person.id)?.ministryIds).toEqual([ministry.id]);
  });

  it("refuses a leader who tries to assign somebody authoritatively", () => {
    expect(() =>
      service.setAssignment(leader, {
        scope: "ministry",
        targetId: ministry.id,
        personId: leader.person.id,
      }),
    ).toThrow(ApiError);
    expect(repo.findPerson(leader.person.id)?.ministryIds).toEqual([]);
  });

  /* Running onboarding twice must not produce two of anything. */
  it("is idempotent: claiming the same thing twice leaves one assignment", () => {
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });

    expect(service.assignmentsFor(leader, leader.person.id)).toHaveLength(1);
  });

  /* Claiming again must not undo a decision somebody already made. */
  it("does not downgrade a confirmed assignment back to a claim", () => {
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
    });
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });

    expect(service.assignmentsFor(leader, leader.person.id)[0]?.status).toBe("confirmed");
  });

  it("keeps an ended assignment as history rather than removing it", () => {
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "head",
    });
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      status: "ended",
    });

    const [assignment] = service.assignmentsFor(admin, leader.person.id);
    expect(assignment?.status).toBe("ended");
    expect(assignment?.endedAt).toBeTruthy();
    /* It stops being membership, and stays on the record. */
    expect(repo.findPerson(leader.person.id)?.ministryIds).toEqual([]);
  });

  it("lets somebody say a record about them is wrong, without changing it", () => {
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "head",
    });
    service.requestCorrection(leader, { scope: "ministry", targetId: ministry.id });

    const [assignment] = service.assignmentsFor(admin, leader.person.id);
    expect(assignment?.status).toBe("correction-requested");
    expect(assignment?.function).toBe("head");
  });

  it("shows an administrator everything waiting on a decision", () => {
    service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });
    expect(service.assignmentsAwaitingDecision(admin)).toHaveLength(1);
    expect(() => service.assignmentsAwaitingDecision(leader)).toThrow(ApiError);
  });

  it("refuses a claim on a ministry that is no longer running", () => {
    service.updateMinistry(admin, ministry.id, { active: false });
    expect(() =>
      service.claimAssignment(leader, { scope: "ministry", targetId: ministry.id }),
    ).toThrow(ApiError);
  });

  /* One person, several places, a different job in each. */
  it("carries a different function in each place somebody serves", () => {
    const committee = service.addGroup(admin, { name: "Safeguarding" });

    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "head",
    });
    service.setAssignment(admin, {
      scope: "group",
      targetId: committee.id,
      personId: leader.person.id,
      function: "member",
    });

    const assignments = service.assignmentsFor(admin, leader.person.id);
    expect(assignments).toHaveLength(2);
    expect(assignments.find((a) => a.scope === "ministry")?.function).toBe("head");
    expect(assignments.find((a) => a.scope === "group")?.function).toBe("member");
  });

  /**
   * A function is what the church calls the job. It is not a permission.
   *
   * Calling somebody "Head" here must grant nothing — authorization reads
   * capabilities, membership and ownership, never a label.
   */
  it("grants nothing by calling somebody a head", () => {
    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "head",
    });

    const viewer = viewerOf(repo.findPerson(leader.person.id)!);
    expect(viewer.persona.capabilities).toEqual([]);
  });

  /* A person can exist in the organisation long before they can sign in. */
  it("records somebody who has no way to sign in yet", () => {
    const entered = service.addPerson(admin, { name: "Ignatius Bekele" });
    expect(entered.email).toBeUndefined();

    service.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: entered.id,
      function: "member",
    });
    expect(repo.findPerson(entered.id)?.ministryIds).toEqual([ministry.id]);
  });

  it("refuses a claim on something that does not exist", () => {
    expect(() =>
      service.claimAssignment(leader, { scope: "group", targetId: "grp-invented-70241" }),
    ).toThrow(ApiError);
  });
});

/**
 * LifeGroup participation is not organisational membership.
 *
 * Doc 01 §8: coming to a gathering, or leading one, is fluid and
 * occasion-specific. Turning it into a standing assignment would make a year
 * of attendance into a permanent organisational fact nobody decided — and
 * leading a gathering already grants what it needs to grant, for that
 * gathering, through the gathering itself.
 */
describe("LifeGroup stays separate from the organisation", () => {
  it("creates no assignment for anybody, however the gathering went", () => {
    /* There is no call that could: the assignment surface names ministries and
       responsibility groups, and a gathering is neither. */
    expect(() =>
      service.claimAssignment(leader, { scope: "group", targetId: "gth-anything-70241" }),
    ).toThrow(ApiError);

    expect(service.assignmentsFor(admin, leader.person.id)).toEqual([]);
  });
});

describe("deactivating", () => {
  it("keeps the person, their name and everything about them", () => {
    service.updatePerson(admin, elder.person.id, { active: false });

    const still = repo.findPerson(elder.person.id);
    expect(still?.name).toBe("Tobias Wren");
    expect(still?.active).toBe(false);
    /* Still in the directory the rest of the product resolves names from. */
    expect(repo.people().some((person) => person.id === elder.person.id)).toBe(true);
  });

  it("can be undone", () => {
    service.updatePerson(admin, elder.person.id, { active: false });
    service.updatePerson(admin, elder.person.id, { active: true });
    expect(repo.findPerson(elder.person.id)?.active).toBe(true);
  });

  /* An inactive person is still whoever a record says wrote it. Access has
     never consulted this field and must not begin to. */
  it("does not change what anybody may read", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    service.setGroupMembership(admin, {
      groupId: group.id,
      personId: elder.person.id,
      member: true,
    });
    service.updatePerson(admin, elder.person.id, { active: false });

    expect(repo.findGroup(group.id)?.memberIds).toEqual([elder.person.id]);
    expect(repo.leadershipGroupIds()).toEqual([group.id]);
  });

  /**
   * The lockout, from the other direction.
   *
   * `configuration-service` refuses to take `administration` off the last role
   * that has it. This refuses to switch off the last person who holds such a
   * role — the same installation with nobody able to administer it, reached by
   * a different door.
   */
  it("will not leave nobody able to administer the installation", () => {
    expect(() => service.updatePerson(admin, admin.person.id, { active: false })).toThrow(ApiError);
    expect(repo.findPerson(admin.person.id)?.active).toBe(true);
  });

  it("allows it once somebody else can administer", () => {
    service.updatePerson(admin, elder.person.id, { accessRole: "admin" });

    expect(() => service.updatePerson(admin, admin.person.id, { active: false })).not.toThrow();
  });

  it("stops a ministry being offered without closing its records", () => {
    const ministry = service.addMinistry(admin, { name: "Music" });
    service.updateMinistry(admin, ministry.id, { active: false });

    expect(repo.findMinistry(ministry.id)?.active).toBe(false);
    expect(repo.findMinistry(ministry.id)?.name).toBe("Music");
  });

  it("is an administrator's to do", () => {
    expect(() => service.updatePerson(leader, elder.person.id, { active: false })).toThrow(
      ApiError,
    );
  });
});

describe("assigning an access role", () => {
  afterEach(() => resetOverrides());

  it("accepts a role this church defined", () => {
    applyOverrides([
      {
        namespace: "people.roles",
        optionId: "district-overseer-72540",
        isAddition: true,
        value: {
          label: "District Overseer 72540",
          active: true,
          capabilities: ["campus-oversight"],
        },
      } as never,
    ]);

    const person = service.addPerson(admin, {
      name: "Thaddeus Okoye",
      accessRole: "district-overseer-72540",
    });
    expect(person.accessRole).toBe("district-overseer-72540");

    /* And the capability is what acts, not the name. */
    const viewer = viewerOf(repo.findPerson(person.id)!);
    expect(viewer.persona.capabilities).toEqual(["campus-oversight"]);
  });

  it("refuses a role nobody defined", () => {
    expect(() =>
      service.addPerson(admin, { name: "Thaddeus Okoye", accessRole: "archbishop-72540" }),
    ).toThrow(ApiError);
  });
});

describe("a leadership report reaches the group the church named", () => {
  const report = (): LeadershipReport =>
    ({
      id: "rep-quiet",
      authorId: "p-somebody-else",
      visibility: "leadership",
      audienceIds: [],
      status: "published",
      sections: [],
    }) as unknown as LeadershipReport;

  it("reaches a member of the group", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    service.setGroupMembership(admin, {
      groupId: group.id,
      personId: elder.person.id,
      member: true,
    });

    const refreshed = viewerOf(repo.findPerson(elder.person.id)!);
    expect(
      canDiscover(report(), refreshed.persona, refreshed.person, repo.leadershipGroupIds()),
    ).toBe(true);
  });

  it("does not reach somebody the group does not list", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    service.setGroupMembership(admin, {
      groupId: group.id,
      personId: elder.person.id,
      member: true,
    });

    const refreshed = viewerOf(repo.findPerson(leader.person.id)!);
    expect(
      canDiscover(report(), refreshed.persona, refreshed.person, repo.leadershipGroupIds()),
    ).toBe(false);
  });

  it("reaches nobody while the church has named no leadership body", () => {
    expect(repo.leadershipGroupIds()).toEqual([]);
    const refreshed = viewerOf(repo.findPerson(elder.person.id)!);
    expect(
      canDiscover(report(), refreshed.persona, refreshed.person, repo.leadershipGroupIds()),
    ).toBe(false);
  });

  /* Deactivating a group withdraws the audience without rewriting history. */
  it("stops reaching a group the church has deactivated", () => {
    const group = service.addGroup(admin, { name: "Elders", leadershipAudience: true });
    service.setGroupMembership(admin, {
      groupId: group.id,
      personId: elder.person.id,
      member: true,
    });
    service.updateGroup(admin, group.id, { active: false });

    const refreshed = viewerOf(repo.findPerson(elder.person.id)!);
    expect(repo.leadershipGroupIds()).toEqual([]);
    expect(
      canDiscover(report(), refreshed.persona, refreshed.person, repo.leadershipGroupIds()),
    ).toBe(false);
  });
});
