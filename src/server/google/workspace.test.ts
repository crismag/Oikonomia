import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accessToken,
  checkWorkspace,
  googleRequest,
  mayActAs,
  signServiceAssertion,
  useGoogleTransport,
  workspaceConfig,
  workspaceStatus,
  WORKSPACE_SCOPES,
  type WorkspaceConfig,
} from "./workspace";

/**
 * Google Workspace through domain-wide delegation, without Google.
 *
 * The transport is replaced, so these prove what Oikonomia asks for and what it
 * refuses to ask for — not that a real Workspace answers.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const env = {
  OIKONOMIA_GOOGLE_SA_KEY: JSON.stringify({
    client_email: "oik@proj.iam.gserviceaccount.com",
    private_key: pem,
  }),
  OIKONOMIA_GOOGLE_DOMAIN: "StJohns.org",
  OIKONOMIA_GOOGLE_APP_USER: "office@stjohns.org",
  OIKONOMIA_GOOGLE_CALENDAR_ID: "church@group.calendar.google.com",
};

let calls: { url: string; init: RequestInit }[];
let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, env);
  delete process.env["OIKONOMIA_DEMO_MODE"];
  calls = [];
  useGoogleTransport(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }),
      );
    }
    return new Response(JSON.stringify({ ok: true }));
  });
});

afterEach(() => {
  process.env = saved;
});

const config = () => workspaceConfig()!;

describe("configuration", () => {
  it("reads the key, domain and church mailbox, and names optional features", () => {
    expect(config()).toMatchObject({ domain: "stjohns.org", appUser: "office@stjohns.org" });
    expect(workspaceStatus()).toMatchObject({
      configured: true,
      mail: true,
      calendarPublish: true,
    });
  });

  it("is off in a demonstration, whatever the environment holds", () => {
    process.env["OIKONOMIA_DEMO_MODE"] = "true";
    expect(workspaceConfig()).toBeUndefined();
    expect(workspaceStatus().configured).toBe(false);
  });

  it("says what is wrong without naming a secret", () => {
    process.env["OIKONOMIA_GOOGLE_APP_USER"] = "office@gmail.com";
    const status = workspaceStatus();
    expect(status.configured).toBe(false);
    expect(status.problem).toContain("stjohns.org");
    expect(JSON.stringify(status)).not.toContain("PRIVATE KEY");
  });
});

describe("acting as someone", () => {
  it("signs an assertion Google can verify, naming the subject and scopes", () => {
    const jwt = signServiceAssertion(
      config(),
      "leader@stjohns.org",
      [WORKSPACE_SCOPES.drive],
      1_000,
    );
    const [header, claims, signature] = jwt.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "oik@proj.iam.gserviceaccount.com",
      sub: "leader@stjohns.org",
      scope: WORKSPACE_SCOPES.drive,
      exp: 4_600,
    });
  });

  it("never acts as an address outside the church's domain", async () => {
    expect(mayActAs(config(), "someone@gmail.com")).toBe(false);
    expect(mayActAs(config(), "leader@stjohns.org.evil.com")).toBe(false);
    await expect(
      accessToken(config(), "someone@gmail.com", [WORKSPACE_SCOPES.drive]),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(calls).toEqual([]);
  });

  it("reuses a token until shortly before it expires", async () => {
    await accessToken(config(), "leader@stjohns.org", [WORKSPACE_SCOPES.drive]);
    await accessToken(config(), "Leader@StJohns.org", [WORKSPACE_SCOPES.drive]);
    expect(calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
  });

  it("calls an API with the token and turns refusals into calm errors", async () => {
    await googleRequest(config(), {
      subject: "leader@stjohns.org",
      scopes: [WORKSPACE_SCOPES.drive],
      url: "https://www.googleapis.com/drive/v3/files",
    });
    const api = calls.at(-1)!;
    expect((api.init.headers as Record<string, string>)["authorization"]).toMatch(/^Bearer tok-/);

    useGoogleTransport(async (url) =>
      url.includes("/token")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response("denied", { status: 403 }),
    );
    await expect(
      googleRequest(config(), {
        subject: "leader@stjohns.org",
        scopes: [WORKSPACE_SCOPES.drive],
        url: "https://www.googleapis.com/drive/v3/files",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("checks each scope for the church mailbox without sending anything", async () => {
    const results = await checkWorkspace();
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls.every((c) => c.url.includes("/token"))).toBe(true);
  });
});
