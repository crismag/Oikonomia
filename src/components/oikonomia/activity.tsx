import {
  CheckCircle2,
  CircleDot,
  FileUp,
  Gavel,
  Link2,
  MessageSquare,
  RefreshCw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { useOrganization } from "./organization-provider";
import type { ActivityEntry } from "@/domain/types";

/**
 * Activity is append-oriented history, never the source of truth for state.
 * It inherits the visibility of the object it describes.
 */

const kindIcon: Record<ActivityEntry["kind"], LucideIcon> = {
  submitted: FileUp,
  assigned: UserPlus,
  comment: MessageSquare,
  decision: Gavel,
  artifact: Link2,
  status: RefreshCw,
  review: CircleDot,
  resolution: CheckCircle2,
};

export function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  const { personById } = useOrganization();
  return (
    <ol className="relative space-y-0.5 pl-1">
      {entries.map((entry, i) => {
        const Icon = kindIcon[entry.kind];
        const actor = entry.actorId ? personById(entry.actorId) : null;
        const last = i === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-3.5 last:pb-0">
            {!last ? (
              <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-border" />
            ) : null}
            <span className="relative z-10 mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full border border-border bg-surface">
              <Icon className="size-3 text-muted-foreground" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug">{entry.summary}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {actor ? `${actor.name} · ` : ""}
                {entry.at}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
