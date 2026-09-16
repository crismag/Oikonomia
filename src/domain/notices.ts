import { escalationHref, escalationLabel, isOverdue, type Escalation } from "./escalation";
import type { MeetingTaskEntry } from "./planning";

/**
 * In-app notices: what the bell in the top bar says.
 *
 * The product's rule is that attention must stay honest and must not become a
 * queue. So a notice is only ever one of two things, both about work that is
 * already the leader's:
 *
 * - **new** — something another leader asked of them, or a task somebody else
 *   gave them in a meeting, that they have not seen yet. Only these count on
 *   the bell, and seeing them clears the count: seen is not done, and the work
 *   stays where it lives (the inbox, the week).
 * - **past due** — an open ask or a dated meeting task whose date has gone. Shown
 *   when the leader opens the bell, never counted on it, because a number that
 *   cannot go down until the work is finished is a queue by another name.
 *
 * Nothing here is sent anywhere. The same two **new** kinds may also be
 * emailed, to a leader who turned that on (`email-notices.ts`); past-due is
 * never emailed, and there is no push and no reminder. A report arriving is
 * information and is not a notice at all.
 */

export type NoticeKind = "ask" | "meeting-task";

export interface Notice {
  /** The read-state key: what "seen" is recorded against. */
  itemType: "escalation" | "meeting-task";
  itemId: string;
  kind: NoticeKind;
  title: string;
  /** What kind of ask, or which meeting — in words the leader recognises. */
  context: string;
  /** Who asked, for an ask. */
  fromId?: string;
  href: { to: string; search?: Record<string, string> };
}

type Ask = Escalation & { settled: boolean };

export function noticesFor(input: {
  viewerId: string;
  /** Unsettled asks made of this viewer — the inbox's `mine`. */
  asks: readonly Ask[];
  /** Meeting tasks assigned to this viewer. */
  tasks: readonly MeetingTaskEntry[];
  isSeen: (itemType: string, itemId: string) => boolean;
  today: string;
}): { fresh: Notice[]; pastDue: Notice[] } {
  const askNotice = (ask: Ask): Notice => ({
    itemType: "escalation",
    itemId: ask.id,
    kind: "ask",
    title: ask.request,
    context: ask.contextLabel
      ? `${escalationLabel[ask.type]} · ${ask.contextLabel}`
      : escalationLabel[ask.type],
    fromId: ask.requestedById,
    href: escalationHref(ask.sourceType, ask.sourceId) ?? { to: "/inbox" },
  });

  const taskNotice = ({ task, contextLabel, readable }: MeetingTaskEntry): Notice => ({
    itemType: "meeting-task",
    itemId: task.id,
    kind: "meeting-task",
    title: task.title,
    context: contextLabel,
    /* The note only when they may read it; otherwise the task's day on the week. */
    href: readable
      ? { to: "/meeting-notes", search: { note: task.meetingId } }
      : { to: "/weekly-agenda", ...(task.dueDate ? { search: { date: task.dueDate } } : {}) },
  });

  const openAsks = input.asks.filter((ask) => !ask.settled);
  const openTasks = input.tasks.filter((entry) => entry.task.status !== "done");

  const fresh = [
    ...openAsks
      /* Asking yourself something is not news. */
      .filter((ask) => ask.requestedById !== input.viewerId)
      .filter((ask) => !input.isSeen("escalation", ask.id))
      .map(askNotice),
    ...openTasks
      .filter((entry) => !entry.byYou)
      .filter((entry) => !input.isSeen("meeting-task", entry.task.id))
      .map(taskNotice),
  ];

  const pastDue = [
    ...openAsks.filter((ask) => isOverdue(ask, input.today)).map(askNotice),
    ...openTasks
      .filter((entry) => !!entry.task.dueDate && entry.task.dueDate < input.today)
      .map(taskNotice),
  ];

  return { fresh, pastDue };
}
