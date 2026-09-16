import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { seedOrganization } from "@/test/seeds";
import { openDatabase } from "../db/connection";
import { createGoalsRepository } from "../repositories/goals-repository";
import { createGoalsService } from "./goals-service";
import { viewerFor } from "@/test/viewer";
import type { Database as Db } from "better-sqlite3";

/**
 * Goals persistence and rules.
 *
 * A goal is the binder's annual intention, so the cases that matter are about
 * the *record* rather than about CRUD: that a year keeps its numbering, that a
 * status change leaves a line saying why, and that carrying a goal forward does
 * not rewrite the year it came from.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createGoalsService>;
let repo: ReturnType<typeof createGoalsRepository>;

const maria = viewerFor("leader");
const joel = viewerFor("ministry-head");
const bishop = viewerFor("bishop");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-goals-"));
  db = openDatabase(join(dir, "test.db"));
  seedOrganization(db);
  repo = createGoalsRepository(db);
  service = createGoalsService(repo, createOrganizationRepository(db));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Music is Maria's ministry; Transportation is not. */
const goal = (over: Record<string, unknown> = {}) => ({
  title: "Training for excellence",
  year: 2026,
  scope: "ministry",
  ministryId: "min-music",
  ...over,
});

describe("setting a goal", () => {
  it("persists it and gives it an id", () => {
    const created = service.createGoal(maria, goal());
    expect(created.id).toMatch(/^goal-/);
    expect(repo.findGoal(created.id)?.title).toBe("Training for excellence");
  });

  it("starts active and owned by whoever set it", () => {
    const created = service.createGoal(maria, goal());
    expect(created.status).toBe("active");
    expect(created.ownerId).toBe(maria.person.id);
  });

  /** The binder's "01", "02" — its position in the year. */
  it("numbers them in the order they were set", () => {
    expect(service.createGoal(maria, goal({ title: "First" })).number).toBe(1);
    expect(service.createGoal(maria, goal({ title: "Second" })).number).toBe(2);
    expect(service.createGoal(maria, goal({ title: "Third" })).number).toBe(3);
  });

  it("numbers each year from one", () => {
    service.createGoal(maria, goal({ year: 2026 }));
    expect(service.createGoal(maria, goal({ year: 2027 })).number).toBe(1);
  });

  it("refuses a goal with no title", () => {
    expect(() => service.createGoal(maria, goal({ title: "   " }))).toThrow(ApiError);
  });

  it("keeps a month target a month, and a date target a date", () => {
    const month = service.createGoal(
      maria,
      goal({ target: { precision: "month", value: "2026-07" } }),
    );
    const date = service.createGoal(
      maria,
      goal({ target: { precision: "date", value: "2026-09-30" } }),
    );

    expect(repo.findGoal(month.id)?.target).toEqual({ precision: "month", value: "2026-07" });
    expect(repo.findGoal(date.id)?.target).toEqual({ precision: "date", value: "2026-09-30" });
  });

  it("refuses a month target wearing a date", () => {
    expect(() =>
      service.createGoal(maria, goal({ target: { precision: "month", value: "2026-07-01" } })),
    ).toThrow(ApiError);
  });
});

describe("a year of goals", () => {
  it("returns them in the binder's order", () => {
    service.createGoal(maria, goal({ title: "First" }));
    service.createGoal(maria, goal({ title: "Second" }));

    const { goals } = service.listYear(maria, { year: 2026 });
    expect(goals.map((g) => g.title)).toEqual(["First", "Second"]);
  });

  it("keeps years apart", () => {
    service.createGoal(maria, goal({ year: 2026, title: "This year" }));
    service.createGoal(maria, goal({ year: 2027, title: "Next year" }));

    expect(service.listYear(maria, { year: 2026 }).goals.map((g) => g.title)).toEqual([
      "This year",
    ]);
  });

  it("lists the years that have goals in them", () => {
    service.createGoal(maria, goal({ year: 2025 }));
    service.createGoal(maria, goal({ year: 2027 }));
    expect(service.listYear(maria, { year: 2026 }).years).toEqual([2027, 2025]);
  });

  it("brings each goal's updates with it", () => {
    const created = service.createGoal(maria, goal());
    service.addUpdate(maria, { goalId: created.id, text: "Ran the first walkthrough." });

    const { updates } = service.listYear(maria, { year: 2026 });
    expect(updates.map((u) => u.text)).toEqual(["Ran the first walkthrough."]);
  });
});

/**
 * Goals carry an `AudiencePolicy`, and the page says how many it withheld.
 * Stating the number is the product's existing answer: aggregate existence may
 * be acknowledged, identity may not.
 */
