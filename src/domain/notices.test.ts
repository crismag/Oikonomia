import { describe, expect, it } from "vitest";

import { noticesFor } from "./notices";
import type { Escalation } from "./escalation";
import type { MeetingTaskEntry } from "./planning";

/**
 * The bell must stay honest: it counts only what is new and was given to this
 * leader by somebody else, seeing clears it, and past-due work is shown but
 * never counted.
 */
const ask = (over: Partial<Escalation & { settled: boolean }> = {}) =>
  ({
    id: "esc-1",
    type: "action",
    status: "requested",
    sourceType: "leadership-report",
    sourceId: "lr-1",
    contextLabel: "September report",
    request: "Confirm the venue",
    requestedById: "p-ruth",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
    settled: false,
    ...over,
  }) as Escalation & { settled: boolean };

const task = (
  over: Partial<MeetingTaskEntry["task"]> = {},
  entry: Partial<MeetingTaskEntry> = {},
) =>
  ({
    task: {
      id: "t-1",
      meetingId: "mn-1",
      title: "Book the hall",
      status: "open",
      createdAt: "2026-09-01",
      ...over,
    },
    contextLabel: "Leaders meeting",
    readable: true,
    byYou: false,
    ...entry,
  }) as MeetingTaskEntry;

const run = (input: Partial<Parameters<typeof noticesFor>[0]>) =>
  noticesFor({
    viewerId: "p-me",
    asks: [],
    tasks: [],
    isSeen: () => false,
    today: "2026-09-16",
    ...input,
  });

describe("noticesFor", () => {
  it("counts an unseen ask from somebody else, and opens where it was asked", () => {
    const { fresh } = run({ asks: [ask()] });
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.href).toEqual({ to: "/leadership-reports/lr-1" });
  });

  it("clears once seen, without the ask going anywhere", () => {
    const { fresh } = run({
      asks: [ask()],
      isSeen: (type, id) => type === "escalation" && id === "esc-1",
    });
    expect(fresh).toHaveLength(0);
  });

  it("does not count asks this leader made of themselves, or settled ones", () => {
    expect(run({ asks: [ask({ requestedById: "p-me" })] }).fresh).toHaveLength(0);
    expect(run({ asks: [ask({ settled: true })] }).fresh).toHaveLength(0);
  });

  it("counts a meeting task somebody else gave, not one a leader wrote for themselves", () => {
    expect(run({ tasks: [task()] }).fresh).toHaveLength(1);
    expect(run({ tasks: [task({}, { byYou: true })] }).fresh).toHaveLength(0);
    expect(run({ tasks: [task({ status: "done" })] }).fresh).toHaveLength(0);
  });

  it("sends a task from a note they may not read to the week, not the note", () => {
    const [notice] = run({ tasks: [task({ dueDate: "2026-09-20" }, { readable: false })] }).fresh;
    expect(notice?.href).toEqual({ to: "/weekly-agenda", search: { date: "2026-09-20" } });
  });

  it("lists past-due work separately, whether or not it has been seen", () => {
    const { fresh, pastDue } = run({
      asks: [ask({ neededBy: "2026-09-01" })],
      tasks: [task({ dueDate: "2026-09-10" }), task({ id: "t-2", dueDate: "2026-09-30" })],
      isSeen: () => true,
    });
    expect(fresh).toHaveLength(0);
    expect(pastDue.map((n) => n.itemId)).toEqual(["esc-1", "t-1"]);
  });
});
