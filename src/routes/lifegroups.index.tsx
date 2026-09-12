import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { EmptyState } from "@/components/oikonomia/empty-state";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { ScheduleCard, ScheduleRow } from "@/components/oikonomia/schedule-row";
import { Section } from "@/components/oikonomia/section";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { errorMessage } from "@/lib/calendar-client";
import { canAmendGathering, canJoinGathering, canScheduleGathering } from "@/domain/authorize";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useViewer } from "@/domain/session";
import { toISO, weekOf } from "@/domain/schedule";
import { addDays } from "date-fns";

export const Route = createFileRoute("/lifegroups/")({
  head: () => ({
    meta: [
      { title: "LifeGroup — Oikonomia" },
      {
        name: "description",
        content:
          "The shared LifeGroup schedule: the week's gatherings, who is leading each, and what still needs a leader.",
      },
    ],
  }),
  component: LifegroupSchedule,
});

/**
 * The LifeGroup schedule — a shared workspace, not a form.
 *
 * This is the first place in Oikonomia that is neither "my document" nor "my
 * report" but a **collaborative operational record**: several leaders prepare
 * the week together, usually while the poll is going round, and then whoever
 * can lead an evening claims it.
 *
 * So the table is the interface. Adding a schedule adds a **row**, not a form
 * to complete; a row may sit there saying "leader needed" with nothing else
 * settled, because that is a real state of a roster. Details are typed in where
 * they are read, and the things that do not belong in a table — the address,
 * the poll, attendance, what happened — live behind the gathering it becomes.
 *
 * **Assignment grants responsibility, not ownership.** A claimed row stays part
 * of this shared schedule, which is what lets somebody else pick it up when a
 * leader steps away.
 */
function LifegroupSchedule() {
  const { venues: allVenues } = useOrganization();
  const viewer = useViewer();
  const { person } = viewer;
  const store = useLifegroup();
  const today = toISO(new Date());

  const [failure, setFailure] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);

  const maySchedule = canScheduleGathering(viewer);

  /* The roster runs forward from the start of this week: the weeks already
     recorded are history, and this page is for the week being prepared. */
  const from = weekOf(today);
  const upcoming = useMemo(
    () =>
      [...store.gatherings]
        .filter((g) => g.date >= from)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""),
        ),
    [store.gatherings, from],
  );

  const past = useMemo(
    () =>
      [...store.gatherings]
        .filter((g) => g.date < from)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [store.gatherings, from],
  );

  const addRow = async () => {
    setAdding(true);
    setFailure(null);
    try {
      /*
       * A date and nothing else. Next open evening after the last row, so
       * adding several in a row does not mean retyping the date each time.
       */
      const last = upcoming.at(-1)?.date ?? today;
      await store.addGathering({ date: toISO(addDays(new Date(`${last}T00:00:00`), 7)) });
    } catch (error) {
      setFailure(error);
    } finally {
      setAdding(false);
    }
  };

  const addButton = maySchedule ? (
    <Button type="button" variant="secondary" onClick={() => void addRow()} disabled={adding}>
      <Plus className="size-3.5" aria-hidden />
      Add schedule
    </Button>
  ) : null;

  return (
    <Page>
      <PageHeader
        title="LifeGroup"
        description="The shared schedule. Add the week's gatherings, claim what you can lead, and fill in the details together."
      />

      {failure ? (
        <p role="alert" className="mb-3 text-[13px] text-status-overdue">
          {errorMessage(failure)}
        </p>
      ) : null}

      {store.status === "error" ? (
        <ErrorState title="The schedule could not be loaded" onRetry={store.retry}>
          Your gatherings are safe. This is a problem reaching them.
        </ErrorState>
      ) : store.status === "loading" ? (
        <ListSkeleton rows={5} />
      ) : (
        <>
          <Section
            title="The schedule"
            meta={`${upcoming.length}`}
            action={
              maySchedule ? (
                <button
                  type="button"
                  onClick={() => void addRow()}
                  disabled={adding}
                  className="inline-flex min-h-6 items-center gap-1 text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Add schedule
                </button>
              ) : null
            }
          >
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Nothing scheduled yet" action={addButton}>
                Add a row for each gathering the week expects. A row can sit here needing a leader
                until someone picks it up.
              </EmptyState>
            ) : (
              <>
                {/* Wide: the roster itself, editable where it is read. */}
                <div className="hidden min-w-0 max-w-full overflow-x-auto lg:block">
                  <table className="w-full min-w-[860px] border-collapse text-[13px]">
                    <caption className="sr-only">
                      The shared LifeGroup schedule. Common fields can be edited in place; each row
                      opens its gathering.
                    </caption>
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">
                          Date
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Time
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Where
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Leading
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Stage
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          You
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcoming.map((gathering) => (
                        <ScheduleRow
                          key={gathering.id}
                          gathering={gathering}
                          venues={allVenues}
                          personId={person.id}
                          mayAmend={canAmendGathering(viewer, gathering)}
                          mayJoin={canJoinGathering(viewer, gathering)}
                          saving={store.saving}
                          onPatch={(patch) => {
                            setFailure(null);
                            void store
                              .updateGathering(gathering.id, patch as never)
                              .catch(setFailure);
                          }}
                          onJoin={(action) => {
                            setFailure(null);
                            void store.joinGathering(gathering.id, action).catch(setFailure);
                          }}
                          onOpen={() => {
                            window.location.assign(`/lifegroups/${gathering.id}`);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Narrow: the same rows, stacked. A seven-column roster at
                    390px is not a table anybody can use. */}
                <ul className="divide-y divide-border lg:hidden">
                  {upcoming.map((gathering) => (
                    <ScheduleCard
                      key={gathering.id}
                      gathering={gathering}
                      venues={allVenues}
                      personId={person.id}
                      mayJoin={canJoinGathering(viewer, gathering)}
                      saving={store.saving}
                      onJoin={(action) => {
                        setFailure(null);
                        void store.joinGathering(gathering.id, action).catch(setFailure);
                      }}
                      onOpen={() => {
                        window.location.assign(`/lifegroups/${gathering.id}`);
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
          </Section>

          {past.length > 0 ? (
            <Section className="mt-6" title="Already gathered" meta={`${past.length}`}>
              <ul className="divide-y divide-border">
                {past.slice(0, 8).map((gathering) => (
                  <li key={gathering.id} className="row-quiet">
                    <Link
                      to="/lifegroups/$gatheringId"
                      params={{ gatheringId: gathering.id }}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 truncate text-[14px]">
                        {gathering.venueName ??
                          allVenues.find((v) => v.id === gathering.venueId)?.name ??
                          "LifeGroup"}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {gathering.date}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </Page>
  );
}
