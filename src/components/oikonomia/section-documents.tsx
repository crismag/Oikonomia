import { Link } from "@tanstack/react-router";
import { ExternalLink, FolderOpen } from "lucide-react";
import { useState } from "react";

import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useResourceSearch } from "./resource-search-provider";
import { documentHref, openableUrl } from "@/domain/document-record";
import type { BinderSection } from "@/domain/types";

/**
 * The documents filed in one section of the binder.
 *
 * One set of records, several entry points: this is the same registry
 * `/resource-search` reads, arriving pre-filtered. A section never keeps its
 * own copy — that was the model this replaced, where each section listed
 * documents compiled into the application and the registry knew nothing about
 * them.
 *
 * A section with nothing registered says so, because that is what a binder
 * section nobody has filed anything in looks like.
 */
export function SectionDocuments({
  section,
  emptyLabel,
}: {
  section: BinderSection;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const store = useResourceSearch({ section, query, page: 1 });
  const results = store.page.items;

  if (store.status === "loading") return <ListSkeleton rows={3} />;
  if (store.status === "error") {
    return (
      <ErrorState title="The documents could not be read" onRetry={store.retry}>
        Nothing is lost. This is a problem reaching the binder's index.
      </ErrorState>
    );
  }

  return (
    <div>
      <label className="mb-3 flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 sm:max-w-xs">
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Search documents</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {results.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((resource) => (
              <li key={resource.id} className="row-quiet">
                <span className="flex items-center gap-3 px-4 py-2.5">
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Link {...documentHref(resource.id)} className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] hover:underline">
                      {resource.title}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {resource.associations
                        .map((a) => a.label)
                        .filter(Boolean)
                        .join(" · ") ||
                        [resource.kind, resource.provider].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                  {openableUrl(resource.openUrl) ? (
                    <a
                      href={openableUrl(resource.openUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary"
                    >
                      Open
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">{resource.title}, opens in a new tab</span>
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
