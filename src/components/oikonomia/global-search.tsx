import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { useReports } from "@/components/oikonomia/report-provider";
import { cn } from "@/lib/utils";
import { globalSearch, kindLabel, type GlobalResult } from "@/domain/global-search";
import { useOrganization } from "./organization-provider";
import { useResourceSearch } from "@/components/oikonomia/resource-search-provider";
import { useViewer } from "@/domain/session";

/**
 * The application's global search.
 *
 * It answers "take me to the thing I am thinking of" — a person, a ministry, a
 * report, a resource, or a page. For refining rather than jumping, it hands the
 * query to Resource Search.
 *
 * Everything it offers has already been authorized by the module that owns it,
 * so a record the viewer may not discover never appears here either.
 */
export function GlobalSearch() {
  const organization = useOrganization();
  const { persona, person } = useViewer();
  const reports = useReports();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /* The "/" hint in the field is a promise; this keeps it. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Clicking elsewhere closes the list without discarding what was typed. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /*
   * Resources come from the registry rather than from this file, so the palette
   * and Resource Search can never disagree about what exists or about who may
   * know it does. Two letters is where the registry starts being asked.
   */
  const resources = useResourceSearch({
    query: query.trim().length >= 2 ? query.trim() : undefined,
  });
  const results = globalSearch(
    query,
    persona,
    person,
    reports.visible,
    query.trim().length >= 2 ? resources.page.items : [],
    { people: organization.people, ministries: organization.ministries },
  );

  const go = (result: GlobalResult) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    void navigate({ to: result.to, ...(result.search ? { search: result.search } : {}) });
  };

  /** Enter with nothing chosen means "show me everything about this". */
  const seeAll = () => {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    void navigate({ to: "/resource-search", search: { q } });
  };

  let lastKind: GlobalResult["kind"] | undefined;

  return (
    <div ref={boxRef} className="relative hidden min-w-0 md:block">
      <label className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Search Oikonomia</span>
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="global-search-results"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const chosen = open ? results[active] : undefined;
              if (chosen) go(chosen);
              else seeAll();
            }
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          placeholder="Search people, ministries, reports…"
        />
        <kbd className="shrink-0 rounded-sm border border-border bg-surface px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
          /
        </kbd>
      </label>

      {open && query.trim().length >= 2 ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-md"
        >
          {results.length > 0 ? (
            results.map((result, i) => {
              const heading = result.kind !== lastKind;
              lastKind = result.kind;
              return (
                <div key={`${result.kind}-${result.id}`}>
                  {heading ? (
                    <p className="px-3 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">
                      {kindLabel[result.kind]}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(result)}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left transition-colors",
                      i === active ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <span className="block truncate text-[13px]">{result.label}</span>
                    {result.detail ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {result.detail}
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          )}

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={seeAll}
            className="mt-1 block w-full border-t border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Search resources for “{query.trim()}”
          </button>
        </div>
      ) : null}
    </div>
  );
}
