import type { Database as Db } from "better-sqlite3";

/**
 * Slowing somebody down.
 *
 * ## What this defends
 *
 * Guessing. Every refusal was recorded and then permitted again immediately,
 * so a password could be tried as fast as the network allowed, and the
 * magic-link form could be used to send mail at somebody repeatedly.
 *
 * ## What it deliberately does not defend
 *
 * **Spraying** — one attempt each against a thousand addresses. Per-subject
 * counting cannot see that, and the thing that can see it is the address the
 * requests come from. Behind a reverse proxy that address arrives in a header
 * the client writes, so a limiter keyed on it is one the attacker opts out of
 * by setting a different value. Address-based limiting belongs at the proxy,
 * which knows the real socket; `docs/architecture/deployment.md` says so.
 *
 * ## Why being throttled may say so
 *
 * A throttled response is distinguishable from a refused one, which would be
 * a leak if only real accounts were counted — a fast refusal and a throttle
 * would tell an enumerator which addresses exist. Every subject typed into
 * the box gets a row whether or not an account has it, so the two are
 * indistinguishable, and saying "too many attempts" is then honest rather
 * than informative.
 */

export type ThrottleKind = "password" | "magic-link" | "password-reset";

export interface ThrottlePolicy {
  /** Failures allowed inside one window before the subject is blocked. */
  attempts: number;
  /** How long failures are counted for. */
  windowMs: number;
  /** How long a blocked subject stays blocked. */
  blockMs: number;
}

const MINUTE = 60 * 1000;

/**
 * The limits.
 *
 * Sign-in is the loosest because a leader genuinely mistypes a passphrase;
 * five tries in a quarter of an hour is generous to a person and useless to a
 * script. The two that send mail are tighter, because each one costs somebody
 * an email they did not ask for.
 */
export const policies: Record<ThrottleKind, ThrottlePolicy> = {
  password: { attempts: 5, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
  "magic-link": { attempts: 3, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
  "password-reset": { attempts: 3, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
};

/** How long a row survives after its window closed, before sweeping. */
const KEEP_MS = 24 * 60 * MINUTE;

interface Row {
  key: string;
  windowStartedAt: string;
  attempts: number;
  blockedUntil?: string;
}

/**
 * One subject's state, decided without touching a database or a clock.
 *
 * Separated from storage because the interesting part is the arithmetic —
 * when a window rolls over, when a block expires, whether an attempt counts —
 * and all of it is testable directly.
 */
export function nextState(
  existing: Row | undefined,
  policy: ThrottlePolicy,
  now: number,
): { attempts: number; windowStartedAt: string; blockedUntil?: string } {
  const started = existing ? Date.parse(existing.windowStartedAt) : now;
  const windowOpen = existing !== undefined && now - started < policy.windowMs;

  /* A window that has closed starts again at one rather than carrying old
     failures forward: the limit is "five in a quarter of an hour", not "five
     ever". */
  const attempts = windowOpen ? existing.attempts + 1 : 1;
  const windowStartedAt = windowOpen ? existing!.windowStartedAt : new Date(now).toISOString();

  return {
    attempts,
    windowStartedAt,
    ...(attempts >= policy.attempts
      ? { blockedUntil: new Date(now + policy.blockMs).toISOString() }
      : {}),
  };
}

/** Whether a stored block is still in force. */
export const stillBlocked = (row: Row | undefined, now: number): boolean =>
  Boolean(row?.blockedUntil && Date.parse(row.blockedUntil) > now);

/** `kind` and subject, as one key. Case-folded so casing cannot evade it. */
export const throttleKey = (kind: ThrottleKind, subject: string): string =>
  `${kind}:${subject.trim().toLowerCase()}`;

export interface Throttle {
  /** True when this subject may not try again yet. */
  blocked(kind: ThrottleKind, subject: string): boolean;
  /** Record a failure. Returns true when this failure caused a block. */
  fail(kind: ThrottleKind, subject: string): boolean;
  /** Forget this subject's failures. Called on success. */
  clear(kind: ThrottleKind, subject: string): void;
  /** Remove rows nothing is counting any more. */
  sweep(): number;
}

export function createThrottle(db: Db, clock: () => number = Date.now): Throttle {
  /* Every timestamp this writes comes from the injected clock, including
     `updated_at`. Mixing the real clock into the stored rows and the injected
     one into the queries that read them makes the two disagree, and makes the
     sweep untestable. */
  const stamp = () => new Date(clock()).toISOString();

  const read = (key: string): Row | undefined => {
    const row = db.prepare("SELECT * FROM auth_throttle WHERE key = ?").get(key) as
      Record<string, string | number | null> | undefined;
    if (!row) return undefined;

    return {
      key: String(row["key"]),
      windowStartedAt: String(row["window_started_at"]),
      attempts: Number(row["attempts"]),
      ...(row["blocked_until"] ? { blockedUntil: String(row["blocked_until"]) } : {}),
    };
  };

  return {
    blocked(kind, subject) {
      return stillBlocked(read(throttleKey(kind, subject)), clock());
    },

    fail(kind, subject) {
      const key = throttleKey(kind, subject);
      const now = clock();
      const existing = read(key);

      /* Already blocked: the block extends rather than being recomputed from
         a stale window, so hammering a locked account keeps it locked. */
      if (stillBlocked(existing, now)) {
        const until = new Date(now + policies[kind].blockMs).toISOString();
        db.prepare(
          "UPDATE auth_throttle SET blocked_until = ?, attempts = attempts + 1, updated_at = ? WHERE key = ?",
        ).run(until, stamp(), key);
        return true;
      }

      const next = nextState(existing, policies[kind], now);
      db.prepare(
        `INSERT INTO auth_throttle (key, window_started_at, attempts, blocked_until, updated_at)
              VALUES (@key, @started, @attempts, @until, @at)
         ON CONFLICT(key) DO UPDATE SET
              window_started_at = @started,
              attempts          = @attempts,
              blocked_until     = @until,
              updated_at        = @at`,
      ).run({
        key,
        started: next.windowStartedAt,
        attempts: next.attempts,
        until: next.blockedUntil ?? null,
        at: stamp(),
      });

      return Boolean(next.blockedUntil);
    },

    clear(kind, subject) {
      db.prepare("DELETE FROM auth_throttle WHERE key = ?").run(throttleKey(kind, subject));
    },

    sweep() {
      const cutoff = new Date(clock() - KEEP_MS).toISOString();
      return db.prepare("DELETE FROM auth_throttle WHERE updated_at < ?").run(cutoff).changes;
    },
  };
}