describe("a goal held to a narrower audience", () => {
  /*
   * Written through the repository, not the service: there is no UI for
   * classifying a goal and the create contract does not accept a policy, so
   * creating one through the service would be testing a path that does not
   * exist. What is under test is the *read* path — that a policy already on a
   * goal is honoured everywhere it is read.
   */
  const confidential = () =>
    repo.insertGoal({
      title: "Pastoral concern",
      year: 2026,
      scope: "personal",
      ownerId: maria.person.id,
      status: "active",
      links: [],
      policy: { classification: "pastoral-private", ownerId: maria.person.id },
    } as never);

  it("is listed for the person it belongs to", () => {
    confidential();
    expect(service.listYear(maria, { year: 2026 }).goals).toHaveLength(1);
  });

  it("is not listed for anybody else", () => {
    confidential();
    expect(service.listYear(joel, { year: 2026 }).goals).toHaveLength(0);
    expect(service.listYear(bishop, { year: 2026 }).goals).toHaveLength(0);
  });

  it("is counted as withheld rather than silently missing", () => {
    confidential();
    service.createGoal(maria, goal({ title: "Ordinary" }));

    const { goals, withheld } = service.listYear(joel, { year: 2026 });
    expect(goals.map((g) => g.title)).toEqual(["Ordinary"]);
    expect(withheld).toBe(1);
  });

  it("says nothing about what it is", () => {
    confidential();
    const listed = JSON.stringify(service.listYear(joel, { year: 2026 }));
    expect(listed).not.toContain("Pastoral concern");
  });

  it("cannot be opened by id either", () => {
    const created = confidential();
    expect(() => service.getGoal(joel, created.id)).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("withholds nothing when every goal is ordinary", () => {
    service.createGoal(maria, goal());
    expect(service.listYear(bishop, { year: 2026 }).withheld).toBe(0);
  });
});

describe("who may change a goal", () => {
  it("lets someone in the ministry edit it", () => {
    const created = service.createGoal(maria, goal());
    expect(service.updateGoal(maria, created.id, { title: "Renamed" }).title).toBe("Renamed");
  });

  it("does not let someone outside it", () => {
    /* Set directly: Maria could not have set it, which is the point. */
    const created = repo.insertGoal({
      title: "Transport plan",
      year: 2026,
      scope: "ministry",
      ministryId: "min-transport",
      status: "active",
      links: [],
    } as never);
    expect(() => service.updateGoal(maria, created.id, { title: "Hijacked" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("refuses a goal that does not exist", () => {
    expect(() => service.updateGoal(maria, "goal-nope", { title: "x" })).toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

describe("progress", () => {
  it("records an update, dated and attributed", () => {
    const created = service.createGoal(maria, goal());
    const update = service.addUpdate(maria, { goalId: created.id, text: "Four volunteers came." });

    expect(update.authorId).toBe(maria.person.id);
    expect(update.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(update.kind).toBe("note");
  });

  it("refuses an empty update", () => {
    const created = service.createGoal(maria, goal());
    expect(() => service.addUpdate(maria, { goalId: created.id, text: "  " })).toThrow(ApiError);
  });

  it("does not let an outsider add one", () => {
    /* Set directly: Maria could not have set it, which is the point. */
    const created = repo.insertGoal({
      title: "Transport plan",
      year: 2026,
      scope: "ministry",
      ministryId: "min-transport",
      status: "active",
      links: [],
    } as never);
    expect(() => service.addUpdate(maria, { goalId: created.id, text: "x" })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
});

describe("finishing, pausing and picking up again", () => {
  it("completes with the note that says why it mattered", () => {
    const created = service.createGoal(maria, goal());
    const done = service.complete(maria, created.id, "Every volunteer can run a service now.");

    expect(done.status).toBe("completed");
    expect(done.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.completionNote).toBe("Every volunteer can run a service now.");
  });

  /** A status change is a line in the history, not only a column. */
  it("leaves a line in the goal's history", () => {
    const created = service.createGoal(maria, goal());
    service.complete(maria, created.id, "Done at last.");

    const { updates } = service.getGoal(maria, created.id);
    expect(updates.map((u) => [u.kind, u.text])).toEqual([["completion", "Done at last."]]);
  });

  it("refuses to complete the same goal twice", () => {
    const created = service.createGoal(maria, goal());
    service.complete(maria, created.id);
    expect(() => service.complete(maria, created.id)).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("holds with a reason, because the reason is the point", () => {
    const created = service.createGoal(maria, goal());
    const held = service.hold(maria, created.id, "Waiting on the camp dates");

    expect(held.status).toBe("on-hold");
    expect(held.holdReason).toBe("Waiting on the camp dates");
    expect(held.holdSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("clears the hold when it is picked up again", () => {
    const created = service.createGoal(maria, goal());
    service.hold(maria, created.id, "Waiting");
    const resumed = service.resume(maria, created.id);

    expect(resumed.status).toBe("active");
    expect(resumed.holdReason).toBeUndefined();
    expect(resumed.holdSince).toBeUndefined();
  });

  it("clears a hold when the goal is completed from it", () => {
    const created = service.createGoal(maria, goal());
    service.hold(maria, created.id, "Waiting");
    const done = service.complete(maria, created.id);

    expect(done.status).toBe("completed");
    expect(done.holdReason).toBeUndefined();
  });
});

/**
 * A year's binder records what that year intended. Carrying a goal forward
 * must not rewrite it.
 */
describe("carrying a goal into a later year", () => {
  it("makes a new goal in the new year", () => {
    const created = service.createGoal(maria, goal({ year: 2026 }));
    const carried = service.carryForward(maria, created.id, 2027);

    expect(carried.id).not.toBe(created.id);
    expect(carried.year).toBe(2027);
    expect(carried.status).toBe("active");
    expect(carried.carriedFromGoalId).toBe(created.id);
  });

  it("marks the old one carried rather than deleting it", () => {
    const created = service.createGoal(maria, goal({ year: 2026 }));
    service.carryForward(maria, created.id, 2027);

    const original = repo.findGoal(created.id);
    expect(original).toBeDefined();
    expect(original?.status).toBe("carried-forward");
  });

  it("numbers the new goal in its own year", () => {
    service.createGoal(maria, goal({ year: 2027, title: "Already there" }));
    const created = service.createGoal(maria, goal({ year: 2026 }));

    expect(service.carryForward(maria, created.id, 2027).number).toBe(2);
  });

  it("does not carry the old year's completion with it", () => {
    const created = service.createGoal(maria, goal({ year: 2026 }));
    service.hold(maria, created.id, "Ran out of time");
    const carried = service.carryForward(maria, created.id, 2027);

    expect(carried.holdReason).toBeUndefined();
    expect(carried.status).toBe("active");
  });

  it("refuses to carry a goal backwards", () => {
    const created = service.createGoal(maria, goal({ year: 2026 }));
    expect(() => service.carryForward(maria, created.id, 2025)).toThrow(ApiError);
  });

  it("leaves a line saying where it went", () => {
    const created = service.createGoal(maria, goal({ year: 2026 }));
    service.carryForward(maria, created.id, 2027);

    const { updates } = service.getGoal(maria, created.id);
    expect(updates[0]?.text).toContain("2027");
  });
});

describe("deleting", () => {
  it("takes the goal's updates with it", () => {
    const created = service.createGoal(maria, goal());
    const update = service.addUpdate(maria, { goalId: created.id, text: "Something" });

    service.deleteGoal(maria, created.id);
    expect(repo.findUpdate(update.id)).toBeUndefined();
  });

  it("does not let an outsider delete one", () => {
    /* Set directly: Maria could not have set it, which is the point. */
    const created = repo.insertGoal({
      title: "Transport plan",
      year: 2026,
      scope: "ministry",
      ministryId: "min-transport",
      status: "active",
      links: [],
    } as never);
    expect(() => service.deleteGoal(maria, created.id)).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(repo.findGoal(created.id)).toBeDefined();
  });
});

/**
 * Whose a goal is, chosen when it is set. The scope decides what it needs and
 * who may change it, and it is never inferred from which fields happen to be
 * filled in.
 */
describe("what a goal belongs to", () => {
  it("makes a personal goal the setter's own, whatever owner is sent", () => {
    const created = service.createGoal(maria, {
      title: "Read more",
      year: 2026,
      scope: "personal",
      ownerId: joel.person.id,
    });
    expect(created.scope).toBe("personal");
    expect(created.ownerId).toBe(maria.person.id);
  });

  it("keeps a personal goal that relates to a ministry personal", () => {
    const created = service.createGoal(maria, {
      title: "Lead worship more calmly",
      year: 2026,
      scope: "personal",
      ministryId: "min-music",
    });
    expect(created.scope).toBe("personal");
    expect(created.ministryId).toBe("min-music");
  });

  it("lets only its owner change a personal goal", () => {
    const created = service.createGoal(maria, { title: "Mine", year: 2026, scope: "personal" });
    expect(() => service.updateGoal(joel, created.id, { title: "Not yours" })).toThrow(ApiError);
    expect(service.updateGoal(maria, created.id, { title: "Still mine" }).title).toBe("Still mine");
  });

  it("refuses a ministry goal without its ministry", () => {
    expect(() =>
      service.createGoal(maria, { title: "Orphan", year: 2026, scope: "ministry" }),
    ).toThrow(ApiError);
  });

  it("refuses a ministry goal from somebody outside the ministry", () => {
    expect(() => service.createGoal(maria, goal({ ministryId: "min-transport" }))).toThrow(
      ApiError,
    );
  });

  it("refuses a group goal from somebody who is not in the group", () => {
    const organization = createOrganizationRepository(db);
    const group = organization.insertGroup({ name: "Elders" });
    organization.setGroupMembership(group.id, joel.person.id, true);
    expect(() =>
      service.createGoal(maria, { title: "Theirs", year: 2026, scope: "other", groupId: group.id }),
    ).toThrow(ApiError);
    expect(
      service.createGoal(joel, { title: "Ours", year: 2026, scope: "other", groupId: group.id })
        .scope,
    ).toBe("other");
  });

  it("refuses a goal that does not say whose it is", () => {
    expect(() => service.createGoal(maria, { title: "Whose?", year: 2026 })).toThrow(ApiError);
  });
});
