import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { ListToolbar, ResultCount } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Section } from "@/components/oikonomia/section";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { dayLabel } from "@/domain/lifegroup";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Oikonomia" },
      {
        name: "description",
        content: "Participation as it was actually marked, at the gatherings that marked it.",
      },
    ],
  }),
  component: AttendancePage,
});

/**
 * Attendance is a **reading of marks made elsewhere**, never a second store.
 *
 * A gathering's leader marks who came, at the gathering. This page adds those
 * marks up. It deliberately shows only contexts that really record attendance
 * — LifeGroup gatherings — rather than presenting services and events as
 * though somebody were counting them. When that capture exists, its records
 * appear here because they are the same records.
 */
function AttendancePage() {
  const { campuses, venues } = useOrganization();
  const [query, setQuery] = useState("");
  const store = useLifegroup();

  if (store.status === "loading") {
    return (
      <Page>
        <ListSkeleton rows={5} />
      </Page>
    );
  }
  if (store.status === "error") {
    return (
      <Page>
        <ErrorState title="Attendance could not be loaded" onRetry={store.retry}>
          Nothing is lost. This is a problem reaching the marks.
        </ErrorState>
      </Page>
    );
  }

  /* One occasion per gathering that has marks. A gathering nobody marked is
     not a gathering with nobody present — it is one nobody counted, and it is
     left out rather than reported as a zero. */
  const occasions = store.gatherings
    .map((gathering) => {
      const marks = store.attendance.filter((mark) => mark.gatheringId === gathering.id);
      const venue = gathering.venueName ?? venues.find((v) => v.id === gathering.venueId)?.name;
      const campus = campuses.find((c) => c.id === gathering.campusId);
      return {
        gathering,
        marks,
        present: marks.filter((m) => m.status === "present").length,
        firstTime: marks.filter((m) => m.status === "present" && m.firstTime).length,
        where: venue ?? campus?.name ?? "Venue not set",
        campusName: campus?.name,
      };
    })
    .filter((occasion) => occasion.marks.length > 0)
    .sort((a, b) => b.gathering.date.localeCompare(a.gathering.date));

  const q = query.trim().toLowerCase();
  const visible = occasions.filter(
    (occasion) =>
      !q ||
      occasion.where.toLowerCase().includes(q) ||
      dayLabel(occasion.gathering.date).toLowerCase().includes(q),
  );

  const present = visible.reduce((sum, o) => sum + o.present, 0);
  const firstTime = visible.reduce((sum, o) => sum + o.firstTime, 0);

  return (
    <Page>
      <PageHeader
        title="Attendance"
        description="Marked at the gathering, read here. Only LifeGroup gatherings record participation today; services and events do not, so nothing is shown for them."
      />

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search occasions" />

      <ResultCount shown={visible.length} total={occasions.length} noun="occasions" />

      <Section
        title="Recorded participation"
        meta={
          visible.length > 0
            ? `${present} present${firstTime > 0 ? ` · ${firstTime} first time` : ""}`
            : undefined
        }
      >
        {visible.length > 0 ? (
          <ul className="divide-y divide-border">
            {visible.map((occasion) => (
              <li key={occasion.gathering.id} className="row-quiet">
                <Link
                  to="/lifegroups/$gatheringId"
                  params={{ gatheringId: occasion.gathering.id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">{occasion.where}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {dayLabel(occasion.gathering.date)}
                      {occasion.campusName ? ` · ${occasion.campusName}` : ""} · LifeGroup
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-medium tabular-nums">
                      {occasion.present}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      of {occasion.marks.length} marked
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nothing has been marked yet">
            Attendance is taken inside a gathering. Open one and mark who came, and the occasion
            appears here.
          </EmptyState>
        )}
      </Section>
    </Page>
  );
}
