import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { addUpdate, createGoal, goalsForYear, updateGoal } from "@/domain/goals-contract";
import { canEdit } from "@/domain/authorize";
import { canOpen, resolveAccess } from "@/domain/access";
import { todayISO } from "@/domain/goals";
import type { GoalValues, GoalsRepository } from "../repositories/goals-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { Goal, GoalUpdate } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Goals decisions.
 *
 * ## Why readability is decided in memory here, and in SQL for Meeting Notes
 *
 * The opposite choice, on purpose.
 *
 * A meeting note's readability is two comparisons — author, or a participant on
 * minutes — so it expresses as SQL, and it *had* to, because the list pages and
 * a `COUNT(*)` over everything would have told a viewer how many notes they
 * could not read.
 *
 * A goal's readability is an `AudiencePolicy`: classification ceilings,
 * explicit audiences, groups, campus scope, ownership, exclusions. Mirroring
 * that in SQL would be a second implementation of the most subtle rule in the
 * product, and it would drift. Goals are read **a year at a time and are not
 * paged**, so nothing forces the issue: the whole year is loaded and
 * `resolveAccess` decides, once, in the one place that knows how.
 *
 * The count a page shows is deliberate rather than accidental. "3 goals are
 * held to a narrower audience and not listed" is the product's existing answer
 * — aggregate existence may be acknowledged; identity may not.
 */

