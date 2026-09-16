import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database as Db } from "better-sqlite3";

import { seedOrganization } from "@/test/seeds";
import { viewerFor } from "@/test/viewer";
import { openDatabase } from "../db/connection";
import { useGoogleTransport, type WorkspaceConfig } from "../google/workspace";
import { createDocumentRepository } from "../repositories/document-repository";
import { createDriveFolderRepository } from "../repositories/drive-folder-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createDriveService, type UploadInput } from "./drive-service";
import { DRIVE_UPLOAD_LIMIT_BYTES } from "@/domain/drive";

/**
 * Drive-backed documents, against a real database and a pretend Google.
 *
 * What matters: Oikonomia's own rules hold before Google is asked, a
 * ministry's folder is made once and as the church mailbox, and a Drive file
 * becomes one registry record.
 */

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const base: WorkspaceConfig = {
  clientEmail: "oik@proj.iam.gserviceaccount.com",
  privateKey: pem,
  domain: "stjohns.org",
  appUser: "office@stjohns.org",
  driveRoot: "church-root",
};

/* Maria leads Music and has Transportation merely shared with her. */
const maria = viewerFor("leader");

let dir: string;
let db: Db;
let settings: WorkspaceConfig | undefined;
let calls: { url: string; init: RequestInit; subject?: string }[];
let tokenSubjects: string[];
let created = 0;

const service = () =>
  createDriveService({
    documents: createDocumentRepository(db),
    folders: createDriveFolderRepository(db),
    organization: createOrganizationRepository(db),
    workspace: () => settings,
  });

const subjectOf = (assertion: string) =>
  (
    JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString()) as {
      sub: string;
    }
  ).sub;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oikonomia-drive-"));
  db = openDatabase(join(dir, "test.db"));
  seedOrganization(db);
  db.prepare("UPDATE person SET email = ? WHERE id = ?").run("maria@stjohns.org", maria.person.id);
  settings = { ...base };
  calls = [];
  tokenSubjects = [];
  created = 0;

  useGoogleTransport(async (url, init) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      const assertion = new URLSearchParams(init.body as string).get("assertion")!;
      const sub = subjectOf(assertion);
      tokenSubjects.push(sub);
      return new Response(JSON.stringify({ access_token: `tok:${sub}`, expires_in: 3600 }));
    }
    const auth = (init.headers as Record<string, string>)["authorization"] ?? "";
    calls.push({ url, init, subject: auth.replace("Bearer tok:", "") });

    if (init.method === "POST") {
      created += 1;
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as { name: string; mimeType: string })
          : { name: "notes.txt", mimeType: "text/plain" };
      return new Response(
        JSON.stringify({
          id: `new-${created}`,
          name: body.name,
          mimeType: body.mimeType,
          webViewLink: `https://drive.google.com/file/d/new-${created}/view`,
        }),
      );
    }
    if (url.includes("/files/secret")) return new Response("no", { status: 404 });
    if (/\/files\/[^?]+\?/.test(url)) {
      const id = /\/files\/([^?]+)\?/.exec(url)![1]!;
      return new Response(
        JSON.stringify({
          id,
          name: `File ${id}`,
          mimeType: "application/vnd.google-apps.document",
          webViewLink: `https://docs.google.com/document/d/${id}/edit`,
          modifiedTime: "2026-09-10T09:00:00Z",
          owners: [{ displayName: "Maria Santos" }],
        }),
      );
    }
    return new Response(JSON.stringify({ files: [] }));
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (over: Partial<UploadInput> = {}): UploadInput => ({
  ministryId: "min-music",
  name: "notes.txt",
  mimeType: "text/plain",
  size: 5,
  bytes: async () => new TextEncoder().encode("hello"),
  ...over,
});

describe("ministry folders", () => {
  it("are made once, as the church mailbox, under the church's Drive root", async () => {
    const drive = service();
    const first = await drive.ensureMinistryFolder(maria, "min-music");
    const again = await drive.ensureMinistryFolder(maria, "min-music");

    expect(again).toBe(first);
    const folders = calls.filter((c) => c.init.method === "POST");
    expect(folders).toHaveLength(1);
    expect(folders[0]!.subject).toBe("office@stjohns.org");
    expect(JSON.parse(folders[0]!.init.body as string)).toEqual({
      name: "Music Ministry",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["church-root"],
    });
  });

  it("are not made while only looking, and say why the tab is empty", async () => {
    const drive = service();
    expect(await drive.browse(maria, { source: "ministry", ministryId: "min-music" })).toEqual({
      files: [],
      folderUnavailable: "not-yet",
    });
    settings = { ...base };
    delete settings.driveRoot;
    expect(await drive.browse(maria, { source: "ministry", ministryId: "min-music" })).toEqual({
      files: [],
      folderUnavailable: "no-root",
    });
    expect(calls).toEqual([]);
  });

  it("cannot be made without a church Drive root", async () => {
    settings = { ...base };
    delete settings.driveRoot;
    await expect(service().upload(maria, upload())).rejects.toMatchObject({ code: "forbidden" });
    expect(calls).toEqual([]);
  });
});

