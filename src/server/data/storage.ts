import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

/**
 * Where an artifact goes.
 *
 * ## Why an interface at all
 *
 * Because the destination is the part of this domain most likely to change,
 * and the part a church's own circumstances decide. Writing export generation
 * straight onto the filesystem would mean rewriting it the day somebody wants
 * a copy somewhere else.
 *
 * ## What exists, and what does not
 *
 * `LocalStorage` is real: it writes under a controlled directory on this
 * server. That is genuinely useful for a bad deploy and genuinely useless for
 * a dead machine, which is why the continuity status reports a local-only
 * installation as **insufficient** rather than as backed up.
 *
 * `DirectoryStorage` is the second destination: another directory, which an
 * operator points at a mounted volume, an NFS share or an attached disk. It
 * writes real bytes to a real place, and it is honest about what it cannot
 * know — see `offsite` below.
 *
 * A provider for an object store (S3, GCS, Backblaze) is **not built**, and no
 * stub pretends to be one. It needs credentials in a secret mechanism and a
 * decision about encryption before transfer. A provider that quietly wrote
 * nowhere would be worse than none, because the dashboard would say a backup
 * exists.
 */

export interface StoredArtifact {
  /** Opaque. Never a path — a path in a response is a way to ask for another. */
  reference: string;
  bytes: number;
  checksum: string;
}

export interface StorageProvider {
  readonly id: string;
  /**
   * True when a copy here survives the loss of this server.
   *
   * **This cannot be inferred, only asserted.** A directory might be a mounted
   * volume in another building or a folder on the same disk, and from inside
   * the process those look identical. So a directory destination is offsite
   * only when an operator has said so, and the interface attributes the claim
   * to them rather than making it itself.
   */
  readonly offsite: boolean;
  put(name: string, content: Buffer | string): StoredArtifact;
  get(reference: string): Buffer;
  exists(reference: string): boolean;
  delete(reference: string): void;
  checksum(reference: string): string | undefined;
  list(): StoredArtifact[];
}

export const sha256 = (content: Buffer | string): string =>
  createHash("sha256").update(content).digest("hex");

/**
 * Artifacts on this machine.
 *
 * Everything is written under one root and every reference is resolved back
 * against it, so a reference that tries to leave — `../../etc/passwd`, an
 * absolute path — is refused rather than followed. The references this class
 * hands out are opaque ids, so nothing legitimate ever needs to.
 */
export class LocalStorage implements StorageProvider {
  readonly id: string = "local";
  /* Widened from `false` so `DirectoryStorage` can say otherwise. A local
     directory still defaults to "does not survive this machine". */
  readonly offsite: boolean = false;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  /**
   * Where an artifact is on disk.
   *
   * Exposed because two things genuinely need a path — SQLite's own backup
   * writes one, and opening a copy to verify it reads one — and a caller
   * reaching into this class to reconstruct it would bypass the containment
   * below. Every other consumer uses references.
   */
  pathOf(reference: string): string {
    return this.pathFor(reference);
  }

  /** A scratch path inside the store, for a file that is about to exist. */
  scratchPath(name: string): string {
    return this.pathFor(`scratch-${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, "-")}`);
  }

  /** Resolve a reference inside the root, or refuse. */
  private pathFor(reference: string): string {
    const full = resolve(join(this.root, reference));
    const root = resolve(this.root);
    if (full !== root && !full.startsWith(root + "/")) {
      throw new Error("That artifact reference points outside the artifact store.");
    }
    return full;
  }

  put(name: string, content: Buffer | string): StoredArtifact {
    /* The caller's name is a hint, not a path: anything but a safe filename is
       replaced rather than sanitised, because half-cleaning a path is how
       traversal survives. */
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "-");
    /* The distinguishing part is cryptographically random rather than
       `Math.random()`: two exports requested in the same millisecond must not
       be able to collide, and a reference that is guessable is a reference
       somebody can ask the store for. */
    const reference = `${Date.now()}-${randomBytes(9).toString("hex").slice(0, 12)}-${safe}`;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");

