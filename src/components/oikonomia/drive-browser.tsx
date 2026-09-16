import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, ExternalLink, FilePlus2, Search, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CalendarError, fieldErrors, unwrap, withTimeout } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import { browseDrive, createDriveFile, registerDriveFile, uploadDriveFile } from "@/lib/drive-api";
import {
  DRIVE_UPLOAD_LIMIT_BYTES,
  driveSourceLabel,
  googleFileLabel,
  uploadTooLarge,
  type DriveBrowse,
  type DriveFile,
  type DriveSource,
  type NewGoogleFileKind,
} from "@/domain/drive";
import { DriveFileIcon } from "./drive-details";

/**
 * Choosing, uploading and creating documents in Google Drive, for one ministry.
 *
 * Everything here happens in Drive **as the signed-in leader**: the lists are
 * what Drive shows them, and a file they cannot open in Drive is not offered.
 * What the binder keeps is a record of the file — never the file.
 *
 * Upload and New are offered only to people who contribute to the ministry;
 * the server refuses anyone else in any case.
 */

const sources: DriveSource[] = ["ministry", "mine", "shared"];

/** A calm sentence for a failure, whether Drive refused or the request never arrived. */
export const driveErrorMessage = (error: unknown) =>
  error instanceof CalendarError
    ? error.message
    : "Google Drive could not be reached just now. Try again.";

