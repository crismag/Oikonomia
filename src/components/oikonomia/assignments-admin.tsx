import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { PersonName } from "./person";
import { useOrganization } from "./organization-provider";
import { useViewer } from "@/domain/session";
import { fetchAssignmentsAwaitingDecision, setAssignment } from "@/lib/organization-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { assignmentStatusLabel, functionLabel } from "@/domain/assignment";
import type { Assignment } from "@/domain/assignment";

/**
 * What people have said about themselves, waiting for somebody to decide.
 *
 * This is the other half of the rule that makes onboarding safe. A leader
 * ticking "I am part of the music ministry" writes a claim and gains nothing;
 * this is where that claim becomes the church's own answer, or does not.
 *
 * **Confirming is an access decision.** A confirmed ministry membership opens
 * that ministry's information, and a confirmed responsibility group can put
 * somebody in the audience of every report addressed to leadership. So the
 * control says what it does, and the service refuses it to everybody but an
 * administrator regardless of what this screen draws.
 */
export function AssignmentsAdmin() {
  const queryClient = useQueryClient();
  const organization = useOrganization();
  const { persona } = useViewer();

  const query = useQuery<(Assignment & { personId: string })[]>({
    queryKey: ["assignments-awaiting"],
    queryFn: async () =>
      unwrap(await withTimeout(fetchAssignmentsAwaitingDecision({ data: undefined }))),
    retry: 1,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: () => void queryClient.invalidateQueries(),
    networkMode: "always" as const,
    retry: 0,
  });

  const waiting = query.data ?? [];

  const nameOf = (assignment: Assignment) =>
    assignment.scope === "ministry"
      ? (organization.ministryById(assignment.targetId)?.name ?? "A ministry")
      : (organization.groupById(assignment.targetId)?.name ?? "A group");

  const decide = (assignment: Assignment & { personId: string }, confirmed: boolean) =>
    mutation.mutate(() =>
      setAssignment({
        data: {
          scope: assignment.scope,
          targetId: assignment.targetId,
          personId: assignment.personId,
          function: assignment.function,
          /* Declining ends it rather than deleting it: somebody asked, and the
             record of having asked is part of the answer. */
          status: confirmed ? "confirmed" : "ended",
        },
      }),
    );

  return (
    <Section id="assignments" title="Awaiting confirmation" meta={`${waiting.length}`}>
      <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
        What people have said about where they serve, and corrections they have asked for. None of
        it is in effect: confirming a ministry opens that ministry&apos;s information, and
        confirming a leadership group can put somebody in the audience of every report addressed to
        leadership.
      </p>

      {mutation.isError ? (
        <p role="alert" className="px-4 py-2 text-[13px] text-status-overdue">
          {errorMessage(mutation.error)}
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {waiting.map((assignment) => (
          <li
            key={`${assignment.scope}-${assignment.targetId}-${assignment.personId}`}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px]">
                <PersonName personId={assignment.personId} /> · {nameOf(assignment)}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {[functionLabel(assignment.function), assignmentStatusLabel[assignment.status]]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>

            {/* Nobody confirms their own place; the service refuses it too. */}
            {assignment.personId === persona.personId ? (
              <span className="text-[12px] text-muted-foreground">
                Another administrator confirms this
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() => decide(assignment, true)}
              >
                <Check className="size-3.5" aria-hidden />
                Confirm
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => decide(assignment, false)}
            >
              <X className="size-3.5" aria-hidden />
              Decline
            </Button>
          </li>
        ))}

        {waiting.length === 0 ? (
          <li className="px-4 py-3 text-[13px] text-muted-foreground">
            Nothing is waiting. What people say about themselves during setup appears here for you
            to confirm.
          </li>
        ) : null}
      </ul>
    </Section>
  );
}
