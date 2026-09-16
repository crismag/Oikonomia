import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ClipboardList, ExternalLink, FileWarning, FolderOpen, Plus } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useForms } from "@/components/oikonomia/forms-provider";
import { useRegistry } from "@/components/oikonomia/documents-provider";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { RegisterDocument } from "@/components/oikonomia/register-document";
import { Section } from "@/components/oikonomia/section";
import { DriveFileIcon, driveLine, useDriveDetails } from "@/components/oikonomia/drive-details";

export const Route = createFileRoute("/documents/")({
  head: () => ({
    meta: [
      { title: "Documents & Forms — Oikonomia" },
      {
        name: "description",
        content: "The binder's resources section: ministry forms, reference documents and files.",
      },
    ],
  }),
  component: DocumentsPage,
});

/**
 * Documents & Forms — binder section 8.
 *
 * The binder has a dedicated resources section: forms and documents live here,
 * even when they are also linked from a meeting note or a ministry entry. This
 * is their filing home, not an attachment list belonging to something else.
 *
 * Volunteer Forms is named in the spine but its organization comes from the
 * physical pages, which have not been supplied.
 *
 * Reference documents come from the document registry, which is the same
 * records resource search reads. §5 of `DOCUMENT-REGISTRY.md`: a section's
 * document list and consolidated search are two views over one set of records,
 * never two places to file the same thing.
 */
function DocumentsPage() {
  const { definitions, records } = useForms();
  const registry = useRegistry();
  const [registering, setRegistering] = useState(false);
  /* Live details from Drive for Drive documents, where Drive is connected. */
  const drive = useDriveDetails(registry.recent);

  return (
    <Page>
      <PageHeader
        title="Documents & Forms"
        description="Where the ministry's reusable forms, guides and reference material are kept."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setRegistering(true)}>
              <Plus className="size-3.5" aria-hidden />
              Register document
            </Button>
            <Link to="/forms" className={buttonVariants({ variant: "primary" })}>
              <Plus className="size-3.5" aria-hidden />
              Create form
            </Link>
          </>
        }
      />

      <div className="space-y-4">
        {registering ? <RegisterDocument onDone={() => setRegistering(false)} /> : null}
        <Section
          title="Ministry forms"
          meta={`${definitions.length}`}
          action={
            <Link
              to="/forms"
              className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Open form library
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {definitions.slice(0, 5).map((definition) => (
              <li key={definition.id} className="row-quiet">
                <Link
                  to="/forms/$formId"
                  params={{ formId: definition.id }}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{definition.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      v{definition.version} ·{" "}
                      {records.filter((r) => r.formDefinitionId === definition.id).length} records
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Reference documents"
          meta={registry.status === "ready" ? `${registry.total}` : ""}
          action={
            /* One search implementation, several entry points — this is the
               same page the sidebar offers, arriving pre-filtered. */
            <Link
              to="/resource-search"
              search={{}}
              className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Open document index
            </Link>
          }
        >
          {registry.status === "loading" ? (
            <ListSkeleton rows={3} />
          ) : registry.status === "error" ? (
            <ErrorState title="The document index could not be read" onRetry={registry.retry}>
              Nothing is lost. This is a problem reaching the binder's index.
            </ErrorState>
          ) : registry.recent.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted-foreground">
              Nothing registered yet. Registering a document tells the binder it exists and where it
              lives; the document itself stays where it is.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {registry.recent.map((resource) => {
                const details = drive.get(resource.id);
                const live = driveLine(details);
                return (
                  <li key={resource.id} className="flex items-center gap-3 px-4 py-2.5">
                    {details?.available ? (
                      <DriveFileIcon mimeType={details.file.mimeType} />
                    ) : (
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{resource.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {[resource.kind, resource.provider].filter(Boolean).join(" · ")}
                      </span>
                      {live ? (
                        <span className="block truncate text-[12px] text-area-ink">
                          In Drive: {live}
                        </span>
                      ) : null}
                    </span>
                    {/* Opening leaves the binder, and whoever keeps the document
                        decides whether it opens — so the row says where it goes
                        rather than implying the binder holds it. */}
                    {resource.openUrl ? (
                      <a
                        href={resource.openUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[13px] text-primary transition-colors hover:text-primary/80"
                      >
                        {resource.driveFileId ? "Open in Drive" : "Open"}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : resource.openRoute ? (
                      <Link
                        to={resource.openRoute}
                        className="shrink-0 text-[13px] text-primary transition-colors hover:text-primary/80"
                      >
                        Open
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <div className="rounded-lg border border-dashed border-border-strong bg-surface-muted px-5 py-5">
          <div className="flex items-start gap-3">
            <FileWarning className="mt-0.5 size-5 shrink-0 text-status-waiting" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-[15px] font-medium">Volunteer Forms</h2>
              <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
                Named in the binder spine, but its physical pages have not been supplied. The
                generic form builder can already express volunteer forms — how this section
                organizes them, and what those forms actually ask, comes from the real pages.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