export function DriveBrowser({
  ministryId,
  ministryName,
  mayAdd,
  onDone,
}: {
  ministryId: string;
  ministryName: string;
  /** Contributes to the ministry: may upload into its folder and start new files there. */
  mayAdd: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<DriveSource>("ministry");
  /* Folders opened below the tab's starting place, per tab. */
  const [trail, setTrail] = useState<Record<DriveSource, { id: string; name: string }[]>>({
    ministry: [],
    mine: [],
    shared: [],
  });
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewGoogleFileKind | null>(null);
  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState<DriveFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Search as the leader pauses, not on every key: each search is a Drive request. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const path = trail[source];
  const folderId = path.at(-1)?.id;

  const listing = useInfiniteQuery<DriveBrowse>({
    queryKey: ["drive", source, ministryId, folderId ?? "", search],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await withTimeout(
          browseDrive({
            data: {
              source,
              ministryId,
              ...(folderId ? { folderId } : {}),
              ...(search ? { search } : {}),
              ...(typeof pageParam === "string" ? { pageToken: pageParam } : {}),
            },
          }),
        ),
      ),
    getNextPageParam: (last) => last.nextPageToken,
    retry: 0,
    networkMode: "always",
  });

  const files = listing.data?.pages.flatMap((page) => page.files) ?? [];
  const unavailable = listing.data?.pages[0]?.folderUnavailable;

  /* Remembered past a change of tab: without a church Drive root there is no
     ministry folder to upload or create into, so those are not offered. */
  const [noRoot, setNoRoot] = useState(false);
  useEffect(() => {
    if (unavailable === "no-root") setNoRoot(true);
  }, [unavailable]);

  const refreshShelves = () => {
    void queryClient.invalidateQueries({ queryKey: ["filed-documents"] });
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void queryClient.invalidateQueries({ queryKey: ["drive"] });
    void queryClient.invalidateQueries({ queryKey: ["drive-details"] });
  };

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      const fields = fieldErrors(error);
      setFailure(fields["file"] ?? fields["name"] ?? driveErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const choose = (file: DriveFile) =>
    run(file.id, async () => {
      unwrap(
        (await withTimeout(registerDriveFile({ data: { fileId: file.id, ministryId } }))) as never,
      );
      refreshShelves();
      onDone();
    });

  const upload = (file: File) => {
    if (file.size > DRIVE_UPLOAD_LIMIT_BYTES) {
      setFailure(uploadTooLarge);
      return;
    }
    void run("upload", async () => {
      const form = new FormData();
      form.set("ministryId", ministryId);
      form.set("file", file);
      /* Uploads take longer than an ordinary request; a minute is still a limit. */
      unwrap((await withTimeout(uploadDriveFile({ data: form }), 60_000)) as never);
      refreshShelves();
      onDone();
    });
  };

  const create = (kind: NewGoogleFileKind) => {
    const name = newName.trim();
    if (!name) {
      setFailure("Give it a name you would look for it by.");
      return;
    }
    /*
     * Opened now, while the click still counts as the leader's, and pointed at
     * the file once it exists: a tab opened after the request returns is
     * blocked by most browsers.
     */
    const tab = window.open("", "_blank");
    void run("create", async () => {
      try {
        const result = unwrap(
          (await withTimeout(createDriveFile({ data: { ministryId, kind, name } }))) as never,
        ) as { file: DriveFile };
        refreshShelves();
        setCreating(null);
        setNewName("");
        if (tab && result.file.webViewLink) {
          tab.opener = null;
          tab.location.href = result.file.webViewLink;
        } else {
          tab?.close();
          setCreated(result.file);
        }
      } catch (error) {
        tab?.close();
        throw error;
      }
    });
  };

  const openFolder = (file: DriveFile) => {
    setTrail({ ...trail, [source]: [...path, { id: file.id, name: file.name }] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium">Add from Google Drive</h2>
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Files stay in Drive. The binder files a record of each under {ministryName}, and
          Drive&apos;s own sharing still decides who can open it.
        </p>
      </div>

      {mayAdd && !noRoot ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            busy={busy === "upload"}
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-3.5" aria-hidden />
            Upload file
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
          {(Object.keys(googleFileLabel) as NewGoogleFileKind[]).map((kind) => (
            <Button
              key={kind}
              type="button"
              variant={creating === kind ? "primary" : "ghost"}
              disabled={busy !== null}
              aria-pressed={creating === kind}
              onClick={() => {
                setCreated(null);
                setFailure(null);
                setCreating(creating === kind ? null : kind);
              }}
            >
              <FilePlus2 className="size-3.5" aria-hidden />
              New {googleFileLabel[kind]}
            </Button>
          ))}
        </div>
      ) : null}

      {creating ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-border bg-area-soft p-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            create(creating);
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Name of the new {googleFileLabel[creating]}</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`Name the new ${googleFileLabel[creating]}`}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none placeholder:text-muted-foreground focus:border-border-strong"
            />
          </label>
          <Button type="submit" variant="primary" busy={busy === "create"} disabled={busy !== null}>
            Create in the ministry folder
          </Button>
        </form>
      ) : null}

      {created?.webViewLink ? (
        <p className="text-[13px] text-area-ink">
          {created.name} is in the ministry folder.{" "}
          <a
            href={created.webViewLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          >
            Open in Drive
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      ) : null}

      {failure ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {failure}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
          <div
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
            role="group"
            aria-label="Where to look"
          >
            {sources.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={source === option}
                onClick={() => setSource(option)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                  source === option
                    ? "bg-area-soft font-medium text-area-ink"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {driveSourceLabel[option]}
              </button>
            ))}
          </div>
          <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Search {driveSourceLabel[source]}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Search ${path.at(-1)?.name ?? driveSourceLabel[source]}`}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </label>
          {path.length > 0 ? (
            <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-[12px]">
              <button
                type="button"
                onClick={() => setTrail({ ...trail, [source]: [] })}
                className="text-muted-foreground hover:text-foreground"
              >
                {driveSourceLabel[source]}
              </button>
              {path.map((crumb, index) => (
                <span key={crumb.id} className="inline-flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
                  {index === path.length - 1 ? (
                    <span className="font-medium text-foreground">{crumb.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTrail({ ...trail, [source]: path.slice(0, index + 1) })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {crumb.name}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          ) : null}
        </div>

        {listing.isPending ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">Asking Drive…</p>
        ) : listing.isError ? (
          <div className="space-y-2 px-4 py-4">
            <p role="alert" className="text-[13px] text-status-overdue">
              {driveErrorMessage(listing.error)}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void listing.refetch()}>
              Try again
            </Button>
          </div>
        ) : unavailable === "no-root" ? (
          <p className="px-4 py-4 text-[13px] leading-relaxed text-muted-foreground">
            Ministry folders are not set up on this installation. Choose a file from My Drive or
            Shared with me instead.
          </p>
        ) : unavailable === "not-yet" ? (
          <p className="px-4 py-4 text-[13px] leading-relaxed text-muted-foreground">
            {ministryName} has no Drive folder yet. It is made in the church&apos;s Drive the first
            time someone uploads or creates a file here.
          </p>
        ) : files.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">
            {search ? `Nothing in Drive matches “${search}” here.` : "This folder is empty."}
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            {files.map((file) => (
              <li key={file.id} className="row-quiet">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => (file.folder ? openFolder(file) : void choose(file))}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left disabled:opacity-60"
                >
                  <DriveFileIcon mimeType={file.mimeType} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{file.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {[
                        file.ownerName,
                        file.modifiedTime
                          ? `modified ${formatDistanceToNow(new Date(file.modifiedTime), { addSuffix: true })}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-[12px] font-medium text-area-ink">
                    {file.folder ? (
                      <ChevronRight
                        className="size-4 text-muted-foreground"
                        aria-label="Open folder"
                      />
                    ) : busy === file.id ? (
                      "Adding…"
                    ) : (
                      "Choose"
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {listing.hasNextPage ? (
          <div className="border-t border-border px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              busy={listing.isFetchingNextPage}
              onClick={() => void listing.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}
