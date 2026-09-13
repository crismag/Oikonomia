import { afterEach, describe, expect, it, vi } from "vitest";

import { installationFunctionMiddleware, installationRequestMiddleware } from "./start";

/**
 * The installation policy as the running application applies it.
 *
 * `policy.test.ts` proves the decisions. These prove the wiring: the
 * middleware TanStack Start runs before every server function and every route
 * handler consults them, refuses in the envelope callers already understand,
 * and otherwise steps aside — without ever looking at who is signed in.
 */

type Server = (context: Record<string, unknown>) => Promise<unknown>;
const serverOf = (middleware: unknown): Server =>
  (middleware as { options: { server: Server } }).options.server;

const callFunction = async (
  filename: string,
  name: string,
  method: "GET" | "POST",
  headers: Record<string, string> = {},
) => {
  const next = vi.fn(async () => ({ result: { data: "the operation ran" } }));
  const outcome = (await serverOf(installationFunctionMiddleware)({
    serverFnMeta: { id: "x", filename, name },
    method,
    data: {},
    context: {},
    request: new Request("http://oikonomia.example/_serverFn/x", { method, headers }),
    next,
  })) as { result?: unknown };
  return { next, outcome };
};

const callRoute = async (url: string, handlerType: "router" | "serverFn" = "router") => {
  const next = vi.fn(async () => new Response("the handler ran"));
  const outcome = await serverOf(installationRequestMiddleware)({
    request: new Request(url),
    pathname: new URL(url).pathname,
    handlerType,
    context: {},
    next,
  });
  return { next, outcome };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server functions", () => {
  it("run untouched when Demo Mode is off", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
    const { next } = await callFunction(
      "src/lib/configuration-api.ts",
      "setConfigurationValue",
      "POST",
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("run untouched when OIKONOMIA_DEMO_MODE is unset", async () => {
    delete process.env["OIKONOMIA_DEMO_MODE"];
    const { next } = await callFunction("src/lib/auth-api.ts", "resetPassword", "POST");
    expect(next).toHaveBeenCalledOnce();
  });

  it("are refused in the ordinary envelope when denied, and never run", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next, outcome } = await callFunction(
      "src/lib/data-management-api.ts",
      "runBackup",
      "POST",
    );
    expect(next).not.toHaveBeenCalled();
    expect(outcome.result).toEqual({
      error: {
        code: "disabled-by-installation",
        message: "This action is disabled in this installation.",
      },
    });
  });

  /* The middleware has no notion of a person: a session cookie belonging to
     an administrator changes nothing, because nothing here reads it. */
  it("are refused whoever is signed in", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next, outcome } = await callFunction(
      "src/lib/configuration-api.ts",
      "setConfigurationOption",
      "POST",
      { cookie: "oikonomia_session=an-administrator-session" },
    );
    expect(next).not.toHaveBeenCalled();
    expect(outcome.result).toMatchObject({ error: { code: "disabled-by-installation" } });
  });

  it("reach ordinary authorization when they are church work", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next, outcome } = await callFunction("src/lib/goals-api.ts", "createGoal", "POST");
    expect(next).toHaveBeenCalledOnce();
    expect(outcome.result).toEqual({ data: "the operation ran" });
  });

  it("are refused when nobody classified them and they write", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next, outcome } = await callFunction(
      "src/lib/brand-new-api.ts",
      "changeSomething",
      "POST",
    );
    expect(next).not.toHaveBeenCalled();
    expect(outcome.result).toMatchObject({ error: { code: "disabled-by-installation" } });
  });

  it("stay available when they only read", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next } = await callFunction("src/lib/organization-api.ts", "fetchSession", "GET");
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("route handlers", () => {
  it("run untouched when Demo Mode is off", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
    const { next } = await callRoute("http://x/auth/google/start");
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuse Google sign-in when Demo Mode is on", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    for (const url of [
      "http://x/auth/google/start",
      "http://x/auth/google/callback?code=c&state=s",
    ]) {
      const { next, outcome } = await callRoute(url);
      expect(next).not.toHaveBeenCalled();
      expect((outcome as Response).status).toBe(403);
      expect(await (outcome as Response).json()).toMatchObject({
        error: { code: "disabled-by-installation" },
      });
    }
  });

  it("refuse maintenance tasks when Demo Mode is on, before the token is even checked", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    for (const task of ["backup", "retention", "sweep", "anything"]) {
      const { next, outcome } = await callRoute(`http://x/maintenance/run?task=${task}`);
      expect(next).not.toHaveBeenCalled();
      expect((outcome as Response).status).toBe(403);
    }
  });

  it("keep the health check and pages", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    for (const url of ["http://x/healthz", "http://x/login", "http://x/administration"]) {
      const { next } = await callRoute(url);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("leave server-function requests to the function middleware", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    const { next } = await callRoute("http://x/_serverFn/abc", "serverFn");
    expect(next).toHaveBeenCalledOnce();
  });
});
