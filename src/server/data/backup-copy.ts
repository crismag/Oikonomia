import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { encryptBackupFile, sha256File } from "./backup-crypto";

/**
 * Taking the copy, somewhere a hung destination cannot stop the server.
 *
 * ## The failure this exists for
 *
 * A backup used to run on the thread that answers requests. A destination that
 * neither succeeds nor fails — a network mount that has gone away without
 * saying so is the real case — left that thread waiting inside a system call,
 * and every page, `/healthz` included, waited with it.
 *
 * ## Why a child process and not a worker thread
 *
 * A worker thread was tried first. `worker.terminate()` cannot interrupt a
 * thread blocked inside a system call: the worker never stops, and a process
 * holding one does not exit either. A child process can be killed outright,
 * and the server loses nothing but the copy it was waiting for.
 *
 * ## Why the program is passed as text
 *
 * The server is bundled; a separate worker file would have to be found beside
 * the bundle, and it is exactly the kind of file a build drops. So the child's
 * program is the source of the functions below, run with `node -e`. They are
 * self-contained for that reason — no imports, no constants from outside.
 * `better-sqlite3` is resolved here, where the bundle's own `node_modules` is
 * known, and its path handed over.
 *
 * ## What "successful" means
 *
 * Every file is written under a `.partial` name and renamed only once it is
 * whole, so a copy that was interrupted is never at the name a job records.
 * The child reports each stage as it finishes; the server decides what the
 * job says.
 */

export interface BackupCopyRequest {
  /** The live database file, opened read-only by the child. */
  database: string;
  /** Scratch file for SQLite's own copy, inside the artifact store. */
  scratch: string;
  artifactRoot: string;
  /** Where the finished local artifact goes. */
  localPath: string;
  /** The second destination, when one is configured. */
  secondary?: { root: string; path: string };
  /** Encrypt what is written, with this 32-byte key. */
  key?: Buffer;
  timeoutMs: number;
}

export type BackupCopyResult =
  | {
      status: "stored";
      bytes: number;
      checksum: string;
      /** Set when a second destination is configured and the copy there did not happen. */
      copyFailed?: string;
    }
  | { status: "failed"; reason: string }
  | { status: "timed-out"; reason: string };

type ChildMessage =
  | { type: "stored"; bytes: number; checksum: string }
  | { type: "copied" }
  | { type: "copy-failed"; reason: string }
  | { type: "failed"; reason: string }
  | { type: "done" };

interface ChildHelpers {
  encrypt: typeof encryptBackupFile;
  sha256: typeof sha256File;
}

interface ChildJob {
  task: "backup" | "cleanup";
  sqlite: string;
  database: string;
  scratch: string;
  artifactRoot: string;
  localPath: string;
  secondaryRoot?: string;
  secondaryPath?: string;
  key?: string;
  paths?: string[];
}

/**
 * The child's program. Runs in its own process; see the module comment for
 * why it may not reach outside itself.
 */
function backupChild(
  nodeRequire: NodeJS.Require,
  proc: NodeJS.Process,
  helpers: ChildHelpers,
): void {
  const files = nodeRequire("node:fs") as typeof import("node:fs");
  const cipherLib = nodeRequire("node:crypto") as typeof import("node:crypto");
  const deps = { fs: files, crypto: cipherLib };
  const reason = (error: unknown) =>
    error instanceof Error && error.message ? error.message : String(error);
  const send = (message: unknown, then?: () => void) => {
    proc.send!(message, undefined, {}, () => then?.());
  };

  proc.once("message", (raw) => {
    const job = raw as ChildJob;

    if (job.task === "cleanup") {
      for (const path of job.paths ?? []) {
        try {
          files.rmSync(path, { force: true });
        } catch {
          /* Best effort: whatever could not be removed is still only a
             `.partial` that no job refers to. */
        }
      }
      send({ type: "done" }, () => proc.exit(0));
      return;
    }

    const localPartial = `${job.localPath}.partial`;
    try {
      files.mkdirSync(job.artifactRoot, { recursive: true });

      const Database = nodeRequire(job.sqlite) as typeof import("better-sqlite3");
      const source = new Database(job.database, { readonly: true, fileMustExist: true });
      try {
        source.prepare("VACUUM INTO ?").run(job.scratch);
      } finally {
        source.close();
      }

      if (job.key) {
        helpers.encrypt(deps, job.scratch, localPartial, Buffer.from(job.key, "base64"));
        files.rmSync(job.scratch, { force: true });
      } else {
        files.renameSync(job.scratch, localPartial);
      }

      const bytes = files.statSync(localPartial).size;
      const checksum = helpers.sha256(deps, localPartial);
      files.renameSync(localPartial, job.localPath);
      send({ type: "stored", bytes, checksum });
    } catch (error) {
      for (const path of [job.scratch, localPartial]) {
        try {
          files.rmSync(path, { force: true });
        } catch {
          /* Reported below regardless. */
        }
      }
      send({ type: "failed", reason: reason(error) }, () => proc.exit(1));
      return;
    }

    if (job.secondaryRoot && job.secondaryPath) {
      const secondPartial = `${job.secondaryPath}.partial`;
      try {
        files.mkdirSync(job.secondaryRoot, { recursive: true });
        files.copyFileSync(job.localPath, secondPartial);
        files.renameSync(secondPartial, job.secondaryPath);
        send({ type: "copied" });
      } catch (error) {
        try {
          files.rmSync(secondPartial, { force: true });
        } catch {
          /* Reported below regardless. */
        }
        send({ type: "copy-failed", reason: reason(error) });
      }
    }

    send({ type: "done" }, () => proc.exit(0));
  });
}

