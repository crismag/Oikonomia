import { useState } from "react";

import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { StatusChip, StatusDot } from "@/components/oikonomia/semantic-status";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/domain/obligations";
import { matrixOrder, overallLabel, type LeaderStatus } from "@/domain/team-overview";
import { useOrganization } from "./organization-provider";

/**
 * How each leader is doing, across the sections.
 *
 * Its job is to let someone with oversight scan many leaders without opening
 * each one. Three things it deliberately is not:
 *
 * - **Not a ranking.** Sorted by state so nothing urgent is missed, then by
 *   name. There is no score, no position and no best-to-worst.
 * - **Not a report viewer.** A cell carries a section and a state. What a
 *   report says stays with its author and its audience.
 * - **Not a squeezed table on a phone.** Below `lg` it becomes one card per
 *   leader, because a seven-column grid at 390px is unreadable.
 *
 * The table scrolls inside itself if it must, never the page, and the leader
 * column stays put so a row never loses its name.
 */
export function LeaderMatrix({
  leaders,
  areas,
  onSelect,
}: {
  leaders: LeaderStatus[];
  /** Section names, in the order the binder lists them. */
  areas: string[];
  onSelect: (personId: string) => void;
}) {
  const { personById } = useOrganization();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = matrixOrder(leaders, (id) => personById(id).name).filter(
    (leader) => !q || personById(leader.personId).name.toLowerCase().includes(q),
  );

  return (
    <div>
      <div className="px-4 pb-3">
        <label className="flex max-w-xs items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
          <span className="sr-only">Search leaders</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leaders"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted-foreground">No leaders match that search.</p>
      ) : (
        <>
          {/* Wide: the table, scrolling inside itself if it must. */}
          <div className="hidden min-w-0 max-w-full overflow-x-auto lg:block">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <caption className="sr-only">
                Each leader&apos;s state in each section of the binder. States are given in words.
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="sticky left-0 z-[1] bg-surface px-4 py-2 text-left font-medium text-muted-foreground"
                  >
                    Leader
                  </th>
                  {areas.map((area) => (
                    <th
                      key={area}
                      scope="col"
                      className="px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      {area}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Overall
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((leader) => (
                  <tr key={leader.personId} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] bg-surface px-4 py-2 text-left font-normal"
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(leader.personId)}
                        className="inline-flex items-center gap-2 text-left hover:underline"
                      >
                        <PersonAvatar personId={leader.personId} size="sm" />
                        <PersonName personId={leader.personId} />
                      </button>
                    </th>
                    {areas.map((area) => {
                      const status = leader.areas[area];
                      return (
                        <td key={area} className="px-3 py-2">
                          {status ? (
                            /* The word travels with the mark — a cell that is
                               only a coloured dot says nothing to a reader who
                               cannot see the colour. */
                            <span className="inline-flex items-center gap-1.5">
                              <StatusDot status={status} size="sm" />
                              <span className="text-[12px] text-muted-foreground">
                                {statusLabel[status]}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[12px] text-muted-foreground">
                              <span className="sr-only">Nothing expected</span>
                              <span aria-hidden>—</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      <StatusChip status={leader.overall} label={overallLabel[leader.overall]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow: one card per leader. */}
          <ul className="divide-y divide-border lg:hidden">
            {visible.map((leader) => (
              <li key={leader.personId}>
                <button
                  type="button"
                  onClick={() => onSelect(leader.personId)}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <PersonAvatar personId={leader.personId} size="sm" />
                      <span className="truncate text-[14px]">
                        <PersonName personId={leader.personId} />
                      </span>
                    </span>
                    <StatusChip status={leader.overall} label={overallLabel[leader.overall]} />
                  </span>
                  <span className="mt-1.5 block text-[12px] text-muted-foreground">
                    {leader.outstanding === 0
                      ? "Nothing outstanding"
                      : `${leader.outstanding} outstanding`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * One leader, without leaving the page.
 *
 * Enough to decide whether to go further, and no more: sections and states,
 * never what any report says. The two actions are the ways to go and look
 * properly.
 */
export function LeaderQuickView({
  leader,
  areas,
  onClose,
}: {
  leader: LeaderStatus;
  areas: string[];
  onClose: () => void;
}) {
  const { personById } = useOrganization();

  return (
    <section
      aria-label={`${personById(leader.personId).name} — summary`}
      className="mt-3 rounded-xl border border-border bg-surface-muted px-4 py-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          <PersonAvatar personId={leader.personId} size="sm" />
          <span className="text-[15px]">
            <PersonName personId={leader.personId} />
          </span>
          <StatusChip status={leader.overall} label={overallLabel[leader.overall]} />
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Close
        </button>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {areas.map((area) => {
          const status = leader.areas[area];
          if (!status) return null;
          return (
            <div key={area} className="flex items-center justify-between gap-3">
              <dt className="text-[13px] text-muted-foreground">{area}</dt>
              <dd className="inline-flex items-center gap-1.5">
                <StatusDot status={status} size="sm" />
                <span className="text-[13px]">{statusLabel[status]}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {/* No link to their binder: one leader's working environment is theirs,
          and there is no route that shows it as somebody else. Reports to
          Review is where oversight actually happens. */}
      <p className={cn("mt-3 text-[12px] text-muted-foreground")}>
        What each report says stays with its author and its audience. Review happens in Reports to
        Review.
      </p>
    </section>
  );
}
