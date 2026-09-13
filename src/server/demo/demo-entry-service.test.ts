import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as Db } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../api/response";
import { SESSION_COOKIE, viewerFor } from "../auth/principal";
import { openDatabase } from "../db/connection";
import { createAccountRepository } from "../repositories/account-repository";
import { createDemoIdentityRepository } from "../repositories/demo-identity-repository";
import { createOnboardingRepository } from "../repositories/onboarding-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "../services/auth-service";
import { VISITOR_LIMIT, VISITOR_NAME_MAX, createDemoEntryService } from "./demo-entry-service";
import { setupRequired } from "@/domain/onboarding";

/**
 * The entrance to a public demonstration.
 *
 * What these hold: both gates are needed; only a designated identity can be
 * chosen; what comes out is an ordinary session the ordinary principal
 * resolution believes; a visitor is an ordinary person with no way in but this
 * one; and neither switching nor visiting accumulates without bound.
 */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-demo-entry-"));
  db = openDatabase(join(dir, "demo.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const repositories = () => ({
  accounts: createAccountRepository(db),
  organization: createOrganizationRepository(db),
  identities: createDemoIdentityRepository(db),
});

const serviceFor = (demoMode: boolean) => {
  const { accounts, organization, identities } = repositories();
  return createDemoEntryService({
    demoMode,
    identities,
    accounts,
    organization,
    auth: createAuthService(accounts, organization),
    transaction: (work) => db.transaction(work)(),
  });
};

/** A person with an active account, as a demonstration's data would hold them. */
const personWithAccount = (name: string, accessRole = "leader") => {
  const { accounts, organization } = repositories();
  const person = organization.insertPerson({ name, accessRole, role: `${name}'s title` });
  const account = accounts.create({ personId: person.id, status: "active" });
  return { person, account };
};

const designate = (name: string, displayOrder = 0, accessRole = "leader") => {
  const { person, account } = personWithAccount(name, accessRole);
  const identity = repositories().identities.insert({
    personId: person.id,
    kind: "designated",
    displayOrder,
  });
  return { person, account, identity };
};

/** Who the ordinary request path says a session token belongs to. */
const signedInAs = (token: string) =>
  viewerFor(
    new Request("https://demo.example/", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    db,
  )?.person;

const liveSessions = () =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM auth_session WHERE revoked_at IS NULL AND expires_at > ?")
      .get(new Date().toISOString()) as { n: number }
  ).n;

