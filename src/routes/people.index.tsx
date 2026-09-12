import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { UserSearch } from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { FilterChip, ListToolbar } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Pagination } from "@/components/oikonomia/pagination";
import { PersonAvatar } from "@/components/oikonomia/person";
import { paginate } from "@/domain/pagination";
import { useOrganization } from "@/components/oikonomia/organization-provider";

/** Search, campus and page all live in the URL, so a directory lookup is shareable. */
type SearchState = { q?: string; campus?: string; page?: number };
type SearchPatch = { [K in keyof SearchState]?: SearchState[K] | undefined };

function clean(patch: SearchPatch): SearchState {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as SearchState;
}

export const Route = createFileRoute("/people/")({
  validateSearch: (search: Record<string, unknown>): SearchState => {
    const str = (key: string) =>
      typeof search[key] === "string" && search[key] ? (search[key] as string) : undefined;
    const page = Number(search["page"]);
    return {
      ...(str("q") ? { q: str("q")! } : {}),
      ...(str("campus") ? { campus: str("campus")! } : {}),
      ...(Number.isFinite(page) && page > 1 ? { page: Math.floor(page) } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "People — Oikonomia" },
      {
        name: "description",
        content: "Canonical person identity and the church context each person belongs to.",
      },
    ],
  }),
  component: PeopleIndex,
});

/**
 * People directory.
 *
 * A dense list is right here — the job is finding someone. Person detail is
 * where context takes over. People owns identity only; ministry membership and
 * campus are shown as references, never re-recorded.
 */
function PeopleIndex() {
  const { campuses, ministries, people } = useOrganization();
  const state = Route.useSearch();
  const navigate = useNavigate();

  const query = state.q ?? "";
  const campusId = state.campus ?? null;

  /* Narrowing the directory resets the page; page 4 of the old list means nothing. */
  const patch = (next: SearchPatch) =>
    navigate({
      to: "/people",
      search: clean({ ...state, page: undefined, ...next }),
      replace: true,
    });

  const setQuery = (v: string) => patch({ q: v || undefined });
  const setCampusId = (v: string | null) => patch({ campus: v ?? undefined });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((person) => {
      if (campusId && person.campusId !== campusId) return false;
      if (!q) return true;
      return person.name.toLowerCase().includes(q) || person.role.toLowerCase().includes(q);
    });
  }, [people, query, campusId]);

  const page = paginate(visible, state.page ?? 1);

  return (
    <Page>
      <PageHeader
        title="People"
        description="One canonical record per person. Ministries, attendance and Reach-Out reference these records rather than keeping their own."
      />

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search people by name or role">
        <FilterChip active={campusId === null} onClick={() => setCampusId(null)}>
          All campuses
        </FilterChip>
        {campuses.map((campus) => (
          <FilterChip
            key={campus.id}
            active={campusId === campus.id}
            onClick={() => setCampusId(campusId === campus.id ? null : campus.id)}
            count={people.filter((p) => p.campusId === campus.id).length}
          >
            {campus.name}
          </FilterChip>
        ))}
      </ListToolbar>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {page.items.length > 0 ? (
          <ul className="divide-y divide-border">
            {page.items.map((person) => {
              const campus = campuses.find((c) => c.id === person.campusId);
              const memberships = person.ministryIds
                .map((id) => ministries.find((m) => m.id === id)?.name)
                .filter((name): name is string => Boolean(name));

              return (
                <li key={person.id} className="row-quiet">
                  <Link
                    to="/people/$personId"
                    params={{ personId: person.id }}
                    className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
                  >
                    <PersonAvatar personId={person.id} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{person.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {/* Some roles already name their campus; do not say it twice. */}
                        {person.role}
                        {campus && !person.role.includes(campus.name) ? ` · ${campus.name}` : ""}
                      </span>
                    </span>
                    <span className="hidden min-w-0 max-w-[40%] shrink truncate text-right text-[12px] text-muted-foreground md:block">
                      {memberships.join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={UserSearch} title="No one matches that search">
            Try a different name, role or campus.
          </EmptyState>
        )}
      </div>

      <Pagination
        window={page}
        onPage={(n) =>
          navigate({
            to: "/people",
            search: clean({ ...state, page: n > 1 ? n : undefined }),
            replace: true,
          })
        }
        noun="person"
        plural="people"
      />
    </Page>
  );
}
