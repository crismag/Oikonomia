/**
 * What a browser keeps track of in a shared, periodically reset demonstration.
 *
 * Everything here is a decision the header or the sign-in screen asks about,
 * kept out of the components so it can be tested without a browser. The server
 * stays the authority on when the next reset is, how many sessions are active,
 * and whether this browser still has a session; this only remembers what this
 * browser has already seen or said.
 */

/** How often the demonstration's status is asked for again. */
export const DEMO_STATUS_POLL_MS = 60_000;

/** How long before a reset the visitor is warned. */
export const RESET_WARNING_MS = 10 * 60_000;

/* ------------------------------------------------------------ generation */

const GENERATION_KEY = "oikonomia.demo.generation";

/**
 * Which reset of the demonstration this browser last explored.
 *
 * Remembered while somebody is signed in, and compared on the sign-in screen:
 * a different number there means the session ended because the demonstration
 * was refreshed, which deserves a sentence, rather than because it expired,
 * which does not. A convenience only — a browser that cannot remember simply
 * says nothing.
 */
export function rememberedGeneration(): number | null {
  try {
    const value = window.localStorage.getItem(GENERATION_KEY);
    return value === null || !/^\d+$/.test(value) ? null : Number(value);
  } catch {
    return null;
  }
}

export function rememberGeneration(generation: number): void {
  try {
    window.localStorage.setItem(GENERATION_KEY, String(generation));
  } catch {
    /* Nothing to do: the sign-in screen will just not mention a refresh. */
  }
}

/** Whether the demonstration was refreshed since this browser last explored it. */
export const refreshedSince = (remembered: number | null, current: number | null): boolean =>
  remembered !== null && current !== null && current !== remembered;

/* ------------------------------------------------------- session ending */

/**
 * Whether the page is showing somebody whose session the server no longer
 * recognises.
 *
 * After a reset every session is gone, and the next status poll says so. The
 * page then goes to the sign-in screen — once — which tells the visitor why.
 * An unanswered poll is not an answer: only a status that actually arrived and
 * says "not signed in" counts.
 */
export const sessionEnded = (
  pageHasViewer: boolean,
  status: { signedIn: boolean } | undefined,
): boolean => pageHasViewer && status !== undefined && !status.signedIn;

/* --------------------------------------------------------- reset warning */

const WARNED_KEY = "oikonomia.demo.reset-warned";

/** The reset this tab has already been warned about, if any. */
export function warnedFor(): string | null {
  try {
    return window.sessionStorage.getItem(WARNED_KEY);
  } catch {
    return null;
  }
}

export function rememberWarning(resetAt: string): void {
  try {
    window.sessionStorage.setItem(WARNED_KEY, resetAt);
  } catch {
    /* A tab that cannot remember may be warned again after a reload. */
  }
}

/**
 * Whether to warn now about the reset at `resetAt`.
 *
 * Inside the last ten minutes, and not already warned about this reset. The
 * next reset has a different time, so it is warned about in its turn.
 */
export function resetWarningDue(resetAt: string, nowMs: number, warned: string | null): boolean {
  const remaining = Date.parse(resetAt) - nowMs;
  return remaining > 0 && remaining <= RESET_WARNING_MS && warned !== resetAt;
}

/** "about 10 minutes", in whole minutes, never "about 0". */
export const minutesUntil = (resetAt: string, nowMs: number): number =>
  Math.max(1, Math.ceil((Date.parse(resetAt) - nowMs) / 60_000));
