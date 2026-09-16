import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { UsersRound } from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { FilterChip, ListToolbar } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { PersonAvatar, PersonStack } from "@/components/oikonomia/person";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { goalCounts, goalsForYear, ministryGoals } from "@/domain/goals";
import { useGoals } from "@/components/oikonomia/goals-provider";
import { useFiledDocuments } from "@/components/oikonomia/filed-documents";
import { relationshipLabel, relationshipTo } from "@/domain/ministry";
import { useViewer } from "@/domain/session";
import type { Ministry, MinistryRelationship } from "@/domain/types";

export const Route = createFileRoute("/ministries/")({
  head: () => ({
    meta: [
      { title: "Ministries — Oikonomia" },
      {
        name: "description",
        content: "Ministries connected to your work, and the information they hold.",
      },
    ],
  }),
  component: MinistriesIndex,
});

/**
 * Ministries landing.
 *
 * A ministry is an organizational working area that owns its information, not
 * a reporting category. The four ways a leader can stand in relation to one —
 * leading it, serving in it, having its information shared, and simply being
 * able to see it exists — are graded by prominence rather than labelled with
 * competing badges: the ones you work in are cards, the rest are quiet rows.
 */
function MinistriesIndex() {
  const { campuses, ministries } = useOrganization();
  const { person } = useViewer();
  const { goals } = useGoals();
  const [query, setQuery] = useState("");
  const [campusId, setCampusId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (ministry: Ministry) => {
    if (campusId && ministry.campusId !== campusId) return false;
    if (!q) return true;
    return ministry.name.toLowerCase().includes(q) || ministry.purpose.toLowerCase().includes(q);
  };

  const visible = ministries.filter(matches);
  const relation = (m: Ministry) => relationshipTo(m, person.id);

  const working = visible.filter((m) => relation(m) === "lead" || relation(m) === "participate");
  const shared = visible.filter((m) => relation(m) === "shared");
  const others = visible.filter((m) => relation(m) === "none");

  return (
    <Page>
      <PageHeader title="Ministries" description="Where each ministry keeps its own work." />

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search ministries">
        <FilterChip active={campusId === null} onClick={() => setCampusId(null)}>
          All campuses
        </FilterChip>
        {campuses.map((campus) => (
          <FilterChip
            key={campus.id}
            active={campusId === campus.id}
            onClick={() => setCampusId(campusId === campus.id ? null : campus.id)}
          >
            {campus.name}
          </FilterChip>
        ))}
      </ListToolbar>

      {working.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {working.map((ministry) => (
            <MinistryCard
              key={ministry.id}
              ministry={ministry}
              relationship={relation(ministry)}
              goalTally={goalCounts(
                ministryGoals(goalsForYear(goals, new Date().getFullYear()), ministry.id),
              )}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={UsersRound} title="No ministries match that search" />
        </div>
      )}

      <QuietGroup
        title="Shared with you"
        note="Information other leaders have shared with you."
        ministries={shared}
      />
      <QuietGroup title="Other ministries" ministries={others} />
    </Page>
  );
}

/**
 * A ministry the leader works in.
 *
 * Leading is the only relationship given colour; serving in one is stated in
 * the same quiet voice as the campus, because a badge wall would make three
 * ministries look like an inbox.
 */
function MinistryCard({
  ministry,
  relationship,
  goalTally,
}: {
  ministry: Ministry;
  relationship: MinistryRelationship;
  goalTally: { total: number; active: number };
}) {
  const { campuses } = useOrganization();
  /* What is actually filed here, asked of the registry. The count used to come
     from a fixture list, so a ministry nobody had filed anything under still
     advertised documents. */
  const filed = useFiledDocuments("ministry", ministry.id);
  const documentCount = filed.documents.length;
  const campus = campuses.find((c) => c.id === ministry.campusId);

  const counts = [
    documentCount > 0 ? `${documentCount} ${documentCount === 1 ? "document" : "documents"}` : null,
    goalTally.total > 0 ? `${goalTally.total} goals` : null,
  ].filter(Boolean);

  return (
    <li>
      <Link
        to="/ministries/$ministryId"
        params={{ ministryId: ministry.id }}
        className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted"
      >
        <div className="mb-4">
          <h2 className="text-[15px] font-medium">{ministry.name}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {campus?.name}
            {relationship === "participate" ? ` · ${relationshipLabel.participate}` : ""}
          </p>

          {relationship === "lead" ? (
            <p className="mt-2 text-[13px] text-sidebar-accent-foreground">
              You lead this ministry
            </p>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-2.5">
          <span className="text-[12px] text-muted-foreground">
            {counts.length > 0 ? counts.join(" · ") : "Nothing filed yet"}
          </span>
          <PersonStack personIds={[ministry.leadId, ...ministry.teamIds].filter(Boolean)} max={3} />
        </div>
      </Link>
    </li>
  );
}

/** Ministries the leader can see but does not work in — deliberately quiet. */
function QuietGroup({
  title,
  note,
  ministries: list,
}: {
  title: string;
  note?: string;
  ministries: Ministry[];
}) {
  const { campuses } = useOrganization();
  if (list.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
      {note ? <p className="mb-2 text-[12px] text-muted-foreground">{note}</p> : null}
      <ul
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-surface",
          !note && "mt-2",
        )}
      >
        {list.map((ministry) => {
          const campus = campuses.find((c) => c.id === ministry.campusId);
          return (
            <li key={ministry.id} className="row-quiet border-b border-border last:border-b-0">
              <Link
                to="/ministries/$ministryId"
                params={{ ministryId: ministry.id }}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                {/* A ministry can exist before anyone leads it, so an empty
                    lead shows as no avatar rather than as an unknown person. */}
                {ministry.leadId ? <PersonAvatar personId={ministry.leadId} size="sm" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{ministry.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {campus?.name}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