export function createGoalsService(repo: GoalsRepository, organization?: OrganizationRepository) {
  const readable = (viewer: Viewer, goal: Goal) =>
    !goal.policy || canOpen(resolveAccess(viewer.persona, viewer.person, goal.policy));

  function require(viewer: Viewer, id: string): Goal {
    const goal = repo.findGoal(id);
    if (!goal || !readable(viewer, goal)) throw ApiError.notFound("That goal");
    return goal;
  }

  function requireWritable(viewer: Viewer, id: string): Goal {
    const goal = require(viewer, id);
    if (!canEdit(viewer, subjectFor(goal))) {
      throw ApiError.forbidden(refusalFor(goal));
    }
    return goal;
  }

  /* Who may change a goal is the rule of whatever it belongs to, so that
     ministry or group is handed over — the authorizer does not reach for a
     directory of its own. */
  function subjectFor(goal: Goal) {
    const ministry =
      goal.scope === "ministry" && goal.ministryId
        ? organization?.findMinistry(goal.ministryId)
        : undefined;
    const group =
      goal.scope === "other" && goal.groupId ? organization?.findGroup(goal.groupId) : undefined;
    return {
      kind: "goal" as const,
      goal,
      ...(ministry ? { ministry } : {}),
      ...(group ? { group } : {}),
    };
  }

  function refusalFor(goal: Goal): string {
    if (goal.scope === "personal") return text("refusal.goal.personal");
    if (goal.scope === "other") return text("refusal.goal.otherGroup");
    return text("refusal.goal.otherMinistry");
  }

  /** Everything the repository needs back, minus what it owns. */
  const values = (goal: Goal): GoalValues => {
    const { id: _id, createdAt: _created, version: _version, ...rest } = goal;
    return rest;
  };

  /**
   * Write the goal, refusing a stale version when the caller stated one.
   *
   * A ministry's goal is maintained by everyone who works in it, so one leader
   * putting a goal on hold must not quietly undo another marking it complete.
   */
  function commit(id: string, next: GoalValues, expectedVersion?: number): Goal {
    const saved = repo.saveGoal(id, next, expectedVersion);
    if (saved === "stale") {
      throw ApiError.conflict(text("refusal.goals.staleVersion"));
    }
    if (!saved) throw ApiError.notFound("That goal");
    return saved;
  }

  /** A status change is a line in the goal's history, not only a column. */
  function record(goal: Goal, viewer: Viewer, text: string, kind: GoalUpdate["kind"]) {
    repo.insertUpdate({
      goalId: goal.id,
      date: todayISO(),
      text,
      kind,
      authorId: viewer.person.id,
    });
  }

  return {
    /**
     * A year of goals, and how many were withheld.
     *
     * The count is stated because the page states it: a leader seeing four
     * goals should know whether that is the year or only their part of it.
     */
    listYear(viewer: Viewer, input: unknown) {
      const { year } = parse(goalsForYear, input);
      const all = repo.goalsForYear(year);
      const goals = all.filter((goal) => readable(viewer, goal));

      return {
        goals,
        updates: repo.updatesFor(goals.map((g) => g.id)),
        withheld: all.length - goals.length,
        years: repo.years(),
      };
    },

    getGoal(viewer: Viewer, id: string) {
      const goal = require(viewer, id);
      return { goal, updates: repo.updatesFor([goal.id]) };
    },

    /**
     * Setting a goal, for whoever or whatever it belongs to.
     *
     * A personal goal is always the person setting it. A ministry's or a
     * group's goal may only be set by somebody who could change it afterwards
     * — the same rule, asked before the write rather than after.
     */
    createGoal(viewer: Viewer, input: unknown): Goal {
      const parsed = parse(createGoal, input);

      const ministryId = parsed.scope === "other" ? undefined : parsed.ministryId;
      if (ministryId && !organization?.findMinistry(ministryId)) {
        throw ApiError.notFound("That ministry");
      }
      if (parsed.scope === "other" && !organization?.findGroup(parsed.groupId)) {
        throw ApiError.notFound("That group");
      }

      const draft = {
        ...parsed,
        status: "active",
        ownerId:
          parsed.scope === "personal" ? viewer.person.id : (parsed.ownerId ?? viewer.person.id),
      } as Omit<GoalValues, "number">;

      const preview = { ...draft, id: "", number: 0, createdAt: "" } as Goal;
      if (!canEdit(viewer, subjectFor(preview))) {
        throw ApiError.forbidden(
          parsed.scope === "ministry"
            ? text("refusal.goal.ministryOnly")
            : text("refusal.goal.groupOnly"),
        );
      }

      return repo.insertGoal(draft);
    },

    /**
     * Change what a goal says.
     *
     * The caller states the version it loaded; a stale one is refused. An
     * omitted version is the old last-writer behaviour, never used by the page.
     */
    updateGoal(viewer: Viewer, id: string, input: unknown, expectedVersion?: number): Goal {
      const goal = requireWritable(viewer, id);
      const patch = parse(updateGoal, input);
      return commit(id, { ...values(goal), ...patch } as GoalValues, expectedVersion);
    },

    deleteGoal(viewer: Viewer, id: string): void {
      requireWritable(viewer, id);
      repo.deleteGoal(id);
    },

    /* ----------------------------------------------------------- progress */

    addUpdate(viewer: Viewer, input: unknown): GoalUpdate {
      const parsed = parse(addUpdate, input);
      requireWritable(viewer, parsed.goalId);

      return repo.insertUpdate({
        goalId: parsed.goalId,
        date: parsed.date ?? todayISO(),
        text: parsed.text,
        kind: parsed.kind ?? "note",
        authorId: viewer.person.id,
      });
    },

    /**
     * Finishing a goal.
     *
     * The note is why it is worth recording at all — "we did it" is the part a
     * leader reads back in December — so it is kept as an update as well as on
     * the goal, where the year's history shows it in order.
     */
    complete(viewer: Viewer, id: string, note?: string, expectedVersion?: number): Goal {
      const goal = requireWritable(viewer, id);
      if (goal.status === "completed")
        throw ApiError.conflict(text("refusal.goal.alreadyComplete"));

      const saved = commit(
        id,
        {
          ...values(goal),
          status: "completed",
          completedAt: todayISO(),
          ...(note?.trim() ? { completionNote: note.trim() } : {}),
          /* Finishing something lifts any hold that was on it. */
          holdSince: undefined,
          holdReason: undefined,
        } as GoalValues,
        expectedVersion,
      );

      record(goal, viewer, note?.trim() || "Completed.", "completion");
      return saved;
    },

    /** A goal on hold is not a goal abandoned, and the reason is the point. */
    hold(viewer: Viewer, id: string, reason?: string, expectedVersion?: number): Goal {
      const goal = requireWritable(viewer, id);

      const saved = commit(
        id,
        {
          ...values(goal),
          status: "on-hold",
          holdSince: todayISO(),
          ...(reason?.trim() ? { holdReason: reason.trim() } : {}),
        } as GoalValues,
        expectedVersion,
      );

      record(goal, viewer, reason?.trim() ? `On hold — ${reason.trim()}` : "On hold.", "status");
      return saved;
    },

    resume(viewer: Viewer, id: string, expectedVersion?: number): Goal {
      const goal = requireWritable(viewer, id);

      const saved = commit(
        id,
        {
          ...values(goal),
          status: "active",
          holdSince: undefined,
          holdReason: undefined,
        } as GoalValues,
        expectedVersion,
      );

      record(goal, viewer, "Picked up again.", "status");
      return saved;
    },

    /**
     * Carrying a goal into a later year.
     *
     * A new goal in the new year, pointing back at the old one, and the old one
     * marked as carried rather than deleted. A year's binder is a record of
     * what that year intended; rewriting it in January would lose exactly the
     * thing the record is for.
     */
    carryForward(viewer: Viewer, id: string, toYear: number, expectedVersion?: number): Goal {
      const goal = requireWritable(viewer, id);
      if (toYear <= goal.year) {
        throw ApiError.validation({ toYear: text("refusal.goal.carryBackward") });
      }
      /* Checked before the new year's copy exists, so a stale carry leaves
         nothing half-made behind. */
      if (expectedVersion !== undefined && goal.version !== expectedVersion) {
        throw ApiError.conflict(text("refusal.goals.staleVersion"));
      }

      const { number: _position, ...carriedValues } = values(goal);
      const carried = repo.insertGoal({
        ...carriedValues,
        year: toYear,
        /* Not the old year's position: the new year numbers from its own start. */
        status: "active",
        carriedFromGoalId: goal.id,
        completedAt: undefined,
        completionNote: undefined,
        holdSince: undefined,
        holdReason: undefined,
      } as Omit<GoalValues, "number">);

      commit(id, { ...values(goal), status: "carried-forward" } as GoalValues);
      record(goal, viewer, `Carried forward to ${toYear}.`, "status");

      return carried;
    },
  };
}

export type GoalsService = ReturnType<typeof createGoalsService>;
