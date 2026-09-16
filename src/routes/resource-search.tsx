import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Pagination } from "@/components/oikonomia/pagination";
import { PersonName } from "@/components/oikonomia/person";
import { useResourceSearch } from "@/components/oikonomia/resource-search-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { contextPath, sectionLabel } from "@/domain/resources";
import { fromISO } from "@/domain/schedule";
import { format } from "date-fns";
import type { BinderSection, ResourceSearchResult, ResourceSort } from "@/domain/types";

type SearchState = {
  q?: string;
  section?: BinderSection;
  related?: string;
  tag?: string;
  by?: string;
  sort?: ResourceSort;
  page?: number;
};

/** A patch may clear a filter, which `Partial<T>` alone cannot express. */
type SearchPatch = { [K in keyof SearchState]?: SearchState[K] | undefined };

export const Route = createFileRoute("/resource-search")({
  /* Search state lives in the URL so Back works, a search can be bookmarked,
     and other pages can deep-link into a filtered view. */
  validateSearch: (search: Record<string, unknown>): SearchState => {
    const str = (key: string) =>
      typeof search[key] === "string" && search[key] ? (search[key] as string) : undefined;
    const page = Number(search["page"]);
    const sorts: ResourceSort[] = ["relevance", "updated", "title"];
    const sort = sorts.includes(search["sort"] as ResourceSort)
      ? (search["sort"] as ResourceSort)
      : undefined;
    return {
      ...(str("q") ? { q: str("q")! } : {}),
      ...(str("section") ? { section: str("section") as BinderSection } : {}),
      ...(str("related") ? { related: str("related")! } : {}),
      ...(str("tag") ? { tag: str("tag")! } : {}),
      ...(str("by") ? { by: str("by")! } : {}),
      ...(sort ? { sort } : {}),
      ...(Number.isFinite(page) && page > 1 ? { page: Math.floor(page) } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Resource Search — Oikonomia" },
      {
        name: "description",
        content: "Find documents, forms, links and reference materials across the workspace.",
      },
    ],
  }),
  component: ResourceSearchPage,
});

const sortLabel: Record<ResourceSort, string> = {
  relevance: "Relevance",
  updated: "Recently updated",
  title: "Title A–Z",
};

/**
 * Resource Search.
 *
 * "I know we have this somewhere." The page is built for search → refine →
 * recognize → open, and for nothing else: no dashboard, no statistics, no
 * folders, no creation. Resources arrive here because a working area referenced
 * them; this page finds them and hands the leader back to wherever they live.
 *
 * Everything rendered comes from the provider, which has already applied the
 * viewer. A resource this person may not discover never reaches this file.
 */
