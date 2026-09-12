import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, CircleCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { Page } from "@/components/oikonomia/page";
import {
  completeOnboarding,
  fetchOnboarding,
  moveOnboarding,
  type OnboardingContext,
} from "@/lib/onboarding-api";
import { claimAssignment, requestAssignmentCorrection } from "@/lib/organization-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { assignmentStatusLabel, functionLabel, isServing } from "@/domain/assignment";
import { nextStep, previousStep, stepTitle, type OnboardingStep } from "@/domain/onboarding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome — Oikonomia" },
      { name: "description", content: "Set up your leadership workspace." },
    ],
  }),
  component: WelcomePage,
});

/**
 * Setting somebody up, and showing them round.
 *
 * ## What this screen may and may not do
 *
 * It shows the organisation as the church has recorded it and asks the person
 * to confirm it. Where they disagree, it records a **request** — and every
 * write on this page goes through the assignment service, which stores what
 * somebody says about themselves as a claim awaiting confirmation.
 *
 * So there is no path from this flow to membership, a role or a capability. A
 * leader can tick every ministry on the list and gain access to none of them
 * until an administrator agrees. That is deliberate: an onboarding wizard is
 * exactly where a product usually grows an authorization hole.
 *
 * ## One question per screen
 *
 * Not a form with eleven fields. Each step asks one thing, shows what is
 * already known rather than asking for it again, and can be left — progress is
 * written as it happens, so closing the browser halfway loses nothing.
 */
function WelcomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery<OnboardingContext>({
    queryKey: ["onboarding"],
    queryFn: async () => unwrap(await withTimeout(fetchOnboarding({ data: undefined }))),
    retry: 1,
    networkMode: "always",
  });

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: () => {
      /* Assignments change what other pages may show, so this is not a local
         refresh. */
      void queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
    networkMode: "always" as const,
    retry: 0,
  });

  const run = (work: () => Promise<unknown>) => {
    setFailure(null);
    void mutation.mutateAsync(work).catch(() => {});
  };

  if (query.status === "pending") {
    return (
      <Page>
        <ListSkeleton rows={4} />
      </Page>
    );
  }
  if (query.status === "error") {
    return (
      <Page>
        <ErrorState title="Setup could not be loaded" onRetry={() => void query.refetch()}>
          Nothing is lost. This is a problem reaching the server.
        </ErrorState>
      </Page>
    );
  }

  const context = query.data;
  const steps = context.steps;
  const current: OnboardingStep = steps.includes(context.state.step)
    ? context.state.step
    : "welcome";
  const index = steps.indexOf(current);
  const busy = mutation.isPending;

  const go = (step: OnboardingStep) => run(() => moveOnboarding({ data: { step } }));

  /**
   * Finish, then leave — in that order, and not before the session agrees.
   *
   * Home redirects anybody who still owes a pass through setup, and it decides
   * that from the session snapshot. Navigating before the refetch settles sends
   * somebody to Home with a stale answer, which bounces them straight back here
   * — finished, and apparently stuck. So the invalidation is awaited.
   */
  const finish = async () => {
    setFailure(null);
    try {
      unwrap((await withTimeout(completeOnboarding({ data: undefined }))) as never);
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <Page>
      <div className="mx-auto w-full max-w-2xl py-6">
        {/* Progress, so somebody can see how much is left rather than guessing. */}
        <ol className="mb-8 flex flex-wrap items-center gap-1.5" aria-label="Setup progress">
          {steps.map((step, position) => (
            <li key={step} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]",
                  position === index
                    ? "bg-accent-soft font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {position < index ? (
                  <CircleCheck className="size-3.5" aria-hidden />
                ) : (
                  <Circle className="size-3.5" aria-hidden />
                )}
                {stepTitle[step]}
              </span>
            </li>
          ))}
        </ol>

        {failure ? (
          <p role="alert" className="mb-4 text-[13px] text-status-overdue">
            {failure}
          </p>
        ) : null}

        <StepBody context={context} step={current} busy={busy} run={run} />

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || index === 0}
            onClick={() => go(previousStep(current, steps))}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Button>

          <div className="flex items-center gap-2">
            {/* Leaving is not abandoning: everything confirmed so far is
                already written. */}
            <Link to="/" className="text-[13px] text-muted-foreground hover:text-foreground">
              Save and exit
            </Link>

            {current === "summary" ? (
              <Button type="button" variant="primary" disabled={busy} onClick={() => void finish()}>
                <Check className="size-3.5" aria-hidden />
                Go to my workspace
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => go(nextStep(current, steps))}
              >
                Continue
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      {children ? (
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{children}</p>
      ) : null}
    </div>
  );
}

