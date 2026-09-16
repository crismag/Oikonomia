import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_FUNCTIONS } from "./operations";
import {
  InstallationConfigurationError,
  MAINTENANCE_TASKS,
  assertDeploymentProfile,
  currentInstallation,
  decideRouteRequest,
  decideServerFunction,
  installationView,
  parseDemoMode,
  parseRequireDemoMode,
  refusal,
} from "./policy";

/**
 * The installation policy.
 *
 * What these tests hold: an environment setting is the only switch; with it
 * off nothing is refused; with it on the dangerous operations are refused,
 * church work is not, and anything nobody decided about is refused too.
 */

const OFF = { demoMode: false };
const ON = { demoMode: true };

const fn = (key: string) => {
  const [filename, name] = key.split("#") as [string, string];
  return { filename, name };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reading OIKONOMIA_DEMO_MODE", () => {
  it("is off when unset", () => {
    expect(parseDemoMode(undefined)).toBe(false);
  });

  it('is on only for exactly "true", and off for exactly "false"', () => {
    expect(parseDemoMode("true")).toBe(true);
    expect(parseDemoMode("false")).toBe(false);
  });

  it.each(["1", "0", "yes", "no", "TRUE", "True", " true", "true ", "", "on"])(
    "refuses %j rather than guessing",
    (value) => {
      expect(() => parseDemoMode(value)).toThrow(InstallationConfigurationError);
      expect(() => parseDemoMode(value)).toThrow(/OIKONOMIA_DEMO_MODE/);
    },
  );

  it("is read from the process environment", () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    expect(currentInstallation()).toEqual({ demoMode: true });
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "maybe");
    expect(() => currentInstallation()).toThrow(InstallationConfigurationError);
  });
});

/**
 * A deployment pinned to always be a demonstration — oikosdemo.crishub.com's
 * own configuration, never derived from its hostname or a request: only from
 * the private environment file this reads.
 */
describe("OIKONOMIA_REQUIRE_DEMO_MODE", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oikonomia-require-demo-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /* Built fresh per test, after beforeEach has set `dir` — a module-level
     object would resolve its paths against an empty `dir` at collection time.
     NODE_ENV: production, so liveDatabasePath never falls back to a
     development default; the profile is checked exactly as it would run. */
  const valid = () => ({
    NODE_ENV: "production",
    OIKONOMIA_REQUIRE_DEMO_MODE: "true",
    OIKONOMIA_DEMO_MODE: "true",
    OIKONOMIA_DB: join(dir, "oikonomia.db"),
    OIKONOMIA_DEMO_DB: join(dir, "oikonomia-demo.db"),
    OIKONOMIA_DEMO_BASELINE: join(dir, "oikonomia-demo-baseline.db"),
  });

  it("reads unset as false, and refuses anything but true/false", () => {
    expect(parseRequireDemoMode(undefined)).toBe(false);
    expect(parseRequireDemoMode("true")).toBe(true);
    expect(parseRequireDemoMode("false")).toBe(false);
    expect(() => parseRequireDemoMode("yes")).toThrow(InstallationConfigurationError);
    expect(() => parseRequireDemoMode("yes")).toThrow(/OIKONOMIA_REQUIRE_DEMO_MODE/);
  });

  it("imposes nothing when unset or false, whatever else is configured", () => {
    expect(() => assertDeploymentProfile({})).not.toThrow();
    expect(() =>
      assertDeploymentProfile({
        OIKONOMIA_REQUIRE_DEMO_MODE: "false",
        OIKONOMIA_DEMO_MODE: "false",
      }),
    ).not.toThrow();
  });

  it("passes a fully and correctly configured demonstration", () => {
    expect(() => assertDeploymentProfile(valid())).not.toThrow();
  });

  it("refuses when Demo Mode itself is off", () => {
    expect(() => assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_MODE: "false" })).toThrow(
      /OIKONOMIA_DEMO_MODE=true/,
    );
    expect(() => assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_MODE: undefined })).toThrow(
      InstallationConfigurationError,
    );
  });

  it("refuses when the baseline is not configured", () => {
    expect(() =>
      assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_BASELINE: undefined }),
    ).toThrow(/OIKONOMIA_DEMO_BASELINE/);
    expect(() => assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_BASELINE: "  " })).toThrow(
      InstallationConfigurationError,
    );
  });

  it("refuses when the demonstration's own database is not configured — no fallback to OIKONOMIA_DB", () => {
    expect(() => assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_DB: undefined })).toThrow(
      /OIKONOMIA_REQUIRE_DEMO_MODE=true: OIKONOMIA_DEMO_DB/,
    );
  });

  it("refuses when the demonstration's database is the ordinary database", () => {
    expect(() =>
      assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_DB: valid().OIKONOMIA_DB }),
    ).toThrow(/same file as OIKONOMIA_DB/);
  });

  it("refuses when the demonstration's database is its own baseline", () => {
    expect(() =>
      assertDeploymentProfile({ ...valid(), OIKONOMIA_DEMO_DB: valid().OIKONOMIA_DEMO_BASELINE }),
    ).toThrow(/same file as OIKONOMIA_DEMO_BASELINE/);
  });

  it("refuses a malformed OIKONOMIA_REQUIRE_DEMO_MODE before checking anything else", () => {
    expect(() =>
      assertDeploymentProfile({ ...valid(), OIKONOMIA_REQUIRE_DEMO_MODE: "enabled" }),
    ).toThrow(/OIKONOMIA_REQUIRE_DEMO_MODE must be/);
  });
});

