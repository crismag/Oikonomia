import { describe, expect, it } from "vitest";

import { refreshedSince } from "./demo-generation";

describe("telling a refreshed demonstration from an expired session", () => {
  it("is a refresh when the demonstration has been reset since this browser explored it", () => {
    expect(refreshedSince(3, 4)).toBe(true);
  });

  it("is not a refresh when the generation is the one this browser used", () => {
    expect(refreshedSince(4, 4)).toBe(false);
  });

  it("says nothing when this browser never explored, or the server reports no count", () => {
    expect(refreshedSince(null, 4)).toBe(false);
    expect(refreshedSince(4, null)).toBe(false);
  });
});
