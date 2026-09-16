import { afterEach, describe, expect, it } from "vitest";

import { applyOverrides, resetOverrides } from "@/config";

import {
  assignedToMe,
  attendanceHistory,
  attendanceTally,
  attendeeLabel,
  awaitingMark,
  canReadEntry,
  composeReport,
  gatheringsAtVenue,
  gatheringHeadline,
  homeGatherings,
  leadsGathering,
  otherScheduled,
  outstanding,
  readableEntries,
  recentlyLed,
  usedCategories,
  venueName,
  venuesAttended,
  visibilityOf,
  withheldCount,
} from "./lifegroup";
import {
  exhortations,
  gatheringAttendance,
  gatheringReports,
  gatherings,
  lifegroupEntries,
  venues,
} from "@/test/fixtures";
import type { Gathering, GatheringAttendance, LifegroupEntry } from "./types";

/**
 * LifeGroup behaviour.
 *
 * The model these cases defend is that a gathering is the record and nothing
 * above it is permanent. Most of what follows is written as the absence of
 * something: no roster appears, no membership is inferred, no leader keeps a
 * venue. Those are the failures worth catching.
 */

const gathering = (over: Partial<Gathering> = {}): Gathering => ({
  id: "g1",
  date: "2026-09-10",
  venueId: "v1",
  assignedLeaderIds: ["p-maria"],
  status: "open",
  ...over,
});

const attend = (over: Partial<GatheringAttendance> = {}): GatheringAttendance => ({
  id: "a1",
  gatheringId: "g1",
  personId: "p-juan",
  status: "present",
  ...over,
});

const entry = (over: Partial<LifegroupEntry> = {}): LifegroupEntry => ({
  id: "e1",
  gatheringId: "g1",
  authorId: "p-maria",
  body: "Something was shared.",
  createdAt: "2026-09-10T20:00:00",
  ...over,
});

const leaders = { isLeader: true, isAssignedLeader: true };
const anyLeader = { isLeader: true, isAssignedLeader: false };

/* ------------------------------------------------- leadership per occurrence */