describe("with Demo Mode off", () => {
  it("allows every classified server function, denied ones included", () => {
    for (const [key, policy] of Object.entries(SERVER_FUNCTIONS)) {
      expect(decideServerFunction(OFF, fn(key), policy.method)).toEqual({ allowed: true });
    }
  });

  it("allows even a write nobody classified", () => {
    expect(
      decideServerFunction(
        OFF,
        { filename: "src/lib/new-api.ts", name: "deleteEverything" },
        "POST",
      ),
    ).toEqual({ allowed: true });
  });

  it("allows every route handler and maintenance task", () => {
    for (const path of ["/auth/google/start", "/auth/google/callback", "/healthz"]) {
      expect(decideRouteRequest(OFF, new URL(`http://x${path}`))).toEqual({ allowed: true });
    }
    for (const task of [...Object.keys(MAINTENANCE_TASKS), "", "nonsense"]) {
      expect(decideRouteRequest(OFF, new URL(`http://x/maintenance/run?task=${task}`))).toEqual({
        allowed: true,
      });
    }
  });
});

describe("with Demo Mode on", () => {
  it.each([
    ["src/lib/auth-api.ts#signInWithPassword", "authentication"],
    ["src/lib/auth-api.ts#requestMagicLink", "authentication"],
    ["src/lib/auth-api.ts#signInWithMagicLink", "authentication"],
    ["src/lib/auth-api.ts#requestPasswordReset", "authentication"],
    ["src/lib/auth-api.ts#resetPassword", "authentication"],
    ["src/lib/auth-api.ts#changePassword", "authentication"],
    ["src/lib/auth-api.ts#claimFirstAccount", "authentication"],
    ["src/lib/auth-api.ts#inviteToOikonomia", "authentication"],
    ["src/lib/auth-api.ts#inviteManyToOikonomia", "authentication"],
    ["src/lib/auth-api.ts#signOutSession", "sessions"],
    ["src/lib/auth-api.ts#signOutOtherSessions", "sessions"],
    ["src/lib/organization-api.ts#addPerson", "identity"],
    ["src/lib/organization-api.ts#updatePerson", "identity"],
    ["src/lib/organization-api.ts#claimFirstPerson", "identity"],
    ["src/lib/onboarding-api.ts#giveOwnName", "identity"],
    ["src/lib/configuration-api.ts#addConfigurationOption", "configuration"],
    ["src/lib/configuration-api.ts#setConfigurationOption", "configuration"],
    ["src/lib/configuration-api.ts#setConfigurationValue", "configuration"],
    ["src/lib/configuration-api.ts#resetConfiguration", "configuration"],
    ["src/lib/data-management-api.ts#runBackup", "data"],
    ["src/lib/data-management-api.ts#verifyBackup", "data"],
    ["src/lib/data-management-api.ts#runExport", "data"],
    ["src/lib/data-management-api.ts#downloadExport", "data"],
    ["src/lib/data-management-api.ts#validatePackage", "data"],
    ["src/lib/data-management-api.ts#runRetention", "data"],
    ["src/lib/data-management-api.ts#setRetentionPolicy", "data"],
    ["src/lib/workspace-api.ts#checkWorkspaceConnection", "integrations"],
  ])("refuses %s", (key, because) => {
    const method = SERVER_FUNCTIONS[key]!.method;
    expect(decideServerFunction(ON, fn(key), method)).toEqual({ allowed: false, because });
  });

  it("refuses exactly those 27 and nothing else that is classified", () => {
    const refused = Object.entries(SERVER_FUNCTIONS)
      .filter(([key, policy]) => !decideServerFunction(ON, fn(key), policy.method).allowed)
      .map(([key]) => key);
    expect(refused).toHaveLength(27);
  });

  it.each([
    "src/lib/goals-api.ts#createGoal",
    "src/lib/meeting-api.ts#updateNote",
    "src/lib/lifegroup-api.ts#markAttendance",
    "src/lib/reach-out-api.ts#createReachOutReport",
    "src/lib/reports-api.ts#writeReport",
    "src/lib/documents-api.ts#saveBinderDocument",
    "src/lib/calendar-api.ts#createCalendarEntry",
    "src/lib/escalation-api.ts#markRead",
    "src/lib/onboarding-api.ts#completeOnboarding",
    "src/lib/organization-api.ts#setMembership",
    "src/lib/organization-api.ts#setGroupMembership",
    "src/lib/organization-api.ts#setAssignment",
    "src/lib/organization-api.ts#claimAssignment",
    "src/lib/organization-api.ts#addMinistry",
    "src/lib/organization-api.ts#addVenue",
    "src/lib/auth-api.ts#signOut",
  ])("leaves church work and this browser's sign-out to ordinary authorization: %s", (key) => {
    expect(decideServerFunction(ON, fn(key), "POST")).toEqual({ allowed: true });
  });

  it("leaves reads available", () => {
    for (const [key, policy] of Object.entries(SERVER_FUNCTIONS)) {
      if (policy.demo === "read") {
        expect(decideServerFunction(ON, fn(key), "GET")).toEqual({ allowed: true });
      }
    }
  });

  /* The invariant that outlives this slice: a mutation added later, and never
     classified, does not reach a public demonstration. */
  it("refuses a POST that nobody classified", () => {
    expect(
      decideServerFunction(
        ON,
        { filename: "src/lib/new-api.ts", name: "changeEverything" },
        "POST",
      ),
    ).toEqual({ allowed: false, because: "unclassified" });
    expect(
      decideServerFunction(
        ON,
        { filename: "src/lib/auth-api.ts", name: "signOutEveryone" },
        "post",
      ),
    ).toEqual({ allowed: false, because: "unclassified" });
  });

  it("allows a GET that nobody classified", () => {
    expect(
      decideServerFunction(ON, { filename: "src/lib/new-api.ts", name: "fetchThings" }, "GET"),
    ).toEqual({ allowed: true });
  });

  it("recognises a function however the build reported its path", () => {
    const absolute = { filename: "/srv/app/src/lib/auth-api.ts", name: "resetPassword" };
    const windows = { filename: "C:\\app\\src\\lib\\auth-api.ts", name: "resetPassword" };
    expect(decideServerFunction(ON, absolute, "POST").allowed).toBe(false);
    expect(decideServerFunction(ON, windows, "POST").allowed).toBe(false);
    expect(
      decideServerFunction(
        ON,
        { filename: "/srv/app/src/lib/goals-api.ts", name: "createGoal" },
        "POST",
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses Google sign-in at both ends", () => {
    expect(decideRouteRequest(ON, new URL("http://x/auth/google/start"))).toEqual({
      allowed: false,
      because: "authentication",
    });
    expect(decideRouteRequest(ON, new URL("http://x/auth/google/callback/?code=abc"))).toEqual({
      allowed: false,
      because: "authentication",
    });
  });

  it("keeps the health check and ordinary pages", () => {
    for (const path of ["/healthz", "/", "/login", "/people", "/administration"]) {
      expect(decideRouteRequest(ON, new URL(`http://x${path}`))).toEqual({ allowed: true });
    }
  });

  it("refuses every maintenance task but its own reset, and any task that does not exist", () => {
    expect(Object.keys(MAINTENANCE_TASKS).sort()).toEqual([
      "backup",
      "demo-reset",
      "retention",
      "sweep",
    ]);
    for (const task of ["backup", "retention", "sweep"]) {
      expect(decideRouteRequest(ON, new URL(`http://x/maintenance/run?task=${task}`)).allowed).toBe(
        false,
      );
    }
    /* Allowed past the policy only; the token and the reset's own checks still decide. */
    expect(decideRouteRequest(ON, new URL("http://x/maintenance/run?task=demo-reset"))).toEqual({
      allowed: true,
    });
    for (const query of [
      "",
      "?task=",
      "?task=reset-everything",
      "?task=BACKUP",
      "?task=DEMO-RESET",
      "?task=demo-reset%20",
    ]) {
      expect(decideRouteRequest(ON, new URL(`http://x/maintenance/run${query}`))).toEqual({
        allowed: false,
        because: "unclassified",
      });
    }
  });
});

describe("what the browser is told", () => {
  it("is nothing on an ordinary installation", () => {
    expect(installationView(OFF)).toEqual({ demo: false, restricted: [] });
  });

  it("is exactly the reasons operations are denied for, in Demo Mode", () => {
    const denied = new Set(
      Object.values(SERVER_FUNCTIONS)
        .filter((policy) => policy.demo === "denied")
        .map((policy) => policy.because),
    );
    expect(installationView(ON)).toEqual({ demo: true, restricted: [...denied].sort() });
    expect(installationView(ON).restricted).toEqual([
      "authentication",
      "configuration",
      "data",
      "identity",
      "integrations",
      "sessions",
    ]);
  });

  it("carries nothing but the flag and the reasons", () => {
    expect(Object.keys(installationView(ON)).sort()).toEqual(["demo", "restricted"]);
  });
});

describe("the refusal", () => {
  it("is the ordinary error envelope, with its own code and a sentence for a person", () => {
    expect(refusal()).toEqual({
      code: "disabled-by-installation",
      message: "This action is disabled in this installation.",
    });
    expect(refusal().message).not.toMatch(/OIKONOMIA|DEMO_MODE|env/i);
  });
});