function StepBody({
  context,
  step,
  busy,
  run,
}: {
  context: OnboardingContext;
  step: OnboardingStep;
  busy: boolean;
  run: (work: () => Promise<unknown>) => void;
}) {
  switch (step) {
    case "welcome":
      return (
        <>
          <Heading title={`Welcome, ${context.person.name.split(" ")[0]}`}>
            Let us set up your workspace. Oikonomia already knows some of this — you are here to
            check it, not to type it in again.
          </Heading>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            What you confirm here decides which schedules, ministries, reports and shared work you
            see. Where something is wrong, you can say so and somebody will look at it — nothing you
            change here takes effect until they do.
          </p>
        </>
      );

    case "profile":
      return (
        <>
          <Heading title="Your details">This is what the church has recorded about you.</Heading>
          <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
            <Row label="Name" value={context.person.name} />
            <Row label="What you are called here" value={context.person.role || "Not set"} />
            <Row label="Campus" value={context.campus?.name ?? "Not set"} />
            <Row label="What you may do in Oikonomia" value={context.roleLabel} />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            These are the organisation&apos;s records rather than your settings, so they are changed
            by an administrator. If something is wrong, tell them — it affects what you see.
          </p>
        </>
      );

    case "responsibilities":
      return (
        <>
          <Heading title="Your responsibilities">
            Everywhere the church has recorded that you serve.
          </Heading>
          {context.assignments.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-5 text-[14px] text-muted-foreground">
              Nothing yet. That is normal for a new account — the next screens let you say where you
              serve, and somebody will confirm it.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {context.assignments.map((assignment) => (
                <li
                  key={`${assignment.scope}-${assignment.targetId}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px]">
                      {nameOf(context, assignment.scope, assignment.targetId)}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {[
                        functionLabel(assignment.function),
                        assignmentStatusLabel[assignment.status],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {isServing(assignment.status) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          requestAssignmentCorrection({
                            data: { scope: assignment.scope, targetId: assignment.targetId },
                          }),
                        )
                      }
                    >
                      This is wrong
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      );

    case "ministries":
      return (
        <Chooser
          title="Your ministries"
          description="Which ministries are you part of? Tick the ones that apply. An administrator confirms them — ticking one does not give you access on its own."
          scope="ministry"
          options={context.ministries.map((m) => ({ id: m.id, label: m.name }))}
          context={context}
          busy={busy}
          run={run}
        />
      );

    case "groups":
      return (
        <Chooser
          title="Teams and committees"
          description="Which teams, committees or other groups are you part of?"
          scope="group"
          options={context.groups.map((g) => ({ id: g.id, label: g.name }))}
          context={context}
          busy={busy}
          run={run}
          footer="Cannot see your group? An administrator creates them — ask them to add it, and it will appear here."
        />
      );

    case "reporting":
      return (
        <>
          <Heading title="Reporting">
            Who you answer to, and who answers to you. This decides where a request you raise is
            sent.
          </Heading>
          <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
            <Row label="You report to" value={context.reportsTo?.name ?? "Nobody recorded"} />
            <Row
              label="Reporting to you"
              value={
                context.oversees.length === 0
                  ? "Nobody"
                  : context.oversees.map((person) => person.name).join(", ")
              }
            />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Reporting lines are the organisation&apos;s own record and are set by an administrator.
            If this is wrong, tell them before you rely on it — a request addressed to the wrong
            leader waits with them.
          </p>
        </>
      );

    case "summary":
    default: {
      const serving = context.assignments.filter((a) => isServing(a.status));
      const waiting = context.assignments.filter(
        (a) => a.status === "pending" || a.status === "correction-requested",
      );

      return (
        <>
          <Heading title="Your workspace is ready">
            Here is what Oikonomia has, and what it will show you.
          </Heading>
          <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
            <Row
              label="Where you serve"
              value={
                serving.length === 0
                  ? "Nothing confirmed yet"
                  : serving.map((a) => nameOf(context, a.scope, a.targetId)).join(", ")
              }
            />
            <Row label="You report to" value={context.reportsTo?.name ?? "Nobody recorded"} />
            {waiting.length > 0 ? (
              <Row
                label="Waiting on somebody"
                value={`${waiting.length} ${waiting.length === 1 ? "change is" : "changes are"} awaiting confirmation`}
              />
            ) : null}
          </dl>

          <h2 className="mb-2 mt-6 text-[14px] font-medium">A quick tour</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {context.tour.map((stop) => (
              <li key={stop.to} className="px-4 py-3">
                <Link
                  to={stop.to}
                  className="text-[14px] font-medium underline-offset-2 hover:underline"
                >
                  {stop.title}
                </Link>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {stop.body}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">
            You can run this again at any time from the account menu.
          </p>
        </>
      );
    }
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-4 py-3">
      <dt className="w-48 shrink-0 text-[12px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[14px]">{value}</dd>
    </div>
  );
}

/**
 * Ticking things you are part of.
 *
 * Each tick is a **claim**, written immediately so leaving mid-flow keeps it,
 * and shown with its real state rather than as a plain checkbox — because
 * "ticked" and "agreed by the church" are different things and the difference
 * is the point.
 */
function Chooser({
  title,
  description,
  scope,
  options,
  context,
  busy,
  run,
  footer,
}: {
  title: string;
  description: string;
  scope: "ministry" | "group";
  options: { id: string; label: string }[];
  context: OnboardingContext;
  busy: boolean;
  run: (work: () => Promise<unknown>) => void;
  footer?: string;
}) {
  const stateOf = (targetId: string) =>
    context.assignments.find((a) => a.scope === scope && a.targetId === targetId);

  return (
    <>
      <Heading title={title}>{description}</Heading>
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const assignment = stateOf(option.id);
          const on = assignment && assignment.status !== "ended";

          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={busy || assignment?.status === "confirmed"}
                aria-pressed={Boolean(on)}
                onClick={() => run(() => claimAssignment({ data: { scope, targetId: option.id } }))}
                className={cn(
                  "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                  on
                    ? "border-border-strong bg-accent-soft"
                    : "border-border bg-surface hover:bg-muted",
                  assignment?.status === "confirmed" && "cursor-default",
                )}
              >
                <span className="block text-[14px]">{option.label}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {assignment ? assignmentStatusLabel[assignment.status] : "Not recorded"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {options.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-5 text-[14px] text-muted-foreground">
          Nothing has been set up yet.
        </p>
      ) : null}
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {footer ??
          "An administrator confirms these. Until they do, ticking one records that you said so and changes nothing else."}
      </p>
    </>
  );
}

function nameOf(context: OnboardingContext, scope: "ministry" | "group", id: string): string {
  if (scope === "ministry") {
    return context.ministries.find((m) => m.id === id)?.name ?? "A ministry";
  }
  return context.groups.find((g) => g.id === id)?.name ?? "A group";
}
