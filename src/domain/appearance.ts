/**
 * How Oikonomia looks, as this person chose it on this browser.
 *
 * Appearance is a per-viewer convenience, not a church setting: two leaders
 * sharing an installation may want different themes, and nothing about what
 * anyone may see or do depends on it. So it lives in the browser, and the
 * server never reads it.
 *
 * A **theme** is a whole identity — palette, typefaces, the colour of each area
 * of work. A **mode** is light, dark, or whatever the device prefers.
 */

export const themes = [
  {
    id: "glass",
    label: "Stained glass",
    description: "Jewel colours on a bright page, with a deep indigo sidebar.",
    swatches: ["#2B2566", "#3E63DD", "#E0A020", "#D6457A", "#1E9E77"],
  },
  {
    id: "vineyard",
    label: "Vineyard",
    description: "Olive, wheat and plum — warm, earthy and calm.",
    swatches: ["#2F3B25", "#5C7A34", "#D9A93F", "#8A3F66", "#5F87A8"],
  },
  {
    id: "daybreak",
    label: "Daybreak",
    description: "Bright and friendly, with soft tints and a vivid blue-violet.",
    swatches: ["#FFFFFF", "#5B5BF0", "#F59E0B", "#EC4899", "#10B981"],
  },
  {
    id: "quiet",
    label: "Quiet",
    description: "The original: slate, one teal accent, and little colour.",
    swatches: ["#F6F8FA", "#2F6670", "#7A8595", "#B7791F", "#3C7D5B"],
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export type Mode = "light" | "dark" | "system";

export interface Appearance {
  theme: ThemeId;
  mode: Mode;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "glass", mode: "system" };

/** Where the choice is kept. Also read by the inline script in the document head. */
export const APPEARANCE_KEY = "oikonomia.appearance";

const isTheme = (value: unknown): value is ThemeId => themes.some((theme) => theme.id === value);
const isMode = (value: unknown): value is Mode =>
  value === "light" || value === "dark" || value === "system";

/** Whatever was stored, made safe: anything unrecognised falls back to the default. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const value = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
      mode: isMode(value.mode) ? value.mode : DEFAULT_APPEARANCE.mode,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Whether the page should be dark, given the choice and the device. */
export function isDark(mode: Mode, prefersDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && prefersDark);
}

/**
 * Applied before the first paint, so a dark or themed page never flashes the
 * default first. Kept dependency-free because it is inlined as a string.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||"{}");var t=${JSON.stringify(themes.map((theme) => theme.id))}.indexOf(a.theme)>=0?a.theme:"glass";var m=a.mode==="light"||a.mode==="dark"?a.mode:"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.setAttribute("data-theme",t);r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){document.documentElement.setAttribute("data-theme","glass");}})();`;

/* ------------------------------------------------------------------ areas */

/**
 * The areas of work, each with its own colour in every theme.
 *
 * Colour here is wayfinding — which part of the binder you are in — and never
 * the only carrier of meaning: every coloured element also has its words.
 */
export const areas = [
  "home",
  "plan",
  "meet",
  "reach",
  "reports",
  "goals",
  "life",
  "ministry",
  "library",
  "lead",
  "journal",
  "org",
] as const;

export type AreaId = (typeof areas)[number];

/**
 * Which area's colour an event on the calendar wears.
 *
 * Wayfinding only: a LifeGroup evening and a ministry meeting look different
 * at a glance on a crowded week. Nothing is decided by it.
 */
export function areaOfEvent(entry: { category: string; ministryId?: string | undefined }): AreaId {
  if (entry.category === "lifegroup") return "life";
  if (entry.category === "mentorship") return "goals";
  if (entry.category === "prayer-fasting") return "reports";
  if (entry.category === "service" || entry.category === "celebration") return "reach";
  if (entry.ministryId || entry.category === "ministry-meeting") return "ministry";
  return "plan";
}

/** The time of day, for the light behind Home's greeting. */
export function daylight(hour: number): "dawn" | "day" | "dusk" | "night" {
  if (hour >= 5 && hour < 10) return "dawn";
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "dusk";
  return "night";
}