describe("leadership is attached to the occurrence", () => {
  it("recognises an assigned leader", () => {
    expect(leadsGathering(gathering(), "p-maria")).toBe(true);
  });

  it("does not treat leading one gathering as leading the next", () => {
    const thisWeek = gathering({ id: "g1", assignedLeaderIds: ["p-maria"] });
    const nextWeek = gathering({ id: "g2", assignedLeaderIds: ["p-mark"] });
    expect(leadsGathering(nextWeek, "p-maria")).toBe(false);
    expect(leadsGathering(thisWeek, "p-mark")).toBe(false);
  });

  it("allows several leaders on one gathering", () => {
    const shared = gathering({ assignedLeaderIds: ["p-maria", "p-john"] });
    expect(leadsGathering(shared, "p-maria")).toBe(true);
    expect(leadsGathering(shared, "p-john")).toBe(true);
  });

  it("lists a leader's own assignments soonest first", () => {
    const list = [
      gathering({ id: "later", date: "2026-09-24" }),
      gathering({ id: "sooner", date: "2026-09-17" }),
      gathering({ id: "someone else", assignedLeaderIds: ["p-mark"], date: "2026-09-18" }),
    ];
    expect(assignedToMe(list, "p-maria", "2026-09-11").map((g) => g.id)).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("leaves a cancelled gathering out of the leader's list", () => {
    const list = [gathering({ id: "off", date: "2026-09-17", status: "cancelled" })];
    expect(assignedToMe(list, "p-maria", "2026-09-11")).toHaveLength(0);
  });

  /** Seeing the church's schedule must not look like being assigned to it. */
  it("keeps other people's gatherings separate from your own", () => {
    const list = [
      gathering({ id: "mine", date: "2026-09-17" }),
      gathering({ id: "theirs", date: "2026-09-17", assignedLeaderIds: ["p-daniel"] }),
    ];
    expect(otherScheduled(list, "p-maria", "2026-09-11").map((g) => g.id)).toEqual(["theirs"]);
  });
});

/* ------------------------------------------------------------------ venues */

describe("a venue is a place, not a group", () => {
  it("names a gathering by its venue and date, never by a group", () => {
    expect(venueName(venues, gatherings[0]!)).toBe("Baronia Residence");
  });

  it("falls back to the snapshot when the venue record is gone", () => {
    const orphan = gathering({ venueId: "deleted", venueName: "Manse Residence" });
    expect(venueName(venues, orphan)).toBe("Manse Residence");
  });

  it("names a gathering by what still needs doing when there is no venue", () => {
    const led: Gathering = {
      id: "g-led",
      date: "2026-09-10",
      assignedLeaderIds: ["p-maria"],
      status: "open",
    };
    const unclaimed: Gathering = {
      id: "g-open",
      date: "2026-09-10",
      assignedLeaderIds: [],
      status: "open",
    };
    expect(gatheringHeadline(venues, led)).toBe("Set the venue");
    expect(gatheringHeadline(venues, unclaimed)).toBe("Unclaimed gathering");
    expect(gatheringHeadline(venues, gatherings[0]!)).toBe("Baronia Residence");
  });

  /** Acceptance §9.4 — a venue hosts many gatherings and stays a venue. */
  it("hosts many gatherings without becoming a container", () => {
    const atBaronia = gatheringsAtVenue(gatherings, "ven-baronia");
    expect(atBaronia.length).toBeGreaterThan(2);
    const leaders = new Set(atBaronia.flatMap((g) => g.assignedLeaderIds));
    expect(leaders.size).toBeGreaterThan(1);
    expect(atBaronia[0]).not.toHaveProperty("members");
  });
});

/* -------------------------------------------------------------- attendance */

describe("expected and actual attendance stay distinct", () => {
  /** Acceptance §9.3 — ten signed up, seven came. */
  it("counts signups from the gathering and presence from the records", () => {
    const signup = gathering({
      expectedAttendeeIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
    const records = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
      attend({ id: `att-${id}`, personId: id, expected: true }),
    );
    const tally = attendanceTally(signup, records);
    expect(tally.expected).toBe(10);
    expect(tally.expectedPresent).toBe(7);
  });

  it("does the same on the shipped fixtures", () => {
    const big = gatherings.find((g) => g.id === "gth-5")!;
    const tally = attendanceTally(big, gatheringAttendance);
    expect(tally.expected).toBe(10);
    expect(tally.expectedPresent).toBe(7);
  });

  /** Leaders and walk-ins were in the room but never part of the signup. */
  it("counts people who came without signing up separately", () => {
    const big = gatherings.find((g) => g.id === "gth-5")!;
    const tally = attendanceTally(big, gatheringAttendance);
    expect(tally.walkIn).toBe(3);
    expect(tally.present).toBe(tally.expectedPresent + tally.walkIn);
  });

  it("lists who signed up and has not been marked", () => {
    const signup = gathering({ expectedAttendeeIds: ["a", "b", "c"] });
    expect(awaitingMark(signup, [attend({ personId: "a" })])).toEqual(["b", "c"]);
  });

  it("records someone who was there without being in People", () => {
    const guest: GatheringAttendance = {
      id: "guest",
      gatheringId: "g1",
      name: "Grace",
      status: "present",
      firstTime: true,
    };
    expect(attendeeLabel(guest, () => "should not be called")).toBe("Grace");
    expect(attendanceTally(gathering(), [guest]).firstTime).toBe(1);
  });

  it("counts absent and excused apart from present", () => {
    const records = [
      attend({ id: "1", personId: "a", status: "present" }),
      attend({ id: "2", personId: "b", status: "absent" }),
      attend({ id: "3", personId: "c", status: "excused" }),
    ];
    const tally = attendanceTally(gathering(), records);
    expect(tally).toMatchObject({ present: 1, absent: 1, excused: 1 });
  });
});

describe("attendance is history, not membership", () => {
  /** Acceptance §9.2 — Juan at SC Church, then Thomson Park. Nothing moves. */
  it("lets one person attend different venues in consecutive weeks", () => {
    const history = attendanceHistory(gatherings, gatheringAttendance, "p-juan");
    const venueIds = history.map(({ gathering }) => gathering.venueId);
    expect(new Set(venueIds).size).toBeGreaterThan(1);
    expect(venueIds).toContain("ven-sc-church");
    expect(venueIds).toContain("ven-thomson");
  });

  it("produces a history and never an assignment", () => {
    const history = attendanceHistory(gatherings, gatheringAttendance, "p-juan");
    for (const { record } of history) {
      expect(record).not.toHaveProperty("memberSince");
      expect(record).not.toHaveProperty("lifegroupId");
    }
  });

  /** Repetition is a convenience for the leader's eye, never a relationship. */
  it("counts repeat visits without creating membership anywhere", () => {
    const records = [
      attend({ id: "1", gatheringId: "g1" }),
      attend({ id: "2", gatheringId: "g2" }),
      attend({ id: "3", gatheringId: "g3" }),
    ];
    const list = [
      gathering({ id: "g1", venueId: "ven-a" }),
      gathering({ id: "g2", venueId: "ven-a" }),
      gathering({ id: "g3", venueId: "ven-b" }),
    ];
    expect(venuesAttended(list, records, "p-juan")).toEqual([
      { venueId: "ven-a", times: 2 },
      { venueId: "ven-b", times: 1 },
    ]);
  });

  it("does not count an absence as having been somewhere", () => {
    const records = [attend({ id: "1", status: "absent" })];
    expect(venuesAttended([gathering()], records, "p-juan")).toEqual([]);
  });
});

/* -------------------------------------------------- Maria's two Thursdays */

describe("the same leader at different venues", () => {
  /** Acceptance §9.1 — Manse this Thursday, Baronia the next. */
  it("shows both as occurrence-level assignments", () => {
    const manse = gatherings.find((g) => g.id === "gth-6")!;
    const baronia = gatherings.find((g) => g.id === "gth-7")!;

    expect(leadsGathering(manse, "p-maria")).toBe(true);
    expect(leadsGathering(baronia, "p-maria")).toBe(true);
    expect(manse.venueId).not.toBe(baronia.venueId);
    expect(baronia.date > manse.date).toBe(true);
  });

  it("does not give her the venue in between", () => {
    const someoneElse = gatherings.find((g) => g.id === "gth-8")!;
    expect(leadsGathering(someoneElse, "p-maria")).toBe(false);
  });

  it("still lists what she has already led", () => {
    const led = recentlyLed(gatherings, "p-maria", "2999-01-01");
    expect(led.length).toBeGreaterThan(0);
    expect(led.every((g) => leadsGathering(g, "p-maria"))).toBe(true);
  });
});

/* ------------------------------------------------------------ visibility */

describe("who may read an entry", () => {
  it("treats an ordinary entry as leadership material, not private material", () => {
    expect(visibilityOf(entry())).toBe("leaders");
    expect(canReadEntry(entry(), "p-other", anyLeader)).toBe(true);
  });

  /** Acceptance §9.5 — the ordinary line is shared, the pastoral one is not. */
  it("holds a restricted pastoral entry to its named viewers", () => {
    const pastoral = entry({
      id: "e2",
      visibility: "selected-viewers",
      viewerIds: ["p-bishop"],
    });
    expect(canReadEntry(pastoral, "p-bishop", anyLeader)).toBe(true);
    expect(canReadEntry(pastoral, "p-daniel", anyLeader)).toBe(false);
  });

  it("keeps an assigned-leaders entry away from other leaders", () => {
    const held = entry({ visibility: "assigned-leaders", authorId: "p-john" });
    expect(canReadEntry(held, "p-maria", leaders)).toBe(true);
    expect(canReadEntry(held, "p-daniel", anyLeader)).toBe(false);
  });

  it("shows a private entry to nobody but its author", () => {
    const mine = entry({ visibility: "private" });
    expect(canReadEntry(mine, "p-maria", leaders)).toBe(true);
    expect(canReadEntry(mine, "p-bishop", leaders)).toBe(false);
  });

  it("always lets the author read what they wrote", () => {
    const theirs = entry({ authorId: "p-mark", visibility: "private" });
    expect(canReadEntry(theirs, "p-mark", { isLeader: false, isAssignedLeader: false })).toBe(true);
  });

  it("filters the list rather than leaving it to the page", () => {
    const all = [entry({ id: "open" }), entry({ id: "held", visibility: "private" })];
    expect(readableEntries(all, "g1", "p-daniel", anyLeader).map((e) => e.id)).toEqual(["open"]);
  });

  it("reports what it withheld as a count, never as content", () => {
    const all = [entry({ id: "open" }), entry({ id: "held", visibility: "private" })];
    expect(withheldCount(all, "g1", "p-daniel", anyLeader)).toBe(1);
  });
});

/* ---------------------------------------------------------------- report */

describe("the report", () => {
  const compose = (viewerId: string, context: typeof leaders) =>
    composeReport(
      gatherings.find((g) => g.id === "gth-5")!,
      venues,
      gatheringAttendance,
      lifegroupEntries,
      exhortations,
      gatheringReports,
      viewerId,
      context,
    );

  it("is composed from the records the leader already entered", () => {
    const sheet = compose("p-maria", leaders);
    expect(sheet.venue).toBe("Baronia Residence");
    expect(sheet.tally.expectedPresent).toBe(7);
    expect(sheet.exhortation?.topic).toBe("Faithfulness in Small Things");
  });

  /** Acceptance §9.6 — the page carries only what this reader may see. */
  it("prints only what the viewer is permitted to read", () => {
    const forDaniel = compose("p-daniel", anyLeader);
    const bodies = forDaniel.entries.map((e) => e.body).join(" ");
    expect(bodies).not.toContain("Pastoral follow-up");
    expect(forDaniel.withheld).toBe(1);
  });

  it("shows the pastoral entry to the person it was shared with", () => {
    const forBishop = compose("p-bishop", anyLeader);
    expect(forBishop.entries.map((e) => e.body).join(" ")).toContain("Pastoral follow-up");
    expect(forBishop.withheld).toBe(0);
  });

  /** Acceptance §9.7 — nothing unrelated blocks an ordinary report. */
  it("asks only for attendance", () => {
    const bare = gathering();
    expect(outstanding(bare, [attend()], [])).toEqual(["Exhortation"]);
    expect(outstanding(bare, [attend()], [{ gatheringId: "g1", topic: "Thanksgiving" }])).toEqual(
      [],
    );
  });

  it("treats a topic with no scripture and no notes as complete", () => {
    const topicOnly = exhortations.find((e) => e.gatheringId === "gth-3")!;
    expect(topicOnly.scripture).toBeUndefined();
    expect(outstanding(gatherings[2]!, gatheringAttendance, exhortations)).toEqual([]);
  });
});

describe("categories", () => {
  it("offers only the categories actually used, so no dead chips", () => {
    const all = [entry({ category: "prayer" }), entry({ id: "e2" })];
    expect(usedCategories(all)).toEqual(["prayer"]);
  });

  it("treats an uncategorized entry as a perfectly good entry", () => {
    expect(readableEntries([entry()], "g1", "p-maria", leaders)).toHaveLength(1);
  });
});

/* --------------------------------------------- what must no longer exist */

describe("the discarded model", () => {
  it("keeps no roster on a gathering", () => {
    for (const g of gatherings) {
      expect(g).not.toHaveProperty("members");
      expect(g).not.toHaveProperty("lifegroupId");
      expect(g).not.toHaveProperty("leaderId");
    }
  });

  it("keeps no membership on a venue", () => {
    for (const venue of venues) {
      expect(venue).not.toHaveProperty("members");
      expect(venue).not.toHaveProperty("leaderId");
    }
  });

  it("ties every entry to a gathering rather than to a group", () => {
    for (const e of lifegroupEntries) {
      expect(e.gatheringId).toBeTruthy();
      expect(e).not.toHaveProperty("lifegroupId");
    }
  });
});

/**
 * An entry visibility nobody recognises must close the entry, not open it.
 *
 * The column has no CHECK any more — a church may name its own audiences — so
 * this is the value naming a choice nobody offers: a hand-edited row, a restore
 * from an older schema, a deactivated choice removed by hand. The narrowest
 * answer is the only safe one, and the author still reads their own entry.
 */
describe("an unrecognised entry visibility", () => {
  const entry = (over: Record<string, unknown> = {}) =>
    ({
      id: "lge-1",
      gatheringId: "gth-1",
      authorId: "p-maria",
      body: "Something pastoral",
      createdAt: "2026-09-11T00:00:00.000Z",
      ...over,
    }) as never;

  it("is refused to a leader, where `leaders` would have allowed it", () => {
    const unknown = entry({ visibility: "shared-with-everyone-91827" });

    expect(canReadEntry(unknown, "p-joel", { isLeader: true, isAssignedLeader: true })).toBe(false);
    /* And the ordinary value still behaves as it always did. */
    expect(
      canReadEntry(entry({ visibility: "leaders" }), "p-joel", {
        isLeader: true,
        isAssignedLeader: false,
      }),
    ).toBe(true);
  });

  it("still lets its author read what they wrote", () => {
    const unknown = entry({ visibility: "shared-with-everyone-91827" });
    expect(canReadEntry(unknown, "p-maria", { isLeader: false, isAssignedLeader: false })).toBe(
      true,
    );
  });
});

/**
 * An audience choice an administrator added works end to end, or it is not
 * configuration.
 *
 * The same acceptance standard applied to the most sensitive field in the
 * product. `canReadEntry` used to switch on the four ids, so a fifth choice
 * was unreachable by construction — it would have been offered, stored, and
 * then resolved to nobody.
 */
describe("an entry audience an administrator added", () => {
  afterEach(() => resetOverrides());

  const entry = (over: Record<string, unknown> = {}) =>
    ({
      id: "lge-added",
      gatheringId: "gth-1",
      authorId: "p-maria",
      body: "Something pastoral",
      createdAt: "2026-09-11T00:00:00.000Z",
      ...over,
    }) as never;

  const add = (id: string, entryStrategy: string) =>
    applyOverrides([
      {
        namespace: "lifegroup.entryVisibility",
        optionId: id,
        isAddition: true,
        value: { label: `Added ${id}`, active: true, entryStrategy },
      } as never,
    ]);

  it("is enforced by the strategy it names, and by nothing else", () => {
    add("safeguarding-panel-60318", "named-viewers");
    const guarded = entry({
      visibility: "safeguarding-panel-60318",
      viewerIds: ["p-esther"],
    });

    /* Named on it: may read. Being a leader does not help, because the
       strategy it named is not the one that answers to leaders. */
    expect(canReadEntry(guarded, "p-esther", { isLeader: false, isAssignedLeader: false })).toBe(
      true,
    );
    expect(canReadEntry(guarded, "p-joel", { isLeader: true, isAssignedLeader: true })).toBe(false);
  });

  it("closes an entry when the choice it names is the narrowest one", () => {
    add("sealed-60318", "author-only");
    const sealed = entry({ visibility: "sealed-60318", viewerIds: ["p-esther"] });

    expect(canReadEntry(sealed, "p-maria", { isLeader: false, isAssignedLeader: false })).toBe(
      true,
    );
    expect(canReadEntry(sealed, "p-esther", { isLeader: true, isAssignedLeader: true })).toBe(
      false,
    );
  });

  /* Deactivating withdraws the choice from new entries without rewriting the
     entries already filed under it — they keep meaning what they meant. */
  it("keeps enforcing entries already filed under it after it is deactivated", () => {
    add("safeguarding-panel-60318", "named-viewers");
    const guarded = entry({
      visibility: "safeguarding-panel-60318",
      viewerIds: ["p-esther"],
    });

    applyOverrides([
      {
        namespace: "lifegroup.entryVisibility",
        optionId: "safeguarding-panel-60318",
        isAddition: true,
        value: { label: "Added", active: false, entryStrategy: "named-viewers" },
      } as never,
    ]);

    expect(canReadEntry(guarded, "p-esther", { isLeader: false, isAssignedLeader: false })).toBe(
      true,
    );
    expect(canReadEntry(guarded, "p-joel", { isLeader: true, isAssignedLeader: true })).toBe(false);
  });
});

describe("Home's LifeGroup card", () => {
  const WEEK_START = "2026-09-07";
  const TODAY = "2026-09-09";

  it("lists this leader's gatherings, not another leader's", () => {
    const list = homeGatherings(
      [
        gathering({ id: "mine", assignedLeaderIds: ["p-maria"], date: "2026-09-10" }),
        gathering({ id: "joels", assignedLeaderIds: ["p-joel"], date: "2026-09-09" }),
      ],
      "p-maria",
      WEEK_START,
      TODAY,
    );
    expect(list.map((row) => row.gathering.id)).toEqual(["mine"]);
  });

  it("keeps one led earlier this week, which may still need writing up", () => {
    const list = homeGatherings(
      [gathering({ id: "monday", date: "2026-09-07" })],
      "p-maria",
      WEEK_START,
      TODAY,
    );
    expect(list).toEqual([expect.objectContaining({ needsLeader: false })]);
  });

  it("follows with gatherings nobody has claimed, marked as needing a leader", () => {
    const list = homeGatherings(
      [
        gathering({ id: "open", assignedLeaderIds: [], status: "planned", date: "2026-09-09" }),
        gathering({ id: "mine", date: "2026-09-12" }),
        gathering({ id: "gone", assignedLeaderIds: [], status: "planned", date: "2026-09-08" }),
      ],
      "p-maria",
      WEEK_START,
      TODAY,
    );
    expect(list.map((row) => [row.gathering.id, row.needsLeader])).toEqual([
      ["mine", false],
      ["open", true],
    ]);
  });

  it("leaves out cancelled gatherings and stops at the limit", () => {
    const list = homeGatherings(
      [
        gathering({ id: "a", date: "2026-09-08", status: "cancelled" }),
        gathering({ id: "b", date: "2026-09-09" }),
        gathering({ id: "c", date: "2026-09-10" }),
        gathering({ id: "d", date: "2026-09-11" }),
        gathering({ id: "e", date: "2026-09-12" }),
      ],
      "p-maria",
      WEEK_START,
      TODAY,
    );
    expect(list.map((row) => row.gathering.id)).toEqual(["b", "c", "d"]);
  });
});
