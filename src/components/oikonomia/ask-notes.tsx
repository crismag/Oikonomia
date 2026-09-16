import { cn } from "@/lib/utils";
import { PersonName } from "./person";
import { askNotes } from "@/domain/escalation";
import type { EscalationView } from "@/lib/escalation-api";

/**
 * What has been said on an ask since it was made — a question, an answer, why
 * it was declined or could not be done. The server sends these only to people
 * party to the ask, so this renders whatever arrived and nothing more.
 */
export function AskNotes({ item, className }: { item: EscalationView; className?: string }) {
  const notes = askNotes(item.activity);
  if (notes.length === 0) return null;
  return (
    <ul className={cn("mt-2 space-y-1.5", className)} aria-label="Said on this ask">
      {notes.map((entry) => (
        <li
          key={entry.id}
          className="rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-relaxed"
        >
          <span className="text-muted-foreground">
            <PersonName personId={entry.actorId} /> {entry.summary}:
          </span>{" "}
          <span className="whitespace-pre-wrap text-foreground">{entry.note}</span>
        </li>
      ))}
    </ul>
  );
}