function ResourceSearchPage() {
  const { personById } = useOrganization();
  const state = Route.useSearch();
  const navigate = useNavigate();
  /* Typing is local so each keystroke does not push a history entry, and so
     that a result set is not requested per character; the URL catches up a
     moment after the field settles, and the URL is what is searched. */
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? state.q ?? "";

  const store = useResourceSearch({
    query: state.q,
    section: state.section,
    relatedLabel: state.related,
    tag: state.tag,
    addedById: state.by,
    sort: state.sort,
    page: state.page,
  });
  const page = store.page;

  /* A search is a navigation, but one per keystroke would fill the history and
     ask the server a question the leader has not finished asking. */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const goToPage = (n: number) => {
    const next: Record<string, unknown> = { ...state, page: n > 1 ? n : undefined };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    void navigate({ to: "/resource-search", search: next as SearchState });
  };
  const options = store.options;

  /* Cleared filters leave the URL entirely rather than lingering as empty
     parameters, so a shared link carries exactly the search it describes. */
  const set = (patch: SearchPatch, replace = false) => {
    /* Refining a search restarts it: page 3 of the old results names nothing
       in the new ones. Only `goToPage` below is allowed to keep a page. */
    const next: Record<string, unknown> = { ...state, page: undefined, ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    void navigate({ to: "/resource-search", search: next as SearchState, replace });
  };

  const clearAll = () => {
    setTyped(null);
    void navigate({ to: "/resource-search", search: {} });
  };

  const active = [
    state.section
      ? {
          key: "section",
          label: sectionLabel[state.section],
          clear: () => set({ section: undefined }),
        }
      : null,
    state.related
      ? { key: "related", label: state.related, clear: () => set({ related: undefined }) }
      : null,
    state.tag ? { key: "tag", label: `#${state.tag}`, clear: () => set({ tag: undefined }) } : null,
    state.by
      ? {
          key: "by",
          label: personById(state.by)?.name ?? "Someone",
          clear: () => set({ by: undefined }),
        }
      : null,
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const sort = state.sort ?? (query.trim() ? "relevance" : "updated");
  const searching = !!query.trim() || active.length > 0;

  return (
    <Page>
      <PageHeader
        title="Resource Search"
        description="Find documents, forms, links and reference materials across your leadership workspace."
      />

      <label className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface shadow-card px-3 py-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Search resources</span>
        <input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setTyped(next);
            if (settle.current) clearTimeout(settle.current);
            settle.current = setTimeout(() => set({ q: next || undefined }, true), 350);
          }}
          onBlur={() => {
            if (typed !== null) set({ q: typed || undefined });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ q: query || undefined });
            if (e.key === "Escape") {
              setTyped("");
              set({ q: undefined });
            }
          }}
          placeholder="Search resources…"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setTyped("");
              set({ q: undefined });
            }}
            aria-label="Clear search"
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <FilterMenu
            label="Related to"
            active={!!state.section || !!state.related}
            options={options}
            onSection={(section) => set({ section, related: undefined })}
            onRelated={(related) => set({ related, section: undefined })}
          />
          <TagMenu tags={options.tags} value={state.tag} onChange={(tag) => set({ tag })} />
          <PeopleMenu people={options.people} value={state.by} onChange={(by) => set({ by })} />
        </div>

        <MobileFilters
          state={state}
          options={options}
          onSection={(section) => set({ section, related: undefined })}
          onRelated={(related) => set({ related, section: undefined })}
          onTag={(tag) => set({ tag })}
          onBy={(by) => set({ by })}
          resultCount={page.total}
        />

        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="sr-only">Sort results</span>
          <select
            value={sort}
            onChange={(e) => set({ sort: e.target.value as ResourceSort })}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none"
          >
            {(["relevance", "updated", "title"] as ResourceSort[]).map((option) => (
              <option key={option} value={option}>
                {sortLabel[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {active.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {active.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-area-soft px-2 py-1 text-[12px] text-area-ink transition-colors hover:bg-area-soft/70"
            >
              {chip.label}
              <X className="size-3" aria-hidden />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {/* While searching, the pager's own live summary is the count; two would
          announce twice and disagree the moment paging is involved. */}
      {searching ? null : (
        <p className="mt-3 text-[12px] text-muted-foreground">Recent resources</p>
      )}

      <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {store.status === "loading" ? (
          <ListSkeleton rows={5} />
        ) : store.status === "error" ? (
          /* An empty list and an unreachable one look identical, and only one
             of them means "we do not have this". */
          <ErrorState title="Resources could not be searched" onRetry={store.retry}>
            Nothing is lost. This is a problem reaching the binder's index.
          </ErrorState>
        ) : page.items.length > 0 ? (
          <ul className="divide-y divide-border">
            {page.items.map((resource) => (
              <ResultRow key={resource.id} resource={resource} query={query} />
            ))}
          </ul>
        ) : searching ? (
          <EmptyState
            icon={Search}
            title={query.trim() ? `No resources found for "${query.trim()}"` : "No resources found"}
            action={
              active.length > 0 ? (
                <Button type="button" onClick={clearAll} variant="secondary">
                  Clear filters
                </Button>
              ) : null
            }
          >
            {active.length > 0 ? "Try another search, or remove a filter." : "Try another search."}
          </EmptyState>
        ) : (
          <EmptyState icon={Search} title="Nothing to show yet">
            Resources appear here once a working area references them, or once one is registered in
            Documents &amp; Forms.
          </EmptyState>
        )}
      </div>

      {store.status === "ready" ? (
        <Pagination window={page} onPage={goToPage} noun="result" />
      ) : null}
    </Page>
  );
}

/* ---------------------------------------------------------------- result */

/**
 * One resource.
 *
 * Title, description and context are the recognition information — search runs
 * on registered metadata, so a leader must be able to tell from these alone
 * whether this is the thing they meant, without opening it.
 */
function ResultRow({ resource, query }: { resource: ResourceSearchResult; query: string }) {
  const [expanded, setExpanded] = useState(false);
  const contexts = resource.associations;
  const shown = expanded ? contexts : contexts.slice(0, 2);
  const hidden = contexts.length - shown.length;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        {/* A result is a list item, not a section. Twenty-seven sibling
            headings make a screen reader's outline useless; the list
            structure already provides the navigation. */}
        <p className="min-w-0 flex-1 text-[15px] font-medium">
          <Highlight text={resource.title} query={query} />
        </p>
        <Open resource={resource} />
      </div>

      {resource.description ? (
        <p className="mt-0.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          <Highlight text={resource.description} query={query} />
        </p>
      ) : null}

      {contexts.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          {shown.map((association, i) => (
            <span key={`${association.section}-${association.label ?? i}`}>
              {contextPath(association)}
            </span>
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              +{hidden} more
            </button>
          ) : null}
        </p>
      ) : null}

      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
        {resource.tags.length > 0 ? (
          <span>{resource.tags.map((t) => `#${t}`).join(" ")}</span>
        ) : null}
        {resource.kind ? <span>{resource.kind}</span> : null}
        {/* Secondary on purpose: it answers "what happens when I open this?",
            never "where should I look?". */}
        {resource.provider ? <span>{resource.provider}</span> : null}
        {resource.addedById ? (
          <span>
            <PersonName personId={resource.addedById} />
          </span>
        ) : null}
        <span className="ml-auto">
          Updated{" "}
          {resource.updatedAt
            ? format(fromISO(resource.updatedAt.slice(0, 10)), "d MMM")
            : (resource.updatedLabel ?? "recently")}
        </span>
      </p>
    </li>
  );
}

/**
 * Opening.
 *
 * Appearing in search means the metadata may be shown; it is not a promise
 * that the resource opens. External destinations decide that for themselves,
 * which is the point of the second boundary.
 */
function Open({ resource }: { resource: ResourceSearchResult }) {
  const className =
    "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors hover:bg-muted";

  if (resource.openUrl) {
    return (
      <a href={resource.openUrl} target="_blank" rel="noreferrer" className={className}>
        Open
        <ExternalLink className="size-3.5" aria-hidden />
        <span className="sr-only">{resource.title}, opens in a new tab</span>
      </a>
    );
  }

  if (resource.openRoute) {
    return (
      <Link to={resource.openRoute} className={className}>
        Open<span className="sr-only"> {resource.title}</span>
      </Link>
    );
  }

  return null;
}

/** Highlights only what search actually matched — never invented snippets. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-area-soft text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/* --------------------------------------------------------------- filters */

type Options = ReturnType<typeof useResourceSearch>["options"];

/**
 * Related to — the filter that matters most.
 *
 * Sections first, then the specific records within them, because a leader
 * narrows by where the work happened rather than by where bytes are stored.
 */
function FilterMenu({
  label,
  active,
  options,
  onSection,
  onRelated,
}: {
  label: string;
  active: boolean;
  options: Options;
  onSection: (section: BinderSection) => void;
  onRelated: (related: string) => void;
}) {
  const [open, setOpen] = useState(false);
  let lastSection: BinderSection | undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
          active ? "border-primary/30 text-foreground" : "border-border text-muted-foreground",
        )}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-1.5">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Section</p>
        {options.sections.map(({ section, count }) => (
          <button
            key={section}
            type="button"
            onClick={() => {
              setOpen(false);
              onSection(section);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate">{sectionLabel[section]}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
          </button>
        ))}

        {options.related.length > 0 ? (
          <>
            {options.related.map((entry) => {
              const heading = entry.section !== lastSection;
              lastSection = entry.section;
              return (
                <div key={`${entry.section}-${entry.label}`}>
                  {heading ? (
                    <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                      {sectionLabel[entry.section]}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onRelated(entry.label);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {entry.count}
                    </span>
                  </button>
                </div>
              );
            })}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TagMenu({
  tags,
  value,
  onChange,
}: {
  tags: Options["tags"];
  value?: string | undefined;
  onChange: (tag: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  if (tags.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
          value ? "border-primary/30 text-foreground" : "border-border text-muted-foreground",
        )}
      >
        Tags
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-52 overflow-y-auto p-1.5">
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            onClick={() => {
              setOpen(false);
              onChange(value === tag ? undefined : tag);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate">#{tag}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PeopleMenu({
  people,
  value,
  onChange,
}: {
  people: Options["people"];
  value?: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const { personById } = useOrganization();
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "rounded-md border px-2.5 py-1.5 text-[13px] transition-colors",
          value ? "border-primary/30 text-foreground" : "border-border text-muted-foreground",
        )}
      >
        Added by
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-52 overflow-y-auto p-1.5">
        {people.map(({ id, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setOpen(false);
              onChange(value === id ? undefined : id);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate">{personById(id)?.name ?? "Unknown"}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** On a narrow screen every filter collapses behind one control. */
function MobileFilters({
  state,
  options,
  onSection,
  onRelated,
  onTag,
  onBy,
  resultCount,
}: {
  state: SearchState;
  options: Options;
  onSection: (section: BinderSection) => void;
  onRelated: (related: string) => void;
  onTag: (tag: string | undefined) => void;
  onBy: (id: string | undefined) => void;
  resultCount: number;
}) {
  const { personById } = useOrganization();
  const [open, setOpen] = useState(false);
  const count = [state.section, state.related, state.tag, state.by].filter(Boolean).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted sm:hidden">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {count > 0 ? (
          <span className="rounded-full bg-area-soft px-1.5 text-[11px] text-area-ink">
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-96 w-72 overflow-y-auto p-2">
        <p className="px-1 pb-1 text-[13px] font-medium">Filter resources</p>

        <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Related to</p>
        {options.sections.map(({ section, count: n }) => (
          <button
            key={section}
            type="button"
            onClick={() => {
              setOpen(false);
              onSection(section);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <span className="min-w-0 flex-1 truncate">{sectionLabel[section]}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{n}</span>
          </button>
        ))}

        {options.related.length > 0 ? (
          <>
            <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Specific</p>
            {options.related.map((entry) => (
              <button
                key={`${entry.section}-${entry.label}`}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onRelated(entry.label);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{entry.count}</span>
              </button>
            ))}
          </>
        ) : null}

        {options.tags.length > 0 ? (
          <>
            <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Tags</p>
            <div className="flex flex-wrap gap-1.5 px-1">
              {options.tags.map(({ tag }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onTag(state.tag === tag ? undefined : tag);
                  }}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[12px] transition-colors",
                    state.tag === tag
                      ? "border-primary/30 bg-area-soft text-area-ink"
                      : "border-border text-muted-foreground",
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {options.people.length > 0 ? (
          <>
            <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Added by</p>
            {options.people.map(({ id }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onBy(state.by === id ? undefined : id);
                }}
                className="flex w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
              >
                {personById(id)?.name ?? "Unknown"}
              </button>
            ))}
          </>
        ) : null}

        <p className="px-1 pt-3 text-[12px] text-muted-foreground">
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
