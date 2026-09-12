import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRightCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  FileText,
  PauseCircle,
  PlayCircle,
} from "lucide-react";

import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { AccessNotice, ClassificationTag, DeniedPanel } from "@/components/oikonomia/access";
import { GoalStatusLine } from "@/components/oikonomia/goal-status";
import { useGoals } from "@/components/oikonomia/goals-provider";
import { EscalationControl } from "@/components/oikonomia/escalation-control";
import { DetailHeader, DetailLayout, Page, RailBlock } from "@/components/oikonomia/page";
import { PersonAvatar, PersonName } from "@/components/oikonomia/person";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { Section } from "@/components/oikonomia/section";
import { errorMessage } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import { resolveAccess } from "@/domain/access";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { formatTarget, updatesFor } from "@/domain/goals";
import { formatTime, fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import type { Goal } from "@/domain/types";

export const Route = createFileRoute("/goals/$goalId")({
  /* Generic title: a goal may be leadership-confidential and head() cannot
     resolve the viewing persona, so the tab never carries the subject. */
  head: () => ({ meta: [{ title: "Goal — Oikonomia" }] }),
  component: GoalDetail,
});

/**
 * Goal detail: what we are trying to accomplish, where it stands, what has
 * happened toward it, and what binder records relate to it.
 *
 * The goal stays visually dominant. Progress is a record of updates, not a
 * conversation, and there is no percentage anywhere.
 */
function GoalDetail() {
  const { campuses, ministries } = useOrganization();
  const { goalId } = Route.useParams();
  const navigate = useNavigate();
  const store = useGoals();
  const { goals, updates, addUpdate, complete, hold, resume, carryForward } = store;
  const { entries } = useSchedule();
  const { persona, person } = useViewer();

  /*
   * Every action here now crosses to the server, so a refusal has to be
   * visible. Firing and forgetting would let a leader mark a goal complete,
   * watch nothing change, and have no idea why (§20).
   *
   * Declared before the early returns below: a hook that only runs on some
   * renders is a hook that breaks the component the first time the data is
   * still loading.
   */
  const [failure, setFailure] = useState<unknown>(null);
  const attempt = async (work: () => Promise<void>) => {
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(error);
    }
  };

  const goal = goals.find((g) => g.id === goalId);

  /*
   * Absent is not the same as missing while the year is still loading. A 404
   * thrown on the first render is a goal that exists being reported as gone,
   * which a leader has no reason to disbelieve.
   */
  if (!goal && store.status === "loading") {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }

  if (!goal && store.status === "error") {
    return (
      <Page>
        <ErrorState title="This goal could not be loaded" onRetry={store.retry}>
          Your goals are safe. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }

  if (!goal) throw notFound();

  const access = goal.policy ? resolveAccess(persona, person, goal.policy) : undefined;
  if (access && (access.level === "denied" || access.level === "metadata")) {
    return <DeniedPanel decision={access} />;
  }

  const history = updatesFor(updates, goal.id);
  const ministry = ministries.find((m) => m.id === goal.ministryId);
  const campus = campuses.find((c) => c.id === goal.campusId);
  const origin = goal.carriedFromGoalId
    ? goals.find((g) => g.id === goal.carriedFromGoalId)
    : undefined;

  const linkedEntries = goal.links
    .filter((link) => link.kind === "schedule-entry")
    .map((link) => entries.find((entry) => entry.id === link.id))
    .filter((entry) => entry !== undefined);

  return (
    <Page>
      <Link
        to="/goals"
        search={{ year: goal.year }}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        {goal.year} Goals
      </Link>

      <DetailHeader
        eyebrow={
          <>
            <span className="font-display tabular-nums">
              Goal {String(goal.number).padStart(2, "0")}
            </span>
            <span aria-hidden>·</span>
            <span>{goal.year}</span>
            {ministry ? (
              <>
                <span aria-hidden>·</span>
                <Link
                  to="/ministries/$ministryId"
                  params={{ ministryId: ministry.id }}
                  className="transition-colors hover:text-primary"
                >
                  {ministry.name}
                </Link>
              </>
            ) : null}
          </>
        }
        title={goal.title}
        meta={<GoalStatusLine goal={goal} />}
      />

      <DetailLayout
        rail={
          <>
            {goal.policy ? (
              <RailBlock label="Audience">
                <ClassificationTag classification={goal.policy.classification} />
                {access ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    {access.rationale}.
                  </p>
                ) : null}
              </RailBlock>
            ) : null}

            <RailBlock label="Target">
              <p className="text-[13px]">
                {formatTarget(goal.target) ?? (
                  <span className="text-muted-foreground">No target set</span>
                )}
              </p>
            </RailBlock>

            {goal.ownerId ? (
              <RailBlock label="Carried by">
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  <PersonAvatar personId={goal.ownerId} size="sm" />
                  <Link
                    to="/people/$personId"
                    params={{ personId: goal.ownerId }}
                    className="min-w-0 truncate transition-colors hover:text-primary"
                  >
                    <PersonName personId={goal.ownerId} />
                  </Link>
                </span>
              </RailBlock>
            ) : null}

            <RailBlock label="Context">
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                {campus ? <li>{campus.name}</li> : null}
                <li>Set {format(fromISO(goal.createdAt), "d MMMM yyyy")}</li>
                {origin ? (
                  <li>
                    <Link
                      to="/goals/$goalId"
                      params={{ goalId: origin.id }}
                      className="transition-colors hover:text-primary"
                    >
                      Carried forward from {origin.year}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </RailBlock>

            <RailBlock label="Actions">
              <GoalActions
                goal={goal}
                busy={store.saving}
                onComplete={(note) => void attempt(() => complete(goal.id, note))}
                onHold={(reason) => void attempt(() => hold(goal.id, reason))}
                onResume={() => void attempt(() => resume(goal.id))}
                onCarry={() =>
                  void attempt(async () => {
                    await carryForward(goal.id, goal.year + 1);
                    /* Only once it exists in the new year. */
                    void navigate({ to: "/goals", search: { year: goal.year + 1 } });
                  })
                }
              />
              {failure ? (
                <p role="alert" className="mt-2 text-[12px] text-status-overdue">
                  {errorMessage(failure)}
                </p>
              ) : null}
            </RailBlock>
          </>
        }
      >
        {access && access.level !== "full" ? <AccessNotice decision={access} /> : null}

        {goal.description ? (
          <p className="text-[15px] leading-relaxed">{goal.description}</p>
        ) : null}

        {goal.status === "on-hold" ? (
          <div className="rounded-lg border border-status-waiting/30 bg-status-waiting-soft px-4 py-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-status-waiting">
              <PauseCircle className="size-3.5" aria-hidden />
              On hold
            </p>
            {goal.holdReason ? (
              <p className="mt-1 text-[14px] leading-relaxed">{goal.holdReason}</p>
            ) : null}
          </div>
        ) : null}

        {goal.status === "completed" ? (
          <div className="rounded-lg border border-status-done/30 bg-status-done-soft px-4 py-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-status-done">
              <Check className="size-3.5" aria-hidden />
              Completed
            </p>
            {goal.completionNote ? (
              <p className="mt-1 text-[14px] leading-relaxed">{goal.completionNote}</p>
            ) : null}
          </div>
        ) : null}

        <Section title="Progress" meta={history.length > 0 ? `${history.length}` : undefined}>
          {history.length > 0 ? (
            <ol className="divide-y divide-border">
              {history.map((update) => (
                <li key={update.id} className="flex gap-3 px-4 py-2.5">
                  <span className="w-16 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {formatUpdateDate(update.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[14px] leading-relaxed",
                        update.kind === "completion" && "text-status-done",
                      )}
                    >
                      {update.text}
                    </span>
                    {update.authorId ? (
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        <PersonName personId={update.authorId} />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted-foreground">
              Nothing recorded yet. Add a note as things move.
            </p>
          )}
          <AddUpdate onAdd={(text) => attempt(() => addUpdate(goal.id, text, person.id))} />
        </Section>

        {/*
         * Progress is information: noting that a goal moved to 60% asks
         * nothing of anybody. Guidance, a decision about changing the goal, or
         * help with something blocking it are asked for here, deliberately.
         */}
        <EscalationControl
          sourceType="goal"
          sourceId={goal.id}
          contextLabel={`Goal · ${goal.title}`}
        />

        {linkedEntries.length > 0 ? (
          <Section title="Related binder records">
            <ul className="divide-y divide-border">
              {linkedEntries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{entry.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      Schedule
                      {entry.startTime ? ` · ${formatTime(entry.startTime)}` : ""}
                    </span>
                  </span>
                  <Link
                    to="/monthly-calendar"
                    search={{}}
                    className="shrink-0 inline-flex min-h-6 items-center text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    View in the calendar
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </DetailLayout>
    </Page>
  );
}

function formatUpdateDate(value: string): string {
  const parts = value.split("-");
  if (parts.length === 2) {
    return format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1), "MMM");
  }
  return format(fromISO(value), "d MMM");
}

function AddUpdate({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = text.trim();
        if (!value) return;
        /* Clear only once it is saved, so a refusal does not eat what was
           typed — the alert beside Actions says what went wrong. */
        void onAdd(value).then(() => setText(""));
      }}
      className="flex items-center gap-2 border-t border-border px-4 py-2"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a progress note"
        aria-label="Add a progress note"
        className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-muted-foreground"
      />
      {text.trim() ? (
        <button
          type="submit"
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Add
        </button>
      ) : null}
    </form>
  );
}

function GoalActions({
  goal,
  busy,
  onComplete,
  onHold,
  onResume,
  onCarry,
}: {
  goal: Goal;
  busy: boolean;
  onComplete: (note?: string) => void;
  onHold: (reason?: string) => void;
  onResume: () => void;
  onCarry: () => void;
}) {
  const [noteFor, setNoteFor] = useState<"complete" | "hold" | null>(null);
  const [note, setNote] = useState("");

  const button =
    "flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-disabled";

  if (noteFor) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = note.trim();
          if (noteFor === "complete") onComplete(value || undefined);
          else onHold(value || undefined);
          setNote("");
          setNoteFor(null);
        }}
        className="space-y-2"
      >
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">
            {noteFor === "complete" ? "Completion note — optional" : "Reason — optional"}
          </span>
          <textarea
            autoFocus
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setNoteFor(null);
              setNote("");
            }}
            className="flex-1 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-md bg-primary px-2.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Saving…" : noteFor === "complete" ? "Complete" : "Hold"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-1.5">
      {goal.status === "active" ? (
        <>
          <button
            type="button"
            onClick={() => setNoteFor("complete")}
            disabled={busy}
            className={button}
          >
            <Check className="size-3.5 shrink-0 text-status-done" aria-hidden />
            Mark complete
          </button>
          <button
            type="button"
            onClick={() => setNoteFor("hold")}
            disabled={busy}
            className={button}
          >
            <PauseCircle className="size-3.5 shrink-0 text-status-waiting" aria-hidden />
            Put on hold
          </button>
        </>
      ) : null}

      {goal.status === "on-hold" ? (
        <button type="button" onClick={onResume} disabled={busy} className={button}>
          <PlayCircle className="size-3.5 shrink-0 text-primary" aria-hidden />
          Resume goal
        </button>
      ) : null}

      {goal.status !== "carried-forward" ? (
        <button type="button" onClick={onCarry} disabled={busy} className={button}>
          <ArrowRightCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          Carry to {goal.year + 1}
        </button>
      ) : null}
    </div>
  );
}
