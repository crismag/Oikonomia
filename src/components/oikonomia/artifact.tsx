import { ExternalLink, FileSpreadsheet, FileText, Folder } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import type { ArtifactProvider, WorkingArtifact } from "@/domain/types";

/**
 * Working artifact reference.
 *
 * Google Workspace stays authoritative for collaborative material. The UI must
 * make source ownership visible and send editing back to the provider rather
 * than implying Oikonomia holds the content. See GOOGLE-WORKSPACE-INTEGRATION.md.
 */

const providerIcon = {
  "google-sheets": FileSpreadsheet,
  "google-docs": FileText,
  "google-drive": Folder,
};

const providerName: Record<ArtifactProvider, string> = {
  "google-sheets": "Google Sheets",
  "google-docs": "Google Docs",
  "google-drive": "Google Drive",
};

export function ArtifactCard({
  artifact,
  highlightSection,
  className,
}: {
  artifact: WorkingArtifact;
  highlightSection?: string;
  className?: string;
}) {
  const { personById } = useOrganization();
  const Icon = providerIcon[artifact.provider];
  const editor = personById(artifact.updatedBy);

  return (
    <article
      className={cn("rounded-2xl border border-border bg-surface shadow-card p-3.5", className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-surface-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-[14px] font-medium">{artifact.title}</h3>
            {artifact.authoritative ? (
              <span className="shrink-0 rounded-full border border-status-done/30 bg-status-done-soft px-2 py-0.5 text-[11px] leading-5 text-status-done">
                Authoritative
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-[12px] text-muted-foreground">
            {providerName[artifact.provider]} · updated {artifact.updated} by {editor.name}
          </p>

          {artifact.sections.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {artifact.sections.map((section) => (
                <li
                  key={section}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 text-[11px] leading-5",
                    section === highlightSection
                      ? "border-primary/30 bg-area-soft text-area-ink"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {section}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <a
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-muted"
        >
          Open
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">
            {artifact.title} in {providerName[artifact.provider]}
          </span>
        </a>
      </div>
    </article>
  );
}
