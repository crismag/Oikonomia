import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { fetchDriveDetails } from "@/lib/drive-api";
import { driveIcon, type DriveDetails, type DriveIcon } from "@/domain/drive";
import type { ResourceSearchResult } from "@/domain/types";
import { useAuth } from "./auth-provider";

/**
 * What Drive says now about documents on a list.
 *
 * The binder's record holds the name a document had when it was filed; Drive
 * knows who owns it and when it last changed. Asked as the viewer, so a file
 * Google will not show them simply has no details — the row still opens in
 * Drive, and Drive decides.
 *
 * Off where Drive is not connected: nothing is requested, nothing is drawn.
 */

const icons: Record<DriveIcon, LucideIcon> = {
  folder: Folder,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  file: File,
};

export function DriveFileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = icons[driveIcon(mimeType)];
  return <Icon className={cn("size-4 shrink-0 text-area-ink", className)} aria-hidden />;
}

export function useDriveDetails(documents: ResourceSearchResult[]) {
  const { methods } = useAuth();
  const ids = documents
    .filter((document) => document.driveFileId)
    .map((document) => document.id)
    .sort();
  const enabled = methods.workspace.drive && ids.length > 0;

  const query = useQuery<DriveDetails[]>({
    queryKey: ["drive-details", ids],
    queryFn: async () =>
      unwrap(await withTimeout(fetchDriveDetails({ data: { documentIds: ids } }))),
    enabled,
    /* Drive changes elsewhere; a minute old is fresh enough for a shelf. */
    staleTime: 60_000,
    retry: 0,
    networkMode: "always",
  });

  const byDocument = new Map<string, DriveDetails>();
  for (const entry of query.data ?? []) byDocument.set(entry.documentId, entry);
  return byDocument;
}

/** "Maria Santos · modified 3 days ago", from Drive, or nothing. */
export function driveLine(details: DriveDetails | undefined): string | undefined {
  if (!details?.available) return undefined;
  const { file } = details;
  const parts = [
    file.ownerName,
    file.modifiedTime
      ? `modified ${formatDistanceToNow(new Date(file.modifiedTime), { addSuffix: true })}`
      : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
