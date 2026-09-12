import { config } from "@/config";
import type { StatusBehavior } from "@/config";

/**
 * What a work stage means, asked of configuration rather than of its name.
 *
 * ## Why this is narrower than the report version
 *
 * A report stage's behaviours decide the whole of a move: what a transition
 * does and who may make it are both derived from the difference between two
 * stages (`planTransition` in `leadership-report.ts`). Work is not that shape.
 * A work record moves through a **review process** — submit, take into review,
 * ask for changes, acknowledge, resolve — and each step carries a rule no set
 * of booleans implies: only the reviewer may take it into review, only "ask for
 * changes" requires a note, and every review step is refused outright on a
 * record nobody asked to have reviewed. Deriving those from four flags would be
 * a worse model wearing a better one's clothes.
 *
 * So the behaviours answer only the questions that *are* behavioural, and they
 * are the ones every list asks: is this still open, and may its owner still
 * write in it. Those used to be spelled as arrays of ids — `["resolved",
 * "closed", "acknowledged"].includes(status)` — which is how a renamed stage
 * becomes a silently wrong count.
 *
 * An unrecognised stage reads as **not current and not editable**: settled
 * rather than open, which is the quiet direction. A record that wrongly reads
 * as finished is visible in a list of finished things; one that wrongly reads
 * as open is an obligation nobody has.
 */
export function workStatusBehavior(status: string): StatusBehavior {
  const option = config.option("work.statuses", status) as
    { behaviors?: StatusBehavior } | undefined;

  return (
    option?.behaviors ?? { editable: false, final: true, current: false, visibleToAudience: false }
  );
}

/** Still part of what is going on, rather than settled. */
export const isOpenWork = (status: string) => workStatusBehavior(status).current;

/** Its owner may still change what it says. */
export const isEditableWork = (status: string) => workStatusBehavior(status).editable;