describe("adding files to a ministry", () => {
  it("uploads as the leader into the ministry's folder and registers it there", async () => {
    const { document } = await service().upload(maria, upload());
    const sent = calls.find((c) => c.url.includes("/upload/"))!;
    expect(sent.subject).toBe("maria@stjohns.org");
    expect(Buffer.from(sent.init.body as Uint8Array).toString()).toContain('"parents":["new-1"]');

    expect(document).toMatchObject({
      origin: "drive",
      driveFileId: "new-2",
      title: "notes.txt",
      registeredById: maria.person.id,
    });
    expect(document.associations).toEqual([
      expect.objectContaining({ entityType: "ministry", entityId: "min-music" }),
    ]);
  });

  it("creates a Google Sheet and registers it as a spreadsheet", async () => {
    const { document, file } = await service().create(maria, {
      ministryId: "min-music",
      kind: "sheet",
      name: "Rota",
    });
    expect(file.webViewLink).toContain("new-2");
    expect(document).toMatchObject({
      kind: "Spreadsheet",
      driveMimeType: "application/vnd.google-apps.spreadsheet",
    });
  });

  it("refuses someone the ministry is only shared with, before Google is asked", async () => {
    await expect(
      service().create(maria, { ministryId: "min-transport", kind: "doc", name: "Plan" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service().upload(maria, upload({ ministryId: "min-transport" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(tokenSubjects).toEqual([]);
  });

  it("refuses a file over the limit without reading it", async () => {
    let read = false;
    await expect(
      service().upload(
        maria,
        upload({
          size: DRIVE_UPLOAD_LIMIT_BYTES + 1,
          bytes: async () => {
            read = true;
            return new Uint8Array();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(read).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("choosing a file", () => {
  it("asks Drive as the leader, then keeps one record however often it is chosen", async () => {
    const drive = service();
    const first = await drive.register(maria, { fileId: "abc123", ministryId: "min-music" });
    const second = await drive.register(maria, { fileId: "abc123", ministryId: "min-victuals" });

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      title: "File abc123",
      kind: "Document",
      url: "https://docs.google.com/document/d/abc123/edit",
    });
    expect(second.associations.map((a) => a.entityId).sort()).toEqual([
      "min-music",
      "min-victuals",
    ]);
    expect(calls.every((c) => c.subject === "maria@stjohns.org")).toBe(true);
  });

  it("cannot register a file Google will not show the leader", async () => {
    await expect(service().register(maria, { fileId: "secret" })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("who Oikonomia will act as", () => {
  it("refuses a leader whose person record has no church Google address", async () => {
    db.prepare("UPDATE person SET email = ? WHERE id = ?").run("maria@gmail.com", maria.person.id);
    await expect(service().browse(maria, { source: "mine" })).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("church Google address"),
    });
    expect(tokenSubjects).toEqual([]);
  });

  it("refuses everything when Workspace is not set up", async () => {
    settings = undefined;
    await expect(service().browse(maria, { source: "mine" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().register(maria, { fileId: "abc123" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("is off in a demonstration, whatever the environment holds", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      OIKONOMIA_DEMO_MODE: "true",
      OIKONOMIA_GOOGLE_DOMAIN: "stjohns.org",
      OIKONOMIA_GOOGLE_APP_USER: "office@stjohns.org",
      OIKONOMIA_GOOGLE_SA_KEY: JSON.stringify({ client_email: "x@y", private_key: pem }),
    });
    try {
      const demo = createDriveService({
        documents: createDocumentRepository(db),
        folders: createDriveFolderRepository(db),
        organization: createOrganizationRepository(db),
      });
      await expect(demo.browse(maria, { source: "mine" })).rejects.toMatchObject({
        code: "forbidden",
      });
      expect(calls).toEqual([]);
    } finally {
      process.env = saved;
    }
  });
});

describe("live details", () => {
  it("come only for documents the leader may discover, and never fail the list", async () => {
    const drive = service();
    const chosen = await drive.register(maria, { fileId: "abc123", ministryId: "min-music" });
    const pasted = createDocumentRepository(db).insert({
      title: "Old link",
      kind: "Document",
      origin: "drive",
      url: "https://docs.google.com/document/d/secretfile1234/edit",
      registeredById: maria.person.id,
    });

    const details = await drive.details(maria, {
      documentIds: [chosen.id, pasted.id, "doc-missing"],
    });
    expect(details).toEqual([
      expect.objectContaining({ documentId: chosen.id, available: true }),
      { documentId: pasted.id, available: false },
    ]);
  });
});
