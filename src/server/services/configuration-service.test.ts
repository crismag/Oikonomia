import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { openDatabase } from "../db/connection";
import { createConfigurationRepository } from "../repositories/configuration-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createConfigurationService } from "./configuration-service";
import { forgetConfiguration, refreshConfiguration } from "../config/runtime";
import { config, resetOverrides } from "@/config";
import { viewerOf } from "@/domain/viewer";
import { personaFor } from "@/domain/roles";
import { canAssignGatheringLeaders } from "@/domain/authorize";
import type { Database as Db } from "better-sqlite3";

/**
 * Managing configuration.
 *
 * The promise being tested is narrow and important: an administrator may
 * change **what a thing is called and whether it is offered**, and nothing
 * else. Not its id, which every historical record stores. Not what it means,
 * which is behaviour. A configuration system that could change either would be
 * a way to edit the product's logic through a settings form.
 */

let dir: string;
let db: Db;
let service: ReturnType<typeof createConfigurationService>;
let admin: ReturnType<typeof viewerOf>;
let leader: ReturnType<typeof viewerOf>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-config-"));
  db = openDatabase(join(dir, "test.db"));

  const org = createOrganizationRepository(db);
  admin = viewerOf(org.insertPerson({ name: "Grace Chua", accessRole: "admin" }));
  leader = viewerOf(org.insertPerson({ name: "Maria Santos", accessRole: "leader" }));

  service = createConfigurationService(createConfigurationRepository(db));
});

