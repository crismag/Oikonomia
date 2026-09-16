import { cn } from "@/lib/utils";
import { planningTime, type PlanningItem } from "@/domain/planning";
import type { AgendaItem } from "@/domain/types";
import { formatDayMonth } from "@/domain/dates";

/**
 * The Weekly Agenda, as the binder page it came from.
 *
 * Derived from the physical sheet, not invented: a banner, **MONTH** and
 * **WEEK OF**, then Monday–Wednesday, Thursday–Saturday, and a last row where
 * Sunday sits beside **NOTE**. Everything in a cell is a bullet, whether it is
 * something happening or something to do — which is how the leader writes it.
 *
 * The NOTE box is not a design flourish. `notesForWeek` already models exactly
 * this: items filed to the week rather than to a day. The page and the model
 * agreed before the page existed, which is why this prints rather than
 * approximates.
 *
 * A leader should be able to take this to a meeting when the laptop is shut.
 */

/** Monday first, as the physical page runs. */
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AgendaSheet({
  days,
  itemsByDay,
  notes,
  monthLabel,
  weekOfLabel,
}: {
  /** The week's seven ISO dates, Monday first. */
  days: string[];
  itemsByDay: (iso: string) => PlanningItem[];
  /** Items filed to the week rather than to a day — the NOTE box. */
  notes: AgendaItem[];
  monthLabel: string;
  weekOfLabel: string;
}) {
  const sunday = days[6];

  return (
    <article
      data-print="sheet"
      className="mx-auto max-w-[900px] rounded-2xl border border-border bg-surface shadow-card px-6 py-6"
    >
      <header data-print="section">
        {/* The banner, in the binder's own words. */}
        <h1 className="border border-border-strong bg-muted py-2 text-center font-display text-[26px] uppercase tracking-[0.12em]">
          Weekly Agenda
        </h1>

        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <p className="flex items-baseline gap-2 border-b border-border-strong pb-1 text-[13px] uppercase tracking-wide">
            Month:
            <span className="font-display text-[16px] normal-case tracking-normal">
              {monthLabel}
            </span>
          </p>
          <p className="flex items-baseline gap-2 border-b border-border-strong pb-1 text-[13px] uppercase tracking-wide">
            Week of:
            <span className="font-display text-[16px] normal-case tracking-normal">
              {weekOfLabel}
            </span>
          </p>
        </div>
      </header>

      {/* Two rows of three, exactly as the sheet is ruled. */}
      <div data-print="section" className="mt-5 grid gap-px bg-border-strong sm:grid-cols-3">
        {days.slice(0, 6).map((iso, index) => (
          <DayCell key={iso} name={DAY_ORDER[index]!} items={itemsByDay(iso)} />
        ))}
      </div>

      {/* Sunday and the week's own notes share the last row. */}
      <div data-print="section" className="mt-5 grid gap-px bg-border-strong sm:grid-cols-3">
        {sunday ? <DayCell name="Sunday" items={itemsByDay(sunday)} /> : null}
        <section className="bg-surface sm:col-span-2">
          <h2 className="border-b border-border-strong bg-muted px-3 py-1.5 text-center text-[12px] font-medium uppercase tracking-wide">
            Note
          </h2>
          <div className="px-3 py-2.5">
            {notes.length > 0 ? (
              <ul className="space-y-1.5">
                {notes.map((note) => (
                  <Bullet key={note.id} done={note.completed}>
                    {note.text}
                  </Bullet>
                ))}
              </ul>
            ) : (
              /* Ruled and empty, like the paper — a leader fills it in by hand. */
              <p className="min-h-[64px]" />
            )}
          </div>
        </section>
      </div>
    </article>
  );
}

function DayCell({ name, items }: { name: string; items: PlanningItem[] }) {
  return (
    <section className="bg-surface">
      <h2 className="border-b border-border-strong px-3 py-1.5 text-center text-[12px] font-medium uppercase tracking-wide">
        {name}
      </h2>
      <div className="min-h-[120px] px-3 py-2.5">
        {items.length > 0 ? (
          <ul className="space-y-1.5">
            {items.map((item) => {
              const time = planningTime(item);
              return (
                <Bullet key={item.id} done={item.completed}>
                  {item.title}
                  {time ? <span className="text-muted-foreground"> · {time}</span> : null}
                  {item.location ? (
                    <span className="text-muted-foreground"> · {item.location}</span>
                  ) : null}
                </Bullet>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One line of the page.
 *
 * Something already done keeps its place — the agenda is a record of the week
 * as well as a plan for it — and is struck through rather than removed, which
 * is what a leader does to the paper.
 */
function Bullet({ children, done }: { children: React.ReactNode; done?: boolean | undefined }) {
  return (
    <li className="flex gap-2 text-[13px] leading-snug">
      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-foreground" aria-hidden />
      <span className={cn("min-w-0", done && "text-muted-foreground line-through")}>
        {children}
      </span>
    </li>
  );
}

/** "Week of 7 September" — what the leader writes on the line. */
export const weekOfLabel = (iso: string) => formatDayMonth(iso);
