import { describe, expect, it } from "vitest";

import { browserShouldApply } from "./organization-provider";

/**
 * Configuration crossing between the server's copy and the browser's.
 *
 * The registry is a module-level singleton. On the server that one object is
 * shared by every request in the process, and this provider renders there as
 * well as in the browser — so a render-time write from the browser's side of
 * the application can wipe what a request has just applied for itself.
 *
 * That is not hypothetical: it happened. A configured access role resolved
 * correctly in every server-side call except the one that built the session
 * snapshot, because server rendering had handed the registry an empty list a
 * moment earlier. The symptom was a role the church had defined displaying as
 * the least privileged one.
 */
describe("who may hand overrides to the registry", () => {
  it("lets the browser apply what the session carried", () => {
    expect(browserShouldApply(true, [{ namespace: "reports.statuses" }])).toBe(true);
  });

  /* An empty list is a legitimate state — a church that has configured
     nothing — and applying it from the browser is correct. */
  it("lets the browser apply an empty list once it has one", () => {
    expect(browserShouldApply(true, [])).toBe(true);
  });

  it("refuses while nothing has loaded, because that would clear what is in force", () => {
    expect(browserShouldApply(true, undefined)).toBe(false);
    expect(browserShouldApply(true, null)).toBe(false);
  });

  /* The one that matters: the server applies its own, per request. */
  it("refuses during server rendering, whatever it was given", () => {
    expect(browserShouldApply(false, [{ namespace: "reports.statuses" }])).toBe(false);
    expect(browserShouldApply(false, [])).toBe(false);
    expect(browserShouldApply(false, undefined)).toBe(false);
  });
});