afterEach(() => {
  resetOverrides();
  forgetConfiguration();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("who may change configuration", () => {
  it("is an administrator", () => {
    expect(() => service.all(leader)).toThrow(ApiError);
    expect(() => service.all(admin)).not.toThrow();
  });

  it("refuses a leader's edit as well as their reading", () => {
    expect(() =>
      service.setOption(leader, {
        namespace: "work.statuses",
        optionId: "open",
        label: "Mine now",
      }),
    ).toThrow(ApiError);
  });
});

describe("renaming", () => {
  it("changes the label everywhere, and nothing else", () => {
    service.setOption(admin, {
      namespace: "work.statuses",
      optionId: "in-review",
      label: "Under review",
    });

    expect(config.label("work.statuses", "in-review")).toBe("Under review");
    /* The id is what records store. It does not move. */
    expect(config.option("work.statuses", "in-review")?.id).toBe("in-review");
    /* Nor does what the status means. */
    expect(config.semanticOf("work.statuses", "in-review")).toBe("info");
  });

  it("cannot rename something into existence", () => {
    expect(() =>
      service.setOption(admin, {
        namespace: "work.statuses",
        optionId: "invented",
        label: "Invented",
      }),
    ).toThrow(ApiError);
  });

  it("refuses an empty label", () => {
    expect(() =>
      service.setOption(admin, { namespace: "work.statuses", optionId: "open", label: "   " }),
    ).toThrow(ApiError);
  });

  it("refuses to touch configuration that is part of the product", () => {
    expect(() =>
      service.setOption(admin, {
        namespace: "escalation.types",
        optionId: "action",
        label: "Task",
      }),
    ).toThrow(ApiError);
  });
});

describe("deactivating", () => {
  it("stops it being offered and keeps history legible", () => {
    service.setOption(admin, {
      namespace: "meetings.types",
      optionId: "committee",
      active: false,
    });

    expect(config.options("meetings.types").some((o) => o.id === "committee")).toBe(false);
    /* A meeting already recorded as a committee meeting still says so. */
    expect(config.label("meetings.types", "committee")).toBe("Committee");
  });

  it("can offer it again", () => {
    service.setOption(admin, { namespace: "meetings.types", optionId: "committee", active: false });
    service.setOption(admin, { namespace: "meetings.types", optionId: "committee", active: true });
    expect(config.options("meetings.types").some((o) => o.id === "committee")).toBe(true);
  });

  it("has no delete at all", () => {
    expect((service as Record<string, unknown>)["deleteOption"]).toBeUndefined();
  });
});

describe("reordering", () => {
  it("puts an option where the administrator wants it", () => {
    service.setOption(admin, { namespace: "meetings.types", optionId: "other", sortOrder: 0 });
    expect(config.options("meetings.types")[0]?.id).toBe("other");
  });
});

describe("site and cadence values", () => {
  it("changes a scalar setting", () => {
    service.setValue(admin, { namespace: "site.profile", field: "pageSize", value: 10 });
    expect(config.site.pageSize).toBe(10);
  });

  it("refuses a setting the application does not read", () => {
    expect(() =>
      service.setValue(admin, { namespace: "site.profile", field: "invented", value: 1 }),
    ).toThrow(ApiError);
  });

  it("refuses a value the schema will not accept", () => {
    /* Validation runs after the merge, so a stored override cannot slip past
       the rules a file would have been held to. */
    expect(() => {
      service.setValue(admin, { namespace: "site.profile", field: "pageSize", value: 9999 });
      return config.site.pageSize;
    }).toThrow();
  });
});

describe("resetting", () => {
  it("forgets the override rather than writing the old value back", () => {
    service.setOption(admin, { namespace: "goals.statuses", optionId: "on-hold", label: "Paused" });
    expect(config.label("goals.statuses", "on-hold")).toBe("Paused");

    service.reset(admin, "goals.statuses", "on-hold");
    expect(config.label("goals.statuses", "on-hold")).toBe("On hold");

    /* Nothing left behind: the next upgrade's wording reaches this church. */
    expect(createConfigurationRepository(db).find("goals.statuses", "on-hold")).toBeUndefined();
  });
});

describe("history", () => {
  it("records what changed, who changed it, and what it was", () => {
    service.setOption(admin, {
      namespace: "work.statuses",
      optionId: "acknowledged",
      label: "Seen",
    });

    const [entry] = service.history(admin);
    expect(entry?.actorId).toBe(admin.person.id);
    expect(entry?.summary).toContain("Acknowledged");
    expect(entry?.summary).toContain("Seen");
    expect(entry?.before).toMatchObject({ label: "Acknowledged" });
  });

  it("is an administrator's to read", () => {
    expect(() => service.history(leader)).toThrow(ApiError);
  });
});

describe("what an override may not do", () => {
  it("ignores fields that are not an administrator's to set", () => {
    const repo = createConfigurationRepository(db);
    /* Written straight past the service, as a corrupted or hand-edited row
       would be: the registry still refuses to let it change behaviour. */
    repo.set({
      namespace: "work.statuses",
      optionId: "resolved",
      value: { label: "Done", semanticState: "danger", terminal: false, id: "something-else" },
      actorId: admin.person.id,
    });
    service.refresh();

    expect(config.label("work.statuses", "resolved")).toBe("Done");
    expect(config.semanticOf("work.statuses", "resolved")).toBe("success");
    expect(config.option("work.statuses", "resolved")?.id).toBe("resolved");
  });

  it("ignores an override for an option that no longer exists", () => {
    const repo = createConfigurationRepository(db);
    repo.set({
      namespace: "work.statuses",
      optionId: "removed-in-an-upgrade",
      value: { label: "Ghost" },
      actorId: admin.person.id,
    });
    service.refresh();

    expect(config.options("work.statuses").some((o) => o.label === "Ghost")).toBe(false);
  });
});

/**
 * Adding a value.
 *
 * The question this answers is not "can an administrator add things" but
 * "**where can adding a thing actually work?**" — and the answer is only
 * where the column accepts it and the code reads it generically. Everywhere
 * else an added option would be one nothing can set and nothing knows how to
 * handle, which is the definition of a control that lies.
 */
describe("adding an option", () => {
  it("is accepted for a vocabulary the application stores as free text", () => {
    const added = service.addOption(admin, {
      namespace: "meetings.types",
      label: "Prayer meeting",
    });

    expect(added.id).toBe("prayer-meeting");
    expect(config.options("meetings.types").some((o) => o.id === "prayer-meeting")).toBe(true);
    expect(config.label("meetings.types", "prayer-meeting")).toBe("Prayer meeting");
  });

  it("carries an attention trigger for a category, which is the point of adding one", () => {
    service.addOption(admin, {
      namespace: "information.categories",
      label: "Safeguarding concern",
      attentionTrigger: true,
    });

    const added = config.option("information.categories", "safeguarding-concern") as unknown as {
      attentionTrigger: boolean;
    };
    expect(added.attentionTrigger).toBe(true);
  });

  it("is refused for every vocabulary whose values are part of the product", () => {
    for (const namespace of [
      "reports.statuses",
      "reports.visibility",
      "work.statuses",
      "goals.statuses",
      "lifegroup.attendance",
      "meetings.noteTypes",
    ]) {
      expect(() => service.addOption(admin, { namespace, label: "Something" })).toThrow(ApiError);
    }
  });

  it("is an administrator's to do", () => {
    expect(() =>
      service.addOption(leader, { namespace: "meetings.types", label: "Prayer meeting" }),
    ).toThrow(ApiError);
  });

  it("refuses a name that collides with something already on the list", () => {
    expect(() =>
      service.addOption(admin, { namespace: "meetings.types", label: "Ministry" }),
    ).toThrow(ApiError);
  });

  it("refuses a name with nothing in it to make an id from", () => {
    expect(() => service.addOption(admin, { namespace: "meetings.types", label: "!!!" })).toThrow(
      ApiError,
    );
  });

  /**
   * The id is fixed at the moment of adding, and renaming never touches it —
   * which is what makes renaming safe for records already filed under it.
   */
  it("keeps its id when it is renamed afterwards", () => {
    const added = service.addOption(admin, {
      namespace: "meetings.types",
      label: "Prayer meeting",
    });
    service.setOption(admin, {
      namespace: "meetings.types",
      optionId: added.id,
      label: "Prayer and fasting",
    });

    expect(config.option("meetings.types", "prayer-meeting")?.label).toBe("Prayer and fasting");
    expect(config.option("meetings.types", "prayer-and-fasting")).toBeUndefined();
  });

  it("can be stopped, like anything else, and is never deleted", () => {
    const added = service.addOption(admin, {
      namespace: "meetings.types",
      label: "Prayer meeting",
    });
    service.setOption(admin, {
      namespace: "meetings.types",
      optionId: added.id,
      active: false,
    });

    expect(config.options("meetings.types").some((o) => o.id === added.id)).toBe(false);
    expect(config.label("meetings.types", added.id)).toBe("Prayer meeting");
  });

  it("is recorded, with who added it", () => {
    service.addOption(admin, { namespace: "meetings.types", label: "Prayer meeting" });
    const [entry] = service.history(admin);
    expect(entry?.summary).toContain("Added");
    expect(entry?.actorId).toBe(admin.person.id);
  });
});

describe("where an added option sits", () => {
  it("goes to the end of the list rather than the front", () => {
    const before = config.options("meetings.types").map((o) => o.id);
    const added = service.addOption(admin, {
      namespace: "meetings.types",
      label: "Prayer meeting",
    });

    const after = config.options("meetings.types").map((o) => o.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[after.length - 1]).toBe(added.id);
  });
});

/**
 * Configuration is effective at runtime, not at deployment.
 *
 * Saving a change must not need a rebuild, a redeploy or a restart. Writing it
 * to the database does not achieve that on its own — **every request has to
 * read it**, including requests served by a process that was already running
 * when the change was made.
 *
 * These tests use names the application could not possibly have hard-coded, so
 * passing them is evidence of configurability rather than of defaults.
 */
describe("a change reaches a process that did not make it", () => {
  it("is picked up on the next request, without a restart", () => {
    service.setOption(admin, {
      namespace: "work.statuses",
      optionId: "open",
      label: "Regional Review 91827",
    });

    /* A second process: its own registry state, its own idea of what has been
       applied — exactly what a second server instance would have. */
    resetOverrides();
    forgetConfiguration();
    expect(config.label("work.statuses", "open")).toBe("Open");

    refreshConfiguration(db);
    expect(config.label("work.statuses", "open")).toBe("Regional Review 91827");
  });

  it("does no work when nothing has changed", () => {
    refreshConfiguration(db);
    const before = config.get("work.statuses");
    refreshConfiguration(db);
    /* Same object: the stamp matched, so nothing was re-read or re-parsed. */
    expect(config.get("work.statuses")).toBe(before);
  });

  it("notices a later change too, not just the first", () => {
    refreshConfiguration(db);
    service.setOption(admin, {
      namespace: "goals.statuses",
      optionId: "on-hold",
      label: "Paused 91827",
    });

    resetOverrides();
    refreshConfiguration(db);
    expect(config.label("goals.statuses", "on-hold")).toBe("Paused 91827");
  });

  it("notices a reset as well as a change", () => {
    service.setOption(admin, {
      namespace: "goals.statuses",
      optionId: "completed",
      label: "Finished 91827",
    });
    refreshConfiguration(db);
    expect(config.label("goals.statuses", "completed")).toBe("Finished 91827");

    service.reset(admin, "goals.statuses", "completed");
    resetOverrides();
    forgetConfiguration();
    refreshConfiguration(db);
    expect(config.label("goals.statuses", "completed")).toBe("Completed");
  });
});

/**
 * Configuration that will not validate must not take the application down.
 *
 * The service validates everything it writes, so this is the hand-edited row,
 * the partial restore, the schema change a future version brings. The last
 * configuration that loaded stays in force, and the bad row is picked up again
 * as soon as it is corrected.
 */
describe("a bad configuration row", () => {
  it("leaves the application running on the last good configuration", () => {
    service.setOption(admin, {
      namespace: "goals.statuses",
      optionId: "active",
      label: "Running 91827",
    });
    refreshConfiguration(db);
    expect(config.label("goals.statuses", "active")).toBe("Running 91827");

    /* Straight past the service, as a hand-edited row would be. */
    createConfigurationRepository(db).set({
      namespace: "reports.visibility",
      optionId: "private",
      value: { accessStrategy: "read-by-anyone" },
      actorId: admin.person.id,
    });

    expect(() => refreshConfiguration(db)).not.toThrow();
    /* Still serving: the good change is in force and the bad one is not. */
    expect(config.label("goals.statuses", "active")).toBe("Running 91827");
    expect(config.label("reports.visibility", "private")).toBe("Only me");
  });

  it("picks the correction up without a restart", () => {
    createConfigurationRepository(db).set({
      namespace: "reports.visibility",
      optionId: "private",
      value: { accessStrategy: "read-by-anyone" },
      actorId: admin.person.id,
    });
    refreshConfiguration(db);

    createConfigurationRepository(db).set({
      namespace: "reports.visibility",
      optionId: "private",
      value: { label: "Just me 91827", accessStrategy: "owner-only" },
      actorId: admin.person.id,
    });
    refreshConfiguration(db);

    expect(config.label("reports.visibility", "private")).toBe("Just me 91827");
  });
});

/**
 * A role is a name for a bundle of permissions.
 *
 * The separation these guard: the church owns the **names and the bundles**,
 * the application owns the **permissions**. So a church may invent a role and
 * it works; it may not invent a permission, and it may not lock itself out.
 */
/**
 * The administration screen is built by walking a list of namespaces, so a
 * duplicate in that list renders a whole section twice — which is exactly what
 * happened, and what no test noticed until somebody opened the page.
 */
describe("the administration screen", () => {
  it("shows each vocabulary once", () => {
    const shown = service.all(admin).namespaces.map((view) => view.namespace);
    expect(shown).toEqual([...new Set(shown)]);
  });

  it("offers an Add control exactly where adding is honest", () => {
    const addable = service
      .all(admin)
      .namespaces.filter((view) => view.addable)
      .map((view) => view.namespace)
      .sort();

    expect(addable).toEqual([
      "information.categories",
      "lifegroup.entryVisibility",
      "meetings.types",
      "people.roles",
      "reports.statuses",
      "reports.visibility",
    ]);
  });

  /* A list that cannot be added to has to say why, or the absence of the
     button reads as an oversight. */
  it("explains every list that cannot be added to", () => {
    for (const view of service.all(admin).namespaces) {
      if (!view.addable) expect(view.fixedReason, view.namespace).toBeTruthy();
    }
  });
});

describe("access roles an administrator defines", () => {
  afterEach(() => resetOverrides());

  it("can be added, and starts with nothing it was not given", () => {
    const added = service.addOption(admin, {
      namespace: "people.roles",
      label: "Regional Overseer 40218",
    });
    service.refresh();

    const persona = personaFor(added.id, "p-anybody");
    expect(persona.label).toBe("Regional Overseer 40218");
    expect(persona.capabilities).toEqual([]);
  });

  it("holds exactly the permissions that were ticked", () => {
    const added = service.addOption(admin, {
      namespace: "people.roles",
      label: "Regional Overseer 40218",
      capabilities: ["campus-oversight"],
    });
    service.refresh();

    expect(personaFor(added.id, "p-anybody").capabilities).toEqual(["campus-oversight"]);
  });

  /* The point of the whole separation: a rule reads the capability, so a role
     nothing was written against still works. */
  it("is enforced by the capability, not by the name", () => {
    const added = service.addOption(admin, {
      namespace: "people.roles",
      label: "Regional Overseer 40218",
      capabilities: ["campus-oversight"],
    });
    service.refresh();

    const viewer = { persona: personaFor(added.id, "p-anybody"), person: {} as never };
    expect(canAssignGatheringLeaders(viewer)).toBe(true);
  });

  it("refuses a permission the application does not implement", () => {
    expect(() =>
      service.addOption(admin, {
        namespace: "people.roles",
        label: "Regional Overseer 40218",
        capabilities: ["read-everything"] as never,
      }),
    ).toThrow(ApiError);
  });

  it("takes a permission away again when it is unticked", () => {
    service.setOption(admin, {
      namespace: "people.roles",
      optionId: "bishop",
      capabilities: ["campus-oversight"],
    });
    service.refresh();

    expect(personaFor("bishop", "p-anybody").capabilities).toEqual(["campus-oversight"]);
  });

  /**
   * The lockout. Removing administration from the last role that has it would
   * leave nobody able to undo it, and the only screen that could is the one
   * that just closed.
   */
  it("will not leave the installation with nobody able to administer it", () => {
    expect(() =>
      service.setOption(admin, {
        namespace: "people.roles",
        optionId: "admin",
        capabilities: [],
      }),
    ).toThrow(ApiError);

    service.refresh();
    expect(personaFor("admin", "p-anybody").capabilities).toEqual(["administration"]);
  });

  it("will not let the last administering role be deactivated either", () => {
    expect(() =>
      service.setOption(admin, { namespace: "people.roles", optionId: "admin", active: false }),
    ).toThrow(ApiError);
  });

  it("allows it once another role can administer", () => {
    service.addOption(admin, {
      namespace: "people.roles",
      label: "Registrar 40218",
      capabilities: ["administration"],
    });
    service.refresh();

    expect(() =>
      service.setOption(admin, {
        namespace: "people.roles",
        optionId: "admin",
        capabilities: [],
      }),
    ).not.toThrow();
  });

  it("is an administrator's to change", () => {
    expect(() =>
      service.setOption(leader, {
        namespace: "people.roles",
        optionId: "leader",
        capabilities: ["administration"],
      }),
    ).toThrow(ApiError);
  });
});
