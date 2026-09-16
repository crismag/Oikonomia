import { describe, expect, it } from "vitest";

import { addressesIn } from "./invitation";

describe("addresses an administrator pasted", () => {
  it("reads lines, commas, semicolons and angle brackets, once each", () => {
    expect(
      addressesIn("one@example.org\ntwo@example.org, <three@example.org>; ONE@example.org\n\n"),
    ).toEqual(["one@example.org", "two@example.org", "three@example.org"]);
  });

  it("keeps a mistake for the server to name, rather than dropping it", () => {
    expect(addressesIn("not-an-address")).toEqual(["not-an-address"]);
  });
});
