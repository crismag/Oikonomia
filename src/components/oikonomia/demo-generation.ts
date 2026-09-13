/**
 * Which reset of the demonstration this browser last used.
 *
 * Remembered while somebody is exploring, and compared on the sign-in screen:
 * a different number there means the session ended because the demonstration
 * was refreshed, which deserves a sentence, rather than because it expired,
 * which does not. A convenience only — a browser that cannot remember simply
 * says nothing.
 */

const KEY = "oikonomia.demo.generation";

export function rememberedGeneration(): number | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === null || !/^\d+$/.test(value) ? null : Number(value);
  } catch {
    return null;
  }
}

export function rememberGeneration(generation: number): void {
  try {
    window.localStorage.setItem(KEY, String(generation));
  } catch {
    /* Nothing to do: the sign-in screen will just not mention a refresh. */
  }
}

/** Whether the demonstration was refreshed since this browser last explored it. */
export const refreshedSince = (remembered: number | null, current: number | null): boolean =>
  remembered !== null && current !== null && current !== remembered;