    writeFileSync(this.pathFor(reference), buffer);
    return { reference, bytes: buffer.byteLength, checksum: sha256(buffer) };
  }

  get(reference: string): Buffer {
    return readFileSync(this.pathFor(reference));
  }

  exists(reference: string): boolean {
    return existsSync(this.pathFor(reference));
  }

  delete(reference: string): void {
    rmSync(this.pathFor(reference), { force: true });
  }

  checksum(reference: string): string | undefined {
    if (!this.exists(reference)) return undefined;
    return sha256(this.get(reference));
  }

  list(): StoredArtifact[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).map((reference) => ({
      reference,
      bytes: statSync(join(this.root, reference)).size,
      checksum: "",
    }));
  }
}

/**
 * A second directory, somewhere an operator chose.
 *
 * Mechanically the same as `LocalStorage`; the difference is entirely what it
 * claims. `offsite` is whatever the operator asserted, because a process
 * cannot tell a mounted volume in another building from a folder on its own
 * disk — the path looks the same from here.
 *
 * What it *can* check is `onSeparateDevice`, which compares the filesystem
 * device of this directory with the one holding the database. That does not
 * prove the copy is off the machine, and it does catch the mistake people
 * actually make: pointing the backup directory at the same disk and believing
 * it is a second copy.
 */
export class DirectoryStorage extends LocalStorage {
  override readonly id = "directory";
  override readonly offsite: boolean;
  /** Shown to an administrator so they can check where it actually writes. */
  readonly directory: string;

  constructor(root: string, offsite: boolean) {
    super(root);
    this.directory = root;
    this.offsite = offsite;
  }
}

/** Where artifacts live. Beside the database, and never inside the repository. */
export const ARTIFACT_ROOT =
  process.env["OIKONOMIA_ARTIFACTS"] ?? join(process.cwd(), ".data", "artifacts");

let local: LocalStorage | undefined;

export function localStorageProvider(): LocalStorage {
  local ??= new LocalStorage(ARTIFACT_ROOT);
  return local;
}

let secondary: DirectoryStorage | undefined | null;

/**
 * The copy that is meant to survive this machine, if one is configured.
 *
 * `null` is cached for "configured nothing", so a missing variable is not
 * re-read on every backup; `undefined` means the question has not been asked
 * yet.
 */
export function secondaryStorageProvider(): DirectoryStorage | undefined {
  if (secondary !== undefined) return secondary ?? undefined;

  const root = process.env["OIKONOMIA_BACKUP_DIR"]?.trim();
  if (!root) {
    secondary = null;
    return undefined;
  }

  /* The operator's assertion, not ours. Anything but an explicit "true" is
     treated as "a second copy, still on this machine" — the safe reading, and
     the one that keeps the dashboard warning. */
  const offsite = process.env["OIKONOMIA_BACKUP_OFFSITE"]?.trim().toLowerCase() === "true";

  secondary = new DirectoryStorage(root, offsite);
  return secondary;
}

/** For tests, and for a process that changed its own environment. */
export function forgetProviders(): void {
  local = undefined;
  secondary = undefined;
}

/**
 * Whether the backup directory is on a different filesystem device.
 *
 * The one thing about a second directory that can actually be checked. Not
 * proof it survives the building; proof it survives the disk, which is the
 * failure people plan for and the mistake they make.
 */
export function onSeparateDevice(root: string, comparedWith: string): boolean {
  try {
    return statSync(root).dev !== statSync(comparedWith).dev;
  } catch {
    return false;
  }
}

/**
 * The providers this installation actually has.
 *
 * The list is what the continuity status reads to decide whether anything
 * survives the loss of this machine.
 */
export function providers(): StorageProvider[] {
  const second = secondaryStorageProvider();
  return second ? [localStorageProvider(), second] : [localStorageProvider()];
}

export const hasOffsiteProvider = (): boolean => providers().some((provider) => provider.offsite);
