import { afterEach, describe, expect, it } from "vitest";

import { siteUrl, siteUrlConfigured } from "./site-url";

const original = process.env["OIKONOMIA_URL"];
const originalNode = process.env["NODE_ENV"];

afterEach(() => {
  if (original === undefined) delete process.env["OIKONOMIA_URL"];
  else process.env["OIKONOMIA_URL"] = original;
  if (originalNode === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = originalNode;
});

describe("the address this installation answers on", () => {
  it("uses what is configured, without a trailing slash", () => {
    process.env["OIKONOMIA_URL"] = "https://oikonomia.example.org///";
    expect(siteUrl()).toBe("https://oikonomia.example.org");
  });

  it("assumes local development when nothing is configured", () => {
    delete process.env["OIKONOMIA_URL"];
    process.env["NODE_ENV"] = "development";
    expect(siteUrl()).toBe("http://localhost:8080");
  });

  /* The finding this file exists for: a production installation that has not
     been told its address used to build sign-in links naming localhost. */
  it("refuses to guess in production rather than mailing a localhost link", () => {
    delete process.env["OIKONOMIA_URL"];
    process.env["NODE_ENV"] = "production";

    expect(() => siteUrl()).toThrow(/OIKONOMIA_URL/);
    expect(siteUrlConfigured()).toBe(false);
  });

  it("treats an empty or blank value as unset", () => {
    process.env["NODE_ENV"] = "production";
    for (const blank of ["", "   "]) {
      process.env["OIKONOMIA_URL"] = blank;
      expect(() => siteUrl(), JSON.stringify(blank)).toThrow();
    }
  });
});
