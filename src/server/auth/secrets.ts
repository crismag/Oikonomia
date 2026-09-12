import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Storing things that must never be readable, and comparing them safely.
 *
 * ## Passwords
 *
 * scrypt, from Node's own crypto. `AUTHENTICATION.md` specifies Argon2id, and
 * every Argon2 for Node is a native addon — a second compiled dependency a
 * church carries per platform, for a deployment with no build pipeline. scrypt
 * is memory-hard, in the same family, and needs nothing installed.
 *
 * The parameters are stored **with each hash**, so the cost can be raised later
 * without invalidating what is already there, and the algorithm is a field, so
 * moving to Argon2 becomes a rehash-on-next-login rather than a migration.
 *
 * ## Tokens
 *
 * A magic link, a password reset and a session all work the same way: a long
 * random secret goes to the person, and only its **hash** is stored. Somebody
 * who reads the database cannot use what they find to sign in as anybody.
 *
 * SHA-256 rather than scrypt for those, deliberately: they are 256 bits of
 * randomness rather than something a human chose, so there is nothing to brute
 * force, and they are verified on every request where a slow hash would be a
 * denial of service against ourselves.
 */

/**
 * How expensive a password hash is.
 *
 * `N` dominates: 2^15 is roughly 100ms on ordinary hardware — slow enough to
 * make guessing expensive, fast enough that signing in does not feel broken.
 *
 * `maxmem` has to be raised with it. scrypt needs about `128 * N * r` bytes —
 * 32MB here — and Node's default ceiling is exactly 32MB, so the call fails
 * rather than running slowly. Stating it is part of stating the cost.
 */
const SCRYPT = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
} as const;

export interface StoredSecret {
  secret: string;
  salt: string;
  algorithm: string;
  parameters: string;
}

export function hashPassword(password: string): StoredSecret {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);

  return {
    secret: derived.toString("hex"),
    salt,
    algorithm: "scrypt",
    parameters: JSON.stringify(SCRYPT),
  };
}

/**
 * Whether this password produces the stored hash.
 *
 * Constant-time, so the comparison itself does not leak how much of a guess was
 * right. An unrecognised algorithm is a **refusal** rather than a fallback:
 * quietly accepting something we cannot verify properly is the failure mode
 * worth avoiding here.
 */
export function verifyPassword(password: string, stored: Partial<StoredSecret>): boolean {
  if (!stored.secret || !stored.salt) return false;
  if (stored.algorithm !== "scrypt") return false;

  let parameters: typeof SCRYPT;
  try {
    parameters = { ...SCRYPT, ...(JSON.parse(stored.parameters ?? "{}") as typeof SCRYPT) };
  } catch {
    return false;
  }

  const expected = Buffer.from(stored.secret, "hex");
  const actual = scryptSync(password.normalize("NFKC"), stored.salt, expected.length, parameters);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A secret to hand out, and the hash to keep. The secret is never stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Compare two strings without revealing where they differ.
 *
 * Used where a comparison is against something an attacker supplies — an OAuth
 * `state`, for instance — and a fast rejection would tell them how much of
 * their guess was correct.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
