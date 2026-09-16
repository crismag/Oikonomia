import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  isDark,
  parseAppearance,
  type Appearance,
} from "@/domain/appearance";

/**
 * The viewer's theme and mode, kept in this browser.
 *
 * A convenience, so storage failing (a private window, blocked site data)
 * simply leaves the default in place. Every tab follows a change made in
 * another, and "system" follows the device as it switches.
 */

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: Appearance } | null = null;

function read(): Appearance {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(APPEARANCE_KEY);
  } catch {
    raw = null;
  }
  if (!cached || cached.raw !== raw) cached = { raw, value: parseAppearance(raw) };
  return cached.value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Put a choice on the document: the theme attribute, the dark class, native controls. */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const dark = isDark(appearance.mode, window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", appearance.theme);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, read, () => DEFAULT_APPEARANCE);

  /* "System" is a live answer: follow the device when it changes. */
  useEffect(() => {
    applyAppearance(appearance);
    if (appearance.mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyAppearance(appearance);
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [appearance]);

  const setAppearance = useCallback((next: Partial<Appearance>) => {
    const value = { ...read(), ...next };
    try {
      window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value));
    } catch {
      /* Not kept, but still shown for this visit. */
    }
    cached = null;
    applyAppearance(value);
    listeners.forEach((listener) => listener());
  }, []);

  return { appearance, setAppearance };
}
