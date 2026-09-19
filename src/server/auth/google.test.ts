import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as callbackRoute } from "@/routes/auth.google.callback";
import { Route as startRoute } from "@/routes/auth.google.start";
import { STATE_COOKIE } from "./oauth-state";
import { exchange, googleConfig, googleConfigured, mayCompleteSignIn, startUrl } from "./google";

/**
 * Google sign-in in a public demonstration: not started, not completed, and
 * Google never contacted.
 *
 * The routes are refused by the installation policy before their handlers run.
 * These tests go underneath that — the provider itself and the route handlers
 * called directly — with real-looking credentials left in the environment, and
 * `fetch` watched so a token exchange could not happen unnoticed.
 */

type Handler = (context: { request: Request }) => Promise<Response>;
const handlerOf = (route: unknown): Handler =>
  (route as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers.GET;

const tokenExchange = vi.fn(async () => new Response(JSON.stringify({ id_token: "x.e30.x" })));

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "a-real-looking-secret");
  vi.stubEnv("OIKONOMIA_URL", "https://oikonomia.example");
  vi.stubGlobal("fetch", tokenExchange);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  tokenExchange.mockClear();
});

const callbackRequest = () =>
  new Request("https://oikonomia.example/auth/google/callback?code=an-auth-code&state=s1", {
    headers: { cookie: `${STATE_COOKIE}=s1` },
  });

describe("with Demo Mode off, Google sign-in works as before", () => {
  beforeEach(() => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
  });

  it("is configured and offers a start URL", () => {
    expect(googleConfig()).toBeDefined();
    expect(googleConfigured()).toBe(true);
    expect(startUrl()?.url).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("starts by redirecting to Google", async () => {
    const response = await handlerOf(startRoute)({
      request: new Request("https://oikonomia.example/auth/google/start"),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  /* The comparison that makes the Demo Mode assertion meaningful: this harness
     does see the exchange when it happens. */
  it("exchanges the code with Google on the way back", async () => {
    await exchange("an-auth-code").catch(() => undefined);
    expect(tokenExchange).toHaveBeenCalledOnce();
    expect(String((tokenExchange.mock.calls[0] as unknown[])[0])).toContain(
      "oauth2.googleapis.com",
    );
  });
});

describe("with Demo Mode on, Google sign-in cannot happen", () => {
  beforeEach(() => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
  });

  it("reports Google as unconfigured despite the credentials, and offers no start URL", () => {
    expect(googleConfig()).toBeUndefined();
    expect(googleConfigured()).toBe(false);
    expect(startUrl()).toBeUndefined();
  });

  it("does not send the browser to Google even if the start handler is reached", async () => {
    const response = await handlerOf(startRoute)({
      request: new Request("https://oikonomia.example/auth/google/start"),
    });
    expect(response.headers.get("location") ?? "").not.toMatch(/google\.com/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses to exchange a code, without contacting Google", async () => {
    await expect(exchange("an-auth-code")).rejects.toThrow();
    expect(tokenExchange).not.toHaveBeenCalled();
  });

  it("does not complete a sign-in even if the callback handler is reached with a valid state", async () => {
    const response = await handlerOf(callbackRoute)({ request: callbackRequest() });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^\/login/);
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(/oikonomia_session=/);
    expect(tokenExchange).not.toHaveBeenCalled();
  });
});

/**
 * The one way a demonstration does offer Google: the operator names the
 * addresses that may use it, to try the deployed journey. Everything else
 * about a demonstration is unchanged, and a named address is not an account.
 */
describe("with Demo Mode on and testers named", () => {
  beforeEach(() => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    vi.stubEnv("OIKONOMIA_DEMO_GOOGLE_TESTERS", "Tester@example.com");
  });

  it("offers Google, and a start URL that goes to Google", () => {
    expect(googleConfigured()).toBe(true);
    expect(startUrl()?.url).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("admits a named address however it is cased, and no other", () => {
    expect(mayCompleteSignIn("tester@example.com")).toBe(true);
    expect(mayCompleteSignIn(" TESTER@example.com ")).toBe(true);
    expect(mayCompleteSignIn("somebody@example.com")).toBe(false);
  });

  it("still refuses an address nobody named, at the callback", async () => {
    const response = await handlerOf(callbackRoute)({ request: callbackRequest() });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^\/login/);
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(/oikonomia_session=/);
  });
});
