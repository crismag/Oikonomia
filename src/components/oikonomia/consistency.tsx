import { PersonName } from "@/components/oikonomia/person";
import { StatusDot } from "@/components/oikonomia/semantic-status";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/domain/obligations";
import { useOrganization } from "./organization-provider";
import { trendDirection, type HeatmapCell, type TrendPoint } from "@/domain/team-overview";

/**
 * Reporting completion over recent periods.
 *
 * A shape, plus the sentence the shape is supposed to convey. A chart that
 * cannot be read aloud is a chart half the readers do not get, so the summary
 * below it is the actual answer and the bars support it.
 */
export function TrendChart({ points, noun }: { points: TrendPoint[]; noun: string }) {
  if (points.length < 2) {
    return (
      <p className="text-[13px] text-muted-foreground">
        More reporting periods are needed before a trend can be shown.
      </p>
    );
  }

  const rate = (p: TrendPoint) => (p.total === 0 ? 0 : Math.round((p.done / p.total) * 100));
  const direction = trendDirection(points);
  const latest = points[points.length - 1]!;

  return (
    <div>
      <ol className="flex items-end gap-1.5" aria-hidden>
        {points.map((point) => (
          <li key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              className={cn(
                "w-full rounded-t",
                rate(point) >= 75
                  ? "bg-status-done"
                  : rate(point) >= 40
                    ? "bg-status-info"
                    : "bg-status-waiting",
              )}
              style={{ height: `${Math.max(rate(point) * 0.6, 3)}px` }}
            />
            <span className="w-full truncate text-center text-[10px] text-muted-foreground">
              {point.label}
            </span>
          </li>
        ))}
      </ol>

      {/* The textual equivalent, which is what a screen reader gets and what a
          hurried reader actually wants. */}
      <p className="mt-3 text-[13px] leading-relaxed">
        {noun} in {latest.label}: {latest.done} of {latest.total} ({rate(latest)}%).{" "}
        {direction ? (
          <span className="text-muted-foreground">
            {direction.direction === "stable"
              ? "About the same as the preceding periods."
              : `${direction.direction === "improving" ? "Up" : "Down"} ${Math.abs(direction.delta)} points on the preceding periods.`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Too few periods yet to say which way this is going.
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Who reported when, across recent periods.
 *
 * A pattern-detection tool, not a ranking: it exists so intermittent trouble
 * and sudden deterioration are visible, which a single current-state column
 * cannot show. Each cell carries its state in words for a screen reader, and
 * the table scrolls inside itself rather than pushing the page sideways.
 */
export function ConsistencyGrid({
  periods,
  cells,
  personIds,
}: {
  periods: string[];
  cells: HeatmapCell[];
  personIds: string[];
}) {
  const { personById } = useOrganization();

  if (personIds.length === 0 || periods.length === 0) {
    return (
      <p className="px-4 pb-4 text-[13px] text-muted-foreground">
        More reporting periods are needed before a pattern can be shown.
      </p>
    );
  }

  const at = (personId: string, period: string) =>
    cells.find((c) => c.personId === personId && c.period === period);

  return (
    /* `min-w-0` is what actually lets this shrink: without it the wide table
       pushes its ancestors and the *page* scrolls sideways instead of the
       grid. The scrolling has to stay inside the component. */
    <div className="min-w-0 max-w-full overflow-x-auto px-4 pb-4">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <caption className="sr-only">
          Whether each leader&apos;s report was submitted in each recent period. Each cell gives its
          state in words.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-[1] bg-surface py-1.5 pr-3 text-left font-medium text-muted-foreground"
            >
              Leader
            </th>
            {periods.map((period) => (
              <th
                key={period}
                scope="col"
                className="px-1.5 py-1.5 text-center font-medium text-muted-foreground"
              >
                {period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {personIds.map((personId) => (
            <tr key={personId}>
              <th
                scope="row"
                className="sticky left-0 z-[1] max-w-[150px] truncate bg-surface py-1.5 pr-3 text-left font-normal"
              >
                <PersonName personId={personId} />
              </th>
              {periods.map((period) => {
                const cell = at(personId, period);
                return (
                  <td key={period} className="px-1.5 py-1.5 text-center">
                    {cell ? (
                      <span
                        title={`${personById(personId).name}, ${period}: ${statusLabel[cell.status]}`}
                        className="inline-flex"
                      >
                        <StatusDot
                          status={cell.status}
                          size="lg"
                          label={`${period}: ${statusLabel[cell.status]}`}
                        />
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