const childSource = `(${backupChild.toString()})(require, process, { encrypt: ${encryptBackupFile.toString()}, sha256: ${sha256File.toString()} });`;

/**
 * Where `better-sqlite3` is, from the server's point of view.
 *
 * The child runs `node -e`, which resolves modules from its working directory;
 * a server started from elsewhere would not find the bundle's copy. When
 * resolution fails here the bare name is passed, which is right for anything
 * started from the application directory.
 */
function sqliteModule(): string {
  try {
    return createRequire(import.meta.url).resolve("better-sqlite3");
  } catch {
    return "better-sqlite3";
  }
}

function startChild(job: ChildJob) {
  const child = spawn(process.execPath, ["-e", childSource], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    /* The key travels over the IPC channel, never in arguments or the
       environment, where another process listing this one could read it. */
    env: { ...process.env, OIKONOMIA_BACKUP_KEY: "" },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString();
  });
  child.send(job);
  return { child, stderr: () => stderr.trim() };
}

/**
 * Take the copy in a child process, and give up on it after `timeoutMs`.
 *
 * On timeout the child is killed and its `.partial` files are removed by a
 * second, short-lived child — removing them from here would put the server
 * back on the very destination that just stopped answering.
 */
export function runBackupCopy(request: BackupCopyRequest): Promise<BackupCopyResult> {
  const job: ChildJob = {
    task: "backup",
    sqlite: sqliteModule(),
    database: request.database,
    scratch: request.scratch,
    artifactRoot: request.artifactRoot,
    localPath: request.localPath,
    ...(request.secondary
      ? { secondaryRoot: request.secondary.root, secondaryPath: request.secondary.path }
      : {}),
    ...(request.key ? { key: request.key.toString("base64") } : {}),
  };

  return new Promise((resolvePromise) => {
    const { child, stderr } = startChild(job);
    let stored: { bytes: number; checksum: string } | undefined;
    let copyFailed: string | undefined;
    let settled = false;

    const settle = (result: BackupCopyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const storedResult = (extra?: string): BackupCopyResult => ({
      status: "stored",
      bytes: stored!.bytes,
      checksum: stored!.checksum,
      ...(extra ? { copyFailed: extra } : copyFailed ? { copyFailed } : {}),
    });

    const seconds = Math.round(request.timeoutMs / 1000);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (stored) {
        /* The local copy is whole and renamed; only the second destination
           stopped answering. A failure to duplicate is not a failure to back
           up — but it is said, not swallowed. */
        void cleanupPartials(request.secondary ? [`${request.secondary.path}.partial`] : []);
        settle(
          storedResult(
            `The copy to the second destination did not finish within ${seconds} seconds and was stopped.`,
          ),
        );
        return;
      }
      void cleanupPartials([request.scratch, `${request.localPath}.partial`]);
      settle({
        status: "timed-out",
        reason: `The backup did not finish within ${seconds} seconds and was stopped. A destination may have stopped answering.`,
      });
    }, request.timeoutMs);

    child.on("message", (raw) => {
      const message = raw as ChildMessage;
      switch (message.type) {
        case "stored":
          stored = { bytes: message.bytes, checksum: message.checksum };
          break;
        case "copy-failed":
          copyFailed = message.reason;
          break;
        case "failed":
          settle({ status: "failed", reason: message.reason });
          break;
        case "done":
          if (stored) settle(storedResult());
          break;
        default:
          break;
      }
    });

    child.on("error", (error) => {
      settle({ status: "failed", reason: `The backup process could not start: ${error.message}` });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      if (stored) {
        settle(storedResult());
        return;
      }
      const detail = stderr().split("\n").filter(Boolean).pop();
      settle({
        status: "failed",
        reason: detail
          ? `The backup process stopped: ${detail}`
          : `The backup process stopped (${signal ?? `exit ${code}`}) before finishing.`,
      });
    });
  });
}

/** Remove partial files from a child of their own, given ten seconds. */
function cleanupPartials(paths: string[]): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return new Promise((done) => {
    const { child } = startChild({
      task: "cleanup",
      sqlite: "",
      database: "",
      scratch: "",
      artifactRoot: "",
      localPath: "",
      paths,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      console.error("Could not remove a stopped backup's partial files:", paths.join(", "));
      done();
    }, 10_000);
    child.on("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.on("error", () => {
      clearTimeout(timer);
      done();
    });
  });
}
