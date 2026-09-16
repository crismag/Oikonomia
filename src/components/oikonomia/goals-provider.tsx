import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  addGoalUpdate,
  carryGoalForward,
  completeGoal,
  createGoal,
  deleteGoal,
  fetchGoalYear,
  holdGoal,
  resumeGoal,
  updateGoal,
  type GoalYear,
} from "@/lib/goals-api";
import { isConflict, unwrap, withTimeout } from "@/lib/calendar-client";
import type { Goal, GoalScope, GoalTarget, GoalUpdate } from "@/domain/types";

/**
 * Goals state, over real persistence.
 *
 * The operations are the ones the paper page supports: write a goal, annotate
 * it, tick it off, put it on hold, pick it up again, carry it into next year.
 * Nothing here asks for approval or assigns work.
 *
 * ## Two years, not one
 *
 * Goals are read a year at a time, and the Goals page can be pointed at any
 * year. But the ministry pages and the binder home ask "how are *this year's*
 * goals going" — so the current year is always loaded, and the year being
 * viewed is loaded alongside it when it differs. Holding only the selected
 * year would make a visit to 2025 quietly empty every count elsewhere.
 */

export interface GoalsStore {
  goals: Goal[];
  updates: GoalUpdate[];

  /** The year the Goals page is showing. The current year is always loaded. */
  year: number;
  setYear: (year: number) => void;
  /** Years that have goals in them, newest first. */
  years: number[];
  /** How many goals this year the viewer may not read. Existence, not identity. */
  withheld: number;

  status: "loading" | "ready" | "error";
  error: unknown;
  retry: () => void;
  saving: boolean;

  /** Whose the goal is is part of setting it; the server checks the rest. */
  addGoal: (input: {
    title: string;
    year: number;
    scope: GoalScope;
    target?: GoalTarget;
    ministryId?: string;
    groupId?: string;
  }) => Promise<void>;
  /*
   * Changes to a goal state the version the page loaded (`goal.version`). A
   * stale one is refused with a conflict and the year is fetched again, so the
   * person sees what somebody else did instead of overwriting it.
   */
  editGoal: (
    id: string,
    patch: Partial<Goal>,
    expectedVersion: number | undefined,
  ) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
  addUpdate: (goalId: string, text: string, authorId?: string) => Promise<void>;
  complete: (goal: Goal, note?: string) => Promise<void>;
  hold: (goal: Goal, reason?: string) => Promise<void>;
  resume: (goal: Goal) => Promise<void>;
  carryForward: (goal: Goal, toYear: number) => Promise<void>;
}

const GoalsContext = createContext<GoalsStore | null>(null);

export function useGoals(): GoalsStore {
  const value = useContext(GoalsContext);
  if (!value) throw new Error("useGoals must be used inside GoalsProvider");
  return value;
}

const versionOf = (version: number | undefined) =>
  version !== undefined ? { expectedVersion: version } : {};

const EMPTY: GoalYear = { goals: [], updates: [], withheld: 0, years: [] };

export function GoalsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const yearQuery = (target: number) => ({
    queryKey: ["goals", target],
    queryFn: async () => unwrap(await withTimeout(fetchGoalYear({ data: { year: target } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always" as const,
  });

  const selected = useQuery<GoalYear>(yearQuery(year));
  /* Always loaded, so "this year's goals" is answerable from any page. */
  const current = useQuery<GoalYear>({ ...yearQuery(thisYear), enabled: year !== thisYear });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
    [queryClient],
  );

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) =>
      unwrap((await withTimeout(work())) as never),
    onSuccess: invalidate,
    onError: (error) => {
      if (isConflict(error)) void invalidate();
    },
    networkMode: "always" as const,
    retry: 0,
  });

  const call = useCallback(
    async (work: () => Promise<unknown>) => {
      await mutation.mutateAsync(work);
    },
    [mutation],
  );

  const loaded = selected.data ?? EMPTY;
  const alsoCurrent = year === thisYear ? EMPTY : (current.data ?? EMPTY);

  /* One list, no duplicates — the two queries overlap only when they are the
     same year, and then the second is not run at all. */
  const goals = useMemo(() => [...loaded.goals, ...alsoCurrent.goals], [loaded, alsoCurrent]);
  const updates = useMemo(() => [...loaded.updates, ...alsoCurrent.updates], [loaded, alsoCurrent]);

  const store = useMemo<GoalsStore>(
    () => ({
      goals,
      updates,
      year,
      setYear,
      years: loaded.years,
      withheld: loaded.withheld,

      status: selected.isError ? "error" : selected.data ? "ready" : "loading",
      error: selected.error,
      retry: () => void selected.refetch(),
      saving: mutation.isPending,

      addGoal: (input) => call(() => createGoal({ data: input })),
      editGoal: (id, patch, expectedVersion) =>
        call(() => updateGoal({ data: { id, patch, ...versionOf(expectedVersion) } })),
      removeGoal: (id) => call(() => deleteGoal({ data: { id } })),

      addUpdate: (goalId, text) => call(() => addGoalUpdate({ data: { goalId, text } })),

      complete: (goal, note) =>
        call(() => completeGoal({ data: { id: goal.id, note, ...versionOf(goal.version) } })),
      hold: (goal, reason) =>
        call(() => holdGoal({ data: { id: goal.id, reason, ...versionOf(goal.version) } })),
      resume: (goal) =>
        call(() => resumeGoal({ data: { id: goal.id, ...versionOf(goal.version) } })),
      carryForward: (goal, toYear) =>
        call(() => carryGoalForward({ data: { id: goal.id, toYear, ...versionOf(goal.version) } })),
    }),
    [goals, updates, year, loaded, selected, mutation.isPending, call],
  );

  return <GoalsContext.Provider value={store}>{children}</GoalsContext.Provider>;
}
