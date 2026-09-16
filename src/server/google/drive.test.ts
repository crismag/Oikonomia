import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createGoogleFile,
  getFiles,
  listFiles,
  listUrl,
  multipartBody,
  toDriveFile,
  uploadFile,
} from "./drive";
import { useGoogleTransport, type WorkspaceConfig } from "./workspace";
import { DRIVE_UPLOAD_LIMIT_BYTES, driveFileIdFromUrl, kindForMimeType } from "@/domain/drive";

/**
 * Drive requests, without Google.
 *
 * The transport is replaced, so these prove what Oikonomia asks Drive for —
 * not that a real Drive answers it the same way.
 */

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const config: WorkspaceConfig = {
  clientEmail: "oik@proj.iam.gserviceaccount.com",
  privateKey: pem,
  domain: "stjohns.org",
  appUser: "office@stjohns.org",
  driveRoot: "root-folder-id",
};

let calls: { url: string; init: RequestInit }[];
let reply: (url: string, init: RequestInit) => Response;

beforeEach(() => {
  calls = [];
  reply = () => new Response(JSON.stringify({ files: [] }));
  useGoogleTransport(async (url, init) => {
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    calls.push({ url, init });
    return reply(url, init);
  });
});

const query = (url: string) => new URL(url).searchParams;

describe("listing", () => {
  it("asks for a folder's children, across shared drives, with the fields it shows", () => {
    const params = query(listUrl({ in: "folder", folderId: "abc123" }));
    expect(params.get("q")).toBe("trashed = false and 'abc123' in parents");
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.get("includeItemsFromAllDrives")).toBe("true");
    expect(params.get("corpora")).toBe("allDrives");
    expect(params.get("fields")).toContain("owners(displayName,emailAddress)");
    expect(params.get("fields")).toContain("nextPageToken");
  });

  it("looks in My Drive or what is shared, and searches the place being looked at", () => {
    expect(query(listUrl({ in: "my-drive" })).get("q")).toBe(
      "trashed = false and 'root' in parents",
    );
    const shared = query(listUrl({ in: "shared", search: "Rota", pageToken: "p2" }));
    expect(shared.get("q")).toBe(
      "trashed = false and sharedWithMe = true and name contains 'Rota'",
    );
    expect(shared.get("orderBy")).toBeNull();
    expect(shared.get("pageToken")).toBe("p2");
  });

  it("escapes a search so it cannot change the query", () => {
    const q = query(listUrl({ in: "my-drive", search: "Joel's \\ plan' or '" })).get("q");
    expect(q).toBe(
      "trashed = false and 'root' in parents and name contains 'Joel\\'s \\\\ plan\\' or \\''",
    );
  });

  it("maps Drive's reply and passes the next page on", async () => {
    reply = () =>
      new Response(
        JSON.stringify({
          nextPageToken: "next",
          files: [
            {
              id: "f1",
              name: "Budget",
              mimeType: "application/vnd.google-apps.spreadsheet",
              webViewLink: "https://docs.google.com/spreadsheets/d/f1",
              modifiedTime: "2026-09-01T10:00:00Z",
              owners: [{ displayName: "Maria Santos", emailAddress: "maria@stjohns.org" }],
            },
            { id: "d1", name: "Rotas", mimeType: "application/vnd.google-apps.folder" },
          ],
        }),
      );
    const listing = await listFiles(config, "maria@stjohns.org", { in: "my-drive" });
    expect(listing.nextPageToken).toBe("next");
    expect(listing.files[0]).toEqual({
      id: "f1",
      name: "Budget",
      mimeType: "application/vnd.google-apps.spreadsheet",
      folder: false,
      webViewLink: "https://docs.google.com/spreadsheets/d/f1",
      modifiedTime: "2026-09-01T10:00:00Z",
      ownerName: "Maria Santos",
      ownerEmail: "maria@stjohns.org",
    });
    expect(listing.files[1]!.folder).toBe(true);
    expect(
      toDriveFile({ id: "x", name: "a.pdf", mimeType: "application/pdf", size: "2048" }).size,
    ).toBe(2048);
  });

  it("treats a file Google will not show as unavailable, not as a failure", async () => {
    reply = (url) =>
      url.includes("/files/gone")
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify({ id: "ok", name: "Plan", mimeType: "text/plain" }));
    const files = await getFiles(config, "maria@stjohns.org", ["ok", "gone", "ok"]);
    expect(files.get("gone")).toBeUndefined();
    expect(files.get("ok")?.name).toBe("Plan");
    expect(calls).toHaveLength(2);
  });
});

describe("creating and uploading", () => {
  it("creates a Google file of the right type inside the folder", async () => {
    reply = () => new Response(JSON.stringify({ id: "new", name: "Plan", mimeType: "x" }));
    await createGoogleFile(config, "maria@stjohns.org", {
      name: "Plan",
      kind: "sheet",
      parentId: "fold",
    });
    const sent = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(calls[0]!.init.method).toBe("POST");
    expect(sent).toEqual({
      name: "Plan",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: ["fold"],
    });
    expect(query(calls[0]!.url).get("supportsAllDrives")).toBe("true");
  });

  it("builds a multipart body of metadata then bytes", () => {
    const { body, contentType } = multipartBody(
      { name: "notes.txt", mimeType: "text/plain", parents: ["fold"] },
      new TextEncoder().encode("hello"),
      "B",
    );
    expect(contentType).toBe("multipart/related; boundary=B");
    expect(Buffer.from(body).toString()).toBe(
      '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"notes.txt","mimeType":"text/plain","parents":["fold"]}\r\n' +
        "--B\r\nContent-Type: text/plain\r\n\r\nhello\r\n--B--\r\n",
    );
  });

  it("uploads to Drive's upload endpoint as the leader", async () => {
    reply = () =>
      new Response(JSON.stringify({ id: "up", name: "notes.txt", mimeType: "text/plain" }));
    const file = await uploadFile(config, "maria@stjohns.org", {
      name: "notes.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("hello"),
      parentId: "fold",
    });
    expect(file.id).toBe("up");
    expect(calls[0]!.url).toContain("/upload/drive/v3/files");
    expect(query(calls[0]!.url).get("uploadType")).toBe("multipart");
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toMatch(
      /^multipart\/related; boundary=/,
    );
  });

  it("refuses a file over the limit before Google is asked", async () => {
    await expect(
      uploadFile(config, "maria@stjohns.org", {
        name: "big.mov",
        mimeType: "video/quicktime",
        bytes: new Uint8Array(DRIVE_UPLOAD_LIMIT_BYTES + 1),
        parentId: "fold",
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(calls).toEqual([]);
  });
});

describe("reading Drive in the binder's words", () => {
  it("names kinds by what they are, not the provider", () => {
    expect(kindForMimeType("application/vnd.google-apps.document")).toBe("Document");
    expect(
      kindForMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("Spreadsheet");
    expect(kindForMimeType("image/png")).toBe("File");
  });

  it("reads a file id out of a pasted Drive or Docs address, and nothing else", () => {
    expect(driveFileIdFromUrl("https://docs.google.com/document/d/1AbcDEFghijKL/edit")).toBe(
      "1AbcDEFghijKL",
    );
    expect(driveFileIdFromUrl("https://drive.google.com/open?id=1AbcDEFghijKL")).toBe(
      "1AbcDEFghijKL",
    );
    expect(driveFileIdFromUrl("https://example.com/d/1AbcDEFghijKL")).toBeUndefined();
    expect(driveFileIdFromUrl("not a url")).toBeUndefined();
  });
});
