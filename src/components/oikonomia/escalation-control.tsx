import { useState } from "react";
import { AlertCircle, CheckCircle2, Gavel, Info, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AskNotes } from "./ask-notes";
import { useEscalationsFor } from "./escalation-provider";
import { useOrganization } from "./organization-provider";
import { errorMessage } from "@/lib/calendar-client";
import { notify, text } from "@/config";
import {
  escalationLabel,
  escalationStatusLabel,
  leadershipResponses,
  recipientLabel,
  recipientRoles,
  responseHint,
  responseLabel,
  type EscalationSourceType,
  type EscalationType,
  type LeadershipResponse,
  type RecipientRole,
} from "@/domain/escalation";

/**
 * "Does this need anything from leadership?"
 *
 * The control a leader meets when they write something down. **Informational
 * is the default and stays selected** unless somebody deliberately changes it:
 * the product's claim is that most of what leaders write is information, and a
 * form that nudges towards escalation would make that claim false one report
 * at a time.
 *
 * Choosing anything else asks for two things and no more — what you need, and
 * who from. A request with no words makes the recipient go and find out what
 * was meant, and a request addressed to nobody waits in a place nobody looks.
 *
 * It is small on purpose. A submission form that feels like raising a ticket
 * is a form leaders stop using.
 */

const icon: Record<EscalationType, LucideIcon> = {
  attention: AlertCircle,
  action: CheckCircle2,
  approval: Gavel,
};

export function EscalationControl({
  sourceType,
  sourceId,
  entryId,
  contextLabel,
  className,
  compact,
}: {
  sourceType: EscalationSourceType;
  sourceId: string;
  entryId?: string;
  contextLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const store = useEscalationsFor(sourceType, sourceId);
  /* Asking somebody for something offers whoever is here now. */
  const { activePeople: people } = useOrganization();

  const [choice, setChoice] = useState<LeadershipResponse>("informational");
  const [request, setRequest] = useState("");
  const [role, setRole] = useState<RecipientRole>("reporting-leader");
  const [personId, setPersonId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<EscalationType | null>(null);

  const mine = store.escalations.filter((item) => (entryId ? item.entryId === entryId : true));

  const submit = async () => {
    if (choice === "informational") return;
    setFailure(null);
    try {
      await store.raise({
        type: choice,
        sourceType,
        sourceId,
        ...(entryId ? { entryId } : {}),
        ...(contextLabel ? { contextLabel } : {}),
        request: request.trim(),
        ...(personId ? { requestedFromPersonId: personId } : { requestedFromRole: role }),
        ...(neededBy ? { neededBy } : {}),
      });
      notify.success(`escalation.${choice}.sent`);
      setSent(choice);
      setChoice("informational");
      setRequest("");
      setNeededBy("");
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <section
      className={cn("rounded-lg border border-border bg-surface px-4 py-3.5", className)}
      aria-label="Leadership response"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium">Does this need anything from leadership?</h3>
        {!compact ? (
          <p className="text-[12px] text-muted-foreground">
            Most of what you write is information. Ask only when you need something.
          </p>
        ) : null}
      </div>

      {mine.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {mine.map((item) => {
            const Icon = icon[item.type];
            return (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-md bg-surface-muted px-2.5 py-2 text-[12px]"
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{escalationLabel[item.type]}</span>
                  {" — "}
                  {item.request}
                  <span className="text-muted-foreground">
                    {" · "}
                    {escalationStatusLabel[item.status]}
                  </span>
                  {/* Only people party to the ask receive what was said on it. */}
                  <AskNotes item={item} className="mt-1.5" />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <fieldset className="mt-2.5">
        <legend className="sr-only">Leadership response needed?</legend>
        <div className="flex flex-wrap gap-1.5">
          {leadershipResponses.map((option) => (
            <label
              key={option}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                choice === option
                  ? "border-primary/40 bg-accent-soft text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name={`leadership-response-${entryId ?? sourceId}`}
                className="sr-only"
                checked={choice === option}
                onChange={() => {
                  setChoice(option);
                  setSent(null);
                }}
              />
              {option === "informational" ? (
                <Info className="size-3.5" aria-hidden />
              ) : (
                (() => {
                  const Icon = icon[option];
                  return <Icon className="size-3.5" aria-hidden />;
                })()
              )}
              {responseLabel[option]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {responseHint[choice]}
        </p>
      </fieldset>

      {choice !== "informational" ? (
        <div className="mt-3 space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
              What do you need from leadership?
            </span>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={2}
              placeholder="Please confirm whether Room B can be used for the 18 September gathering."
              className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                Requested from
              </span>
              <select
                value={personId ? `person:${personId}` : `role:${role}`}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.startsWith("person:")) setPersonId(value.slice(7));
                  else {
                    setPersonId("");
                    setRole(value.slice(5) as RecipientRole);
                  }
                }}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
              >
                {/* Positions first: a request addressed to a position still
                    reaches the right person after the church reorganises. */}
                {recipientRoles.map((option) => (
                  <option key={option} value={`role:${option}`}>
                    {recipientLabel[option]}
                  </option>
                ))}
                {people.map((person) => (
                  <option key={person.id} value={`person:${person.id}`}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>

            {choice !== "attention" ? (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted-foreground">
                  Needed by <span className="font-normal">(optional)</span>
                </span>
                <input
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong"
                />
              </label>
            ) : null}
          </div>

          {failure ? (
            <p role="alert" className="text-[12px] text-status-overdue">
              {failure}
            </p>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            disabled={store.raising || !request.trim()}
            busy={store.raising}
            onClick={() => void submit()}
          >
            Send request
          </Button>
        </div>
      ) : null}

      {/* The same words the toast used, kept on the page for anybody who
          missed it — one definition, two presentations. */}
      {sent ? (
        <p role="status" className="mt-2 text-[12px] text-status-done">
          {text(`escalation.${sent}.sent`)}
        </p>
      ) : null}
    </section>
  );
}
