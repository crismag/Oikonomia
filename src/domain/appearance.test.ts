import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPEARANCE,
  areaOfEvent,
  daylight,
  isDark,
  parseAppearance,
  themes,
} from "./appearance";

describe("appearance", () => {
  it("reads a stored choice and refuses anything it does not know", () => {
    expect(parseAppearance('{"theme":"vineyard","mode":"dark"}')).toEqual({
      theme: "vineyard",
      mode: "dark",
    });
    expect(parseAppearance('{"theme":"neon","mode":"sepia"}')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("not json")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("follows the device only when asked to", () => {
    expect(isDark("system", true)).toBe(true);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });

  it("offers each theme once, with the default among them", () => {
    const ids = themes.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_APPEARANCE.theme);
  });

  it("names the light of the day", () => {
    expect([6, 12, 18, 23].map(daylight)).toEqual(["dawn", "day", "dusk", "night"]);
  });

  it("colours an event by what kind it is", () => {
    expect(areaOfEvent({ category: "lifegroup", ministryId: "m-1" })).toBe("life");
    expect(areaOfEvent({ category: "other", ministryId: "m-1" })).toBe("ministry");
    expect(areaOfEvent({ category: "chat" })).toBe("plan");
  });
});
