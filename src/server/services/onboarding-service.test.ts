import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createOnboardingRepository } from "../repositories/onboarding-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createOnboardingService } from "./onboarding-service";
import { createOrganizationService } from "./organization-service";
import { ONBOARDING_VERSION } from "@/domain/onboarding";
import { viewerOf } from "@/domain/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Setting a leader up.
 *
 * The property every test here is really about: **onboarding owns its own
 * progress and nothing else.** It reads the organisation, asks the person to
 * confirm it, and writes back only through the assignment service — which turns
 * what somebody says about themselves into a claim. There is no path from this
 * flow to membership, a role or a capability, and a replay cannot overwrite a
 * decision an administrator made.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createOnboardingService>;
let organization: ReturnType<typeof createOrganizationService>;
let repo: ReturnType<typeof createOrganizationRepository>;

let admin: ReturnType<typeof viewerOf>;
let leader: ReturnType<typeof viewerOf>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-onboarding-"));
  db = openDatabase(join(dir, "test.db"));
  repo = createOrganizationRepository(db);
  organization = createOrganizationService(repo);
  service = createOnboardingService(createOnboardingRepository(db), repo);

  const adminRecord = repo.insertPerson({ name: "Perpetua Okonkwo", accessRole: "admin" });
  const leaderRecord = repo.insertPerson({ name: "Delphine Arceneaux", accessRole: "leader" });

  admin = viewerOf(repo.findPerson(adminRecord.id)!);
  leader = viewerOf(repo.findPerson(leaderRecord.id)!);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("where somebody is in setting themselves up", () => {
  it("starts nobody off having done it", () => {
    const context = service.context(leader);
    expect(context.state.status).toBe("not-started");
    expect(context.required).toBe(true);
  });

  it("remembers where they got to, so closing the browser loses nothing", () => {
    service.start(leader);
    service.moveTo(leader, "ministries");

    /* A fresh service, as a new request would build. */
    const reopened = createOnboardingService(createOnboardingRepository(db), repo);
    expect(reopened.context(leader).state.step).toBe("ministries");
    expect(reopened.context(leader).state.status).toBe("in-progress");
  });

  it("resumes rather than restarting somebody who is mid-flow", () => {
    service.start(leader);
    service.moveTo(leader, "reporting");
    expect(service.start(leader).state.step).toBe("reporting");
  });

  it("refuses a step that is not one of the steps", () => {
    expect(() => service.moveTo(leader, "invented-70241")).toThrow(ApiError);
  });

  it("stops asking once they have finished the current version", () => {
    service.complete(leader);

    const context = service.context(leader);
    expect(context.state.status).toBe("complete");
    expect(context.state.version).toBe(ONBOARDING_VERSION);
    expect(context.required).toBe(false);
  });

  /* A church that adds a required confirmation should not drag everybody back
     through the welcome screen, but it must ask them again. */
  it("asks again when the process has moved on since they finished", () => {
    createOnboardingRepository(db).save(leader.person.id, {
      status: "complete",
      step: "summary",
      version: ONBOARDING_VERSION - 1,
    });

    expect(service.context(leader).required).toBe(true);
  });
});