const refusal = (work: () => unknown): ApiError => {
  try {
    work();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("with Demo Mode off, a demonstration's data opens nothing", () => {
  it("offers nothing on the sign-in screen", () => {
    designate("Pilar Ndiaye");
    expect(serviceFor(false).entry()).toEqual({
      demo: false,
      identities: [],
      visitorsWelcome: false,
    });
  });

  it("refuses to enter a designated identity", () => {
    const { identity } = designate("Pilar Ndiaye");
    const error = refusal(() => serviceFor(false).enter({ identityId: identity.id }, {}));
    expect(error.code).toBe("disabled-by-installation");
    expect(liveSessions()).toBe(0);
  });

  it("refuses to create a visitor", () => {
    designate("Pilar Ndiaye");
    const error = refusal(() => serviceFor(false).createVisitor({ name: "Sam" }, {}));
    expect(error.code).toBe("disabled-by-installation");
    expect(repositories().identities.count("visitor")).toBe(0);
  });
});

describe("with Demo Mode on and a database that designates nobody", () => {
  it("offers no identities and no visiting", () => {
    personWithAccount("Real Church Member", "admin");
    expect(serviceFor(true).entry()).toEqual({
      demo: true,
      identities: [],
      visitorsWelcome: false,
    });
  });

  it("will not let anybody in through the demonstration entrance", () => {
    const { person, account } = personWithAccount("Real Church Member", "admin");
    const service = serviceFor(true);

    for (const identityId of [person.id, account.id, "demo-anything"]) {
      expect(refusal(() => service.enter({ identityId }, {})).code).toBe("not-found");
    }
    expect(refusal(() => service.createVisitor({ name: "Sam" }, {})).code).toBe("not-found");
    expect(liveSessions()).toBe(0);
    expect(repositories().organization.people()).toHaveLength(1);
  });
});

describe("with Demo Mode on and designated identities", () => {
  it("offers them in order, with the installation's name for each role", () => {
    designate("Second Offered", 2, "ministry-head");
    designate("First Offered", 1, "admin");

    const entry = serviceFor(true).entry();
    expect(entry.demo).toBe(true);
    expect(entry.visitorsWelcome).toBe(true);
    expect(entry.identities.map((option) => option.name)).toEqual([
      "First Offered",
      "Second Offered",
    ]);
    expect(entry.identities[0]).toMatchObject({
      initials: "FO",
      title: "First Offered's title",
      role: "Admin",
    });
    /* Nothing the screen does not need: no email, account, or person id. */
    expect(Object.keys(entry.identities[0]!).sort()).toEqual([
      "id",
      "initials",
      "name",
      "role",
      "title",
    ]);
  });

  it("opens an ordinary session that the ordinary request path resolves", () => {
    const { person, identity } = designate("Pilar Ndiaye");

    const { token } = serviceFor(true).enter({ identityId: identity.id }, { userAgent: "test" });

    expect(signedInAs(token)?.id).toBe(person.id);
    const event = db
      .prepare("SELECT action, method FROM auth_event ORDER BY at DESC LIMIT 1")
      .get() as { action: string; method: string };
    expect(event).toEqual({ action: "auth.login.success", method: "demo" });
  });

  it("accepts only a designated identity's id — not a person, an account, or a visitor", () => {
    const { person, account } = designate("Pilar Ndiaye");
    const bystander = personWithAccount("Not Offered", "admin");
    const service = serviceFor(true);
    const visitorSession = service.createVisitor({ name: "A Visitor" }, {});
    const visitorIdentity = db
      .prepare("SELECT id FROM demo_identity WHERE kind = 'visitor'")
      .get() as { id: string };
    const before = liveSessions();

    for (const identityId of [
      person.id,
      account.id,
      bystander.person.id,
      bystander.account.id,
      visitorIdentity.id,
      "",
    ]) {
      const error = refusal(() => service.enter({ identityId }, {}));
      expect(["not-found", "validation"]).toContain(error.code);
    }
    expect(liveSessions()).toBe(before);
    expect(signedInAs(visitorSession.token)?.name).toBe("A Visitor");
  });

  it("will not enter an identity whose person or account is not active", () => {
    const deactivated = designate("Deactivated Person");
    repositories().organization.updatePerson(deactivated.person.id, { active: false });
    const suspended = designate("Suspended Account");
    repositories().accounts.update(suspended.account.id, { status: "suspended" });
    const service = serviceFor(true);

    for (const { identity } of [deactivated, suspended]) {
      expect(refusal(() => service.enter({ identityId: identity.id }, {})).code).toBe("not-found");
    }
    expect(service.entry().identities).toEqual([]);
    expect(liveSessions()).toBe(0);
  });

  it("ends the browser's previous session when switching, so sessions do not pile up", () => {
    const first = designate("First Person", 1);
    const second = designate("Second Person", 2);
    const service = serviceFor(true);

    let token = service.enter({ identityId: first.identity.id }, {}).token;
    for (let switches = 0; switches < 5; switches++) {
      const next = switches % 2 === 0 ? second : first;
      const previous = token;
      token = service.enter({ identityId: next.identity.id }, { currentToken: previous }).token;
      expect(signedInAs(previous)).toBeUndefined();
    }

    expect(liveSessions()).toBe(1);
    expect(signedInAs(token)?.id).toBe(second.person.id);
  });
});

describe("trying it as yourself", () => {
  beforeEach(() => {
    designate("Pilar Ndiaye");
  });

  it("makes an ordinary person with no credential, no email and the least privilege", () => {
    const { token } = serviceFor(true).createVisitor({ name: "  Sam   Okafor " }, {});

    const person = signedInAs(token)!;
    expect(person).toMatchObject({ name: "Sam Okafor", accessRole: "leader" });
    expect(repositories().organization.findPerson(person.id)?.email).toBeUndefined();

    const account = repositories().accounts.findByPerson(person.id)!;
    expect(account).toMatchObject({ status: "active" });
    expect(account.email).toBeUndefined();
    const credentials = db
      .prepare("SELECT COUNT(*) AS n FROM account_credential WHERE account_id = ?")
      .get(account.id) as { n: number };
    expect(credentials.n).toBe(0);

    const identity = db
      .prepare("SELECT kind FROM demo_identity WHERE person_id = ?")
      .get(person.id) as { kind: string };
    expect(identity.kind).toBe("visitor");
  });

  it("is not offered to later visitors on the sign-in screen", () => {
    serviceFor(true).createVisitor({ name: "Sam Okafor" }, {});
    expect(
      serviceFor(true)
        .entry()
        .identities.map((option) => option.name),
    ).toEqual(["Pilar Ndiaye"]);
  });

  /* Onboarding is part of what a new visitor should see. */
  it("starts where any new person starts: onboarding", () => {
    const { token } = serviceFor(true).createVisitor({ name: "Sam Okafor" }, {});
    const person = signedInAs(token)!;
    expect(setupRequired(createOnboardingRepository(db).find(person.id))).toBe(true);
  });

  it("cannot sign in any other way", () => {
    const { accounts, organization } = repositories();
    serviceFor(true).createVisitor({ name: "Sam Okafor" }, {});
    const auth = createAuthService(accounts, organization);
    expect(() => auth.signInWithPassword({ email: "", password: "anything at all" })).toThrow(
      ApiError,
    );
    expect(auth.requestMagicLink("").token).toBeUndefined();
  });

  it.each([
    ["an empty name", ""],
    ["only spaces", "    "],
    ["only control characters", String.fromCharCode(0, 7, 27, 127)],
    ["a name longer than the limit", "x".repeat(VISITOR_NAME_MAX + 1)],
  ])("refuses %s", (_label, name) => {
    expect(refusal(() => serviceFor(true).createVisitor({ name }, {})).code).toBe("validation");
    expect(repositories().identities.count("visitor")).toBe(0);
  });

  it("strips control characters and line breaks from a name", () => {
    const { token } = serviceFor(true).createVisitor(
      { name: `Sam\nOkafor${String.fromCharCode(0)} ` },
      {},
    );
    expect(signedInAs(token)?.name).toBe("Sam Okafor");
  });

  it(`stops at ${VISITOR_LIMIT} visitors, and says so rather than failing`, () => {
    const { organization, accounts, identities } = repositories();
    db.transaction(() => {
      for (let n = 1; n < VISITOR_LIMIT; n++) {
        const person = organization.insertPerson({ name: `Visitor ${n}` });
        accounts.create({ personId: person.id, status: "active" });
        identities.insert({ personId: person.id, kind: "visitor" });
      }
    })();
    const service = serviceFor(true);

    expect(service.entry().visitorsWelcome).toBe(true);
    service.createVisitor({ name: "The Last One" }, {});
    expect(service.entry().visitorsWelcome).toBe(false);

    const people = organization.people().length;
    expect(refusal(() => service.createVisitor({ name: "One Too Many" }, {})).code).toBe(
      "conflict",
    );
    expect(organization.people()).toHaveLength(people);
    expect(identities.count("visitor")).toBe(VISITOR_LIMIT);
  });

  it("ends the browser's previous session when a visitor is created", () => {
    const { identity } = designate("Someone Offered", 1);
    const service = serviceFor(true);
    const previous = service.enter({ identityId: identity.id }, {}).token;

    const { token } = service.createVisitor({ name: "Sam Okafor" }, { currentToken: previous });

    expect(signedInAs(previous)).toBeUndefined();
    expect(signedInAs(token)?.name).toBe("Sam Okafor");
    expect(liveSessions()).toBe(1);
  });
});