describe("what onboarding shows somebody", () => {
  it("shows the organisation as it actually stands, not a copy", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    organization.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "coordinator",
    });

    const context = service.context(leader);
    expect(context.assignments).toHaveLength(1);
    expect(context.assignments[0]?.function).toBe("coordinator");
    expect(context.assignments[0]?.status).toBe("confirmed");
  });

  /* A step with nothing in it is removed rather than shown empty: a blank
     screen mid-flow reads as a broken page. */
  it("leaves out the steps that would have nothing on them", () => {
    expect(service.context(leader).steps).not.toContain("ministries");
    expect(service.context(leader).steps).not.toContain("groups");
    expect(service.context(leader).steps).not.toContain("reporting");

    organization.addMinistry(admin, { name: "Music" });
    expect(service.context(leader).steps).toContain("ministries");
  });

  it("asks about reporting only when the church has recorded something to confirm", () => {
    expect(service.context(leader).steps).not.toContain("reporting");

    organization.updatePerson(admin, leader.person.id, { reportsToId: admin.person.id });
    const refreshed = viewerOf(repo.findPerson(leader.person.id)!);

    expect(service.context(refreshed).steps).toContain("reporting");
    expect(service.context(refreshed).reportsTo?.name).toBe("Perpetua Okonkwo");
  });

  it("derives who somebody oversees rather than storing it twice", () => {
    organization.updatePerson(admin, leader.person.id, { reportsToId: admin.person.id });
    expect(service.context(admin).oversees.map((p) => p.id)).toEqual([leader.person.id]);
  });

  /* Touring a module somebody cannot reach teaches them the product has one
     and that they may not use it. */
  it("does not tour what this person cannot reach", () => {
    const leaderStops = service.context(leader).tour.map((stop) => stop.to);
    expect(leaderStops).not.toContain("/administration");
    expect(leaderStops).toContain("/");

    expect(service.context(admin).tour.map((stop) => stop.to)).toContain("/administration");
  });
});

/**
 * The security property. Onboarding is not an authorization shortcut.
 */
describe("what onboarding cannot do", () => {
  it("cannot join a ministry — saying so is a claim somebody must confirm", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    organization.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });

    expect(service.context(leader).assignments[0]?.status).toBe("pending");
    /* The list authorization reads is untouched. */
    expect(repo.findPerson(leader.person.id)?.ministryIds).toEqual([]);
  });

  it("cannot put somebody into the leadership audience", () => {
    const group = organization.addGroup(admin, { name: "Elders", leadershipAudience: true });
    organization.claimAssignment(leader, { scope: "group", targetId: group.id });

    expect(repo.findGroup(group.id)?.memberIds).toEqual([]);
  });

  it("cannot change a role or a capability", () => {
    service.start(leader);
    service.complete(leader);

    const after = viewerOf(repo.findPerson(leader.person.id)!);
    expect(after.persona.id).toBe("leader");
    expect(after.persona.capabilities).toEqual([]);
  });

  /* Replay is not a reset. */
  it("does not overwrite an administrator's decision when somebody replays it", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    organization.setAssignment(admin, {
      scope: "ministry",
      targetId: ministry.id,
      personId: leader.person.id,
      function: "head",
    });

    service.start(leader);
    organization.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });
    service.complete(leader);

    const [assignment] = service.context(leader).assignments;
    expect(assignment?.status).toBe("confirmed");
    expect(assignment?.function).toBe("head");
  });

  it("creates no duplicates however many times it is run", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });

    for (let run = 0; run < 3; run += 1) {
      service.start(leader);
      organization.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });
      service.complete(leader);
    }

    expect(service.context(leader).assignments).toHaveLength(1);
  });
});

describe("what somebody is told at the end", () => {
  it("counts what is confirmed and says separately what is waiting", () => {
    const confirmed = organization.addMinistry(admin, { name: "Music" });
    const claimed = organization.addMinistry(admin, { name: "Hospitality" });

    organization.setAssignment(admin, {
      scope: "ministry",
      targetId: confirmed.id,
      personId: leader.person.id,
    });
    organization.claimAssignment(leader, { scope: "ministry", targetId: claimed.id });

    const summary = service.summary(leader);
    expect(summary.serving).toBe(1);
    expect(summary.awaiting).toBe(1);
  });

  /* Promising a workspace built from claims nobody has agreed to would promise
     visibility authorization does not grant. */
  it("does not count a claim as somewhere they serve", () => {
    const ministry = organization.addMinistry(admin, { name: "Music" });
    organization.claimAssignment(leader, { scope: "ministry", targetId: ministry.id });

    expect(service.summary(leader).serving).toBe(0);
  });
});
