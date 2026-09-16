import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  addEntry,
  createGathering,
  joinGathering,
  gatheringRange,
  markAttendance,
  setExhortation,
  setSummary,
  updateEntry,
  updateGathering,
} from "@/domain/lifegroup-contract";
import {
  canAmendGathering,
  canAssignGatheringLeaders,
  canCancelGathering,
  canJoinGathering,
  canEdit,
} from "@/domain/authorize";
import {
  canReadEntry,
  DEFAULT_VISIBILITY,
  leadsGathering,
  namedReaders,
  namesItsReaders,
  statusForLeaders,
} from "@/domain/lifegroup";
import { todayISO } from "@/domain/goals";
import type {
  EntryValues,
  GatheringValues,
  LifegroupRepository,
} from "../repositories/lifegroup-repository";
import type { Gathering, LifegroupEntry } from "@/domain/types";
import type { CalendarPublisher } from "../google/calendar";
import type { Viewer } from "@/domain/viewer";

/**
 * LifeGroup decisions.
 *
 * ## The rule this module exists to protect
 *
 * A LifeGroup entry is the most sensitive record in the product: prayer
 * requests, concerns, things said about named people in a room where they were
 * trusted. `canReadEntry` decides who may read one, and **nothing reaches a
 * caller without passing it** — not a list, not a count, not a print view.
 *
 * Readability is decided in memory rather than in SQL, which is the same
 * choice as Goals and the opposite of Meeting Notes. The reasons are the same
 * ones: entries are read per gathering and are never paged, so no `COUNT(*)`
 * can leak a number; and the rule depends on context the row does not carry —
 * whether the viewer leads *this* gathering — which SQL would have to be told
 * separately and could get wrong.
 *
 * ## What a gathering is
 *
 * An occasion at a venue with assigned leaders. There is no group and no
 * membership. Leading *this* gathering is what grants the right to record it;
 * campus oversight may move it and may not record it (`authorize.ts`).
 */

export function createLifegroupService(
  repo: LifegroupRepository,
  /**
   * Copies gatherings to the church's Google Calendar, when one is set up — and
   * takes a cancelled one off it. Told after the write; it cannot fail it.
   */
  publisher?: Pick<CalendarPublisher, "gatheringSaved">,
) {
  const published = (gathering: Gathering): Gathering => {
    publisher?.gatheringSaved(gathering);
    return gathering;
  };

  function requireGathering(id: string): Gathering {
    const gathering = repo.findGathering(id);
    if (!gathering) throw ApiError.notFound("That gathering");
    return gathering;
  }

  /** Recording what happened belongs to the leader who was there. */
  function requireRecorder(viewer: Viewer, id: string): Gathering {
    const gathering = requireGathering(id);
    if (!canEdit(viewer, { kind: "gathering", gathering })) {
      throw ApiError.forbidden(text("refusal.lifegroup.recordNotAssigned"));
    }
    /* A cancelled gathering did not happen; there is nothing to record until
       it is put back on the schedule. */
    if (gathering.status === "cancelled") {
      throw ApiError.conflict(text("refusal.lifegroup.recordCancelled"));
    }
    return gathering;
  }

  /**
   * Directory people, by id.
   *
   * A mark or a reader naming an id nobody has would be stored as somebody
   * and render as "Unknown person" — and a reader nobody can be is an entry
   * shared with nobody while it says otherwise.
   */
  function requireKnownPeople(ids: string[], field: string, message: string) {
    const known = repo.knownPeople(ids);
    if (ids.some((id) => !known.has(id))) throw ApiError.validation({ [field]: message });
  }

  /**
   * Who an entry is shared with, settled before it is stored.
   *
   * Named readers mean something only for an audience that is named; for any
   * other choice they are dropped, so changing an entry to "Leaders" cannot
   * leave a stale list that a later change back would silently reopen. A named
   * audience with nobody in it is refused rather than stored as author-only
   * under a label that says it is shared.
   */
  function readersFor(
    visibility: string | undefined,
    viewerIds: string[] | undefined,
    authorId: string,
  ): { viewerIds?: string[] } {
    if (!namesItsReaders(visibility ?? DEFAULT_VISIBILITY)) return {};
    const readers = namedReaders(viewerIds, authorId);
    if (readers.length === 0) {
      throw ApiError.validation({ viewerIds: text("refusal.lifegroup.readersMissing") });
    }
    requireKnownPeople(readers, "viewerIds", text("refusal.lifegroup.readerUnknown"));
    return { viewerIds: readers };
  }

  /**
   * The context `canReadEntry` needs, assembled once.
   *
   * Every leader reads ordinary LifeGroup material; leading *this* gathering is
   * the narrower grant that `assigned-leaders` turns on.
   */
  const contextFor = (viewer: Viewer, gathering: Gathering) => ({
    isLeader: true,
    isAssignedLeader: leadsGathering(gathering, viewer.person.id),
  });

  function saveStage(viewer: Viewer, gathering: Gathering, status: Gathering["status"]) {
    const { id, ...rest } = gathering;
    const saved = repo.saveGathering(id, {
      ...rest,
      status,
      updatedBy: viewer.person.id,
    } as GatheringValues);
    if (!saved) throw ApiError.notFound("That gathering");
    return published(saved);
  }

  function readableEntries(viewer: Viewer, gathering: Gathering, entries: LifegroupEntry[]) {
    const context = contextFor(viewer, gathering);
    return entries.filter((entry) => canReadEntry(entry, viewer.person.id, context));
  }

  return {
    /**
     * Gatherings around a date, with everything they hold.
     *
     * Attendance and the write-up are open to leaders; **entries are not**, and
     * are filtered per gathering because the rule depends on which gathering
     * each one belongs to.
     */
    listRange(viewer: Viewer, input: unknown) {
      const range = parse(gatheringRange, input);
      const gatherings = repo.gatheringsInRange(range.from, range.to);
      return this.assemble(viewer, gatherings);
    },

    /** The whole book. The LifeGroup landing page reads its own history. */
    listAll(viewer: Viewer) {
      return this.assemble(viewer, repo.allGatherings());
    },

    assemble(viewer: Viewer, gatherings: Gathering[]) {
      const ids = gatherings.map((g) => g.id);
      const everyEntry = repo.entriesFor(ids);
      const byGathering = new Map(gatherings.map((g) => [g.id, g]));

      const entries = everyEntry.filter((entry) => {
        const gathering = byGathering.get(entry.gatheringId);
        return !!gathering && canReadEntry(entry, viewer.person.id, contextFor(viewer, gathering));
      });

      return {
        gatherings,
        attendance: repo.attendanceFor(ids),
        entries,
        /* Existence acknowledged, identity never. */
        withheldEntries: everyEntry.length - entries.length,
        exhortations: repo.exhortations(),
        reports: repo.reports(),
      };
    },

    getGathering(viewer: Viewer, id: string) {
      const gathering = requireGathering(id);
      return {
        gathering,
        attendance: repo.attendanceFor([id]),
        entries: readableEntries(viewer, gathering, repo.entriesFor([id])),
        exhortation: repo.findExhortation(id),
        report: repo.findReport(id),
      };
    },

    /* ------------------------------------------------------- scheduling */

    /**
     * Add a row to the schedule.
     *
     * A date is enough. The row's stage follows from whether anyone is on it —
     * a row with nobody's name against it needs a leader, and says so — so
     * nothing here has to be told what stage to be.
     */
    createGathering(viewer: Viewer, input: unknown): Gathering {
      const values = parse(createGathering, input);
      const assignedLeaderIds = values.assignedLeaderIds ?? [];
      return published(
        repo.insertGathering({
          ...values,
          assignedLeaderIds,
          status: statusForLeaders("planned", assignedLeaderIds),
          createdBy: viewer.person.id,
        } as GatheringValues),
      );
    },

    /**
     * Put your own name against a gathering, or take it off again.
     *
     * Any leader, and deliberately not `updateGathering`: assigning somebody
     * else needs campus oversight, volunteering does not, and sharing a code
     * path is how that difference quietly disappears.
     *
     * **Assignment does not transfer ownership.** The row stays part of the
     * shared schedule throughout, which is exactly what lets somebody else pick
     * it up when a leader steps away.
     */
    joinGathering(viewer: Viewer, input: unknown): Gathering {
      const { gatheringId, action } = parse(joinGathering, input);
      const gathering = requireGathering(gatheringId);
      const me = viewer.person.id;

      if (!canJoinGathering(viewer, gathering)) {
        throw ApiError.conflict(
          gathering.status === "completed"
            ? text("refusal.lifegroup.leadersWrittenUp")
            : text("refusal.lifegroup.cancelled"),
        );
      }

      const already = gathering.assignedLeaderIds.includes(me);
      if (action === "leave" && !already) {
        throw ApiError.conflict(text("refusal.lifegroup.notOnGathering"));
      }
      if (action !== "leave" && already) {
        throw ApiError.conflict(text("refusal.lifegroup.alreadyOnGathering"));
      }
      if (action === "claim" && gathering.assignedLeaderIds.length > 0) {
        /* Claiming takes a gathering nobody is leading; joining stands beside
           leaders who already are. Doing the wrong one is worth saying. */
        throw ApiError.conflict(text("refusal.lifegroup.alreadyLed"));
      }

      const assignedLeaderIds =
        action === "leave"
          ? gathering.assignedLeaderIds.filter((id) => id !== me)
          : [...gathering.assignedLeaderIds, me];

      /* Whoever was carrying it stops being named when they step away. */
      const primaryLeaderId =
        gathering.primaryLeaderId && assignedLeaderIds.includes(gathering.primaryLeaderId)
          ? gathering.primaryLeaderId
          : undefined;

      const { id: _id, ...rest } = gathering;
      const saved = repo.saveGathering(gatheringId, {
        ...rest,
        assignedLeaderIds,
        primaryLeaderId,
        status: statusForLeaders(gathering.status, assignedLeaderIds),
        updatedBy: me,
      } as GatheringValues);
      if (!saved) throw ApiError.notFound("That gathering");
      return published(saved);
    },

    /**
     * Change when, where or who leads.
     *
     * A different right from recording what happened: campus oversight may move
     * a gathering without being able to mark its attendance.
     */
    updateGathering(viewer: Viewer, id: string, input: unknown): Gathering {
      const gathering = requireGathering(id);
      if (!canAmendGathering(viewer, gathering)) {
        throw ApiError.forbidden(text("refusal.lifegroup.notYoursToChange"));
      }

      const patch = parse(updateGathering, input);

      /*
       * Cancelling, completing and reopening each have their own operation and
       * their own rule. A stage patch may only move a live row between the
       * stages a schedule has — otherwise "Edit details" would be a way to
       * complete a gathering without a report, or cancel one without the
       * right to.
       */
      if (patch.status && patch.status !== gathering.status) {
        const live = gathering.status !== "completed" && gathering.status !== "cancelled";
        const scheduling = ["planned", "assigned", "confirmed"].includes(patch.status);
        if (!live || !scheduling) {
          throw ApiError.conflict(text("refusal.lifegroup.stageHasOwnAction"));
        }
      }

      /*
       * Naming somebody else is a different right from maintaining the row.
       * An assigned leader may move the time and settle the venue; deciding who
       * else leads is campus oversight's.
       */
      if (patch.assignedLeaderIds && !canAssignGatheringLeaders(viewer)) {
        const before = [...gathering.assignedLeaderIds].sort().join();
        const after = [...patch.assignedLeaderIds].sort().join();
        if (before !== after) {
          throw ApiError.forbidden(text("refusal.lifegroup.coLeadersCampus"));
        }
      }

      const { id: _id, ...rest } = gathering;
      const merged = { ...rest, ...patch } as GatheringValues;
      const saved = repo.saveGathering(id, {
        ...merged,
        /* The stage follows from who is on it, unless it has moved past that. */
        status: patch.status ?? statusForLeaders(gathering.status, merged.assignedLeaderIds ?? []),
        updatedBy: viewer.person.id,
      } as GatheringValues);
      if (!saved) throw ApiError.notFound("That gathering");
      return published(saved);
    },

    /**
     * Take a gathering off the schedule.
     *
     * Kept, not deleted: a cancelled evening is part of the roster's history,
     * and a duplicate row cancelled by mistake can be put back. Nothing it
     * recorded is touched.
     */
    cancelGathering(viewer: Viewer, id: string): Gathering {
      const gathering = requireGathering(id);
      if (gathering.status === "cancelled") {
        throw ApiError.conflict(text("refusal.lifegroup.alreadyCancelled"));
      }
      if (gathering.status === "completed") {
        throw ApiError.conflict(text("refusal.lifegroup.cancelWrittenUp"));
      }
      if (!canCancelGathering(viewer, gathering)) {
        throw ApiError.forbidden(text("refusal.lifegroup.notYoursToCancel"));
      }
      return saveStage(viewer, gathering, "cancelled");
    },

    /** Put a cancelled gathering back, at the stage its leaders say it is at. */
    restoreGathering(viewer: Viewer, id: string): Gathering {
      const gathering = requireGathering(id);
      if (gathering.status !== "cancelled") {
        throw ApiError.conflict(text("refusal.lifegroup.notCancelled"));
      }
      if (!canCancelGathering(viewer, gathering)) {
        throw ApiError.forbidden(text("refusal.lifegroup.notYoursToRestore"));
      }
      return saveStage(viewer, gathering, statusForLeaders("planned", gathering.assignedLeaderIds));
    },

    /* ------------------------------------------------------- attendance */

    markAttendance(viewer: Viewer, input: unknown) {
      const values = parse(markAttendance, input);
      if (!values.personId && !values.name) {
        throw ApiError.validation({ name: text("refusal.lifegroup.attendeeNameMissing") });
      }
      requireRecorder(viewer, values.gatheringId);
      if (values.personId) {
        requireKnownPeople([values.personId], "personId", text("refusal.lifegroup.personUnknown"));
      }
      return repo.markAttendance(values);
    },

    removeAttendance(viewer: Viewer, id: string): void {
      const mark = repo.findAttendance(id);
      if (!mark) throw ApiError.notFound("That attendance mark");
      requireRecorder(viewer, mark.gatheringId);
      repo.deleteAttendance(id);
    },

    /* ------------------------------------------------- exhortation & notes */

    setExhortation(viewer: Viewer, input: unknown) {
      const values = parse(setExhortation, input);
      requireRecorder(viewer, values.gatheringId);

      /* An exhortation with no topic is no exhortation — clearing it clears. */
      repo.setExhortation(values.gatheringId, values.topic.trim() ? values : null);
      return repo.findExhortation(values.gatheringId) ?? null;
    },

    setSummary(viewer: Viewer, input: unknown) {
      const values = parse(setSummary, input);
      requireRecorder(viewer, values.gatheringId);

      const existing = repo.findReport(values.gatheringId);
      repo.setReport(values.gatheringId, {
        ...existing,
        ...(values.summary.trim() ? { summary: values.summary.trim() } : {}),
      });
      return repo.findReport(values.gatheringId) ?? null;
    },

    /**
     * Finishing the write-up.
     *
     * Recorded on the gathering rather than raised as a workflow: completing a
     * report notifies nobody and asks nobody for approval. It can be reopened,
     * because finishing something must never feel irreversible.
     */
    complete(viewer: Viewer, id: string) {
      requireRecorder(viewer, id);
      const existing = repo.findReport(id);
      repo.setReport(id, {
        ...existing,
        completedAt: todayISO(),
        completedById: viewer.person.id,
      });
      repo.setStatus(id, "completed");
      return repo.findGathering(id)!;
    },

    reopen(viewer: Viewer, id: string) {
      requireRecorder(viewer, id);
      const existing = repo.findReport(id);
      repo.setReport(id, { ...(existing?.summary ? { summary: existing.summary } : {}) });
      repo.setStatus(id, "open");
      return repo.findGathering(id)!;
    },

    /* ----------------------------------------------------------- entries */

    addEntry(viewer: Viewer, input: unknown): LifegroupEntry {
      const values = parse(addEntry, input);
      requireRecorder(viewer, values.gatheringId);

      const { viewerIds, ...rest } = values;
      return repo.insertEntry({
        ...rest,
        ...readersFor(values.visibility, viewerIds, viewer.person.id),
        authorId: viewer.person.id,
      } as EntryValues);
    },

    /**
     * Change an entry.
     *
     * Only its author, and only if they may read it — an entry somebody cannot
     * see is not one they can edit by knowing its id.
     */
    updateEntry(viewer: Viewer, id: string, input: unknown): LifegroupEntry {
      const entry = repo.findEntry(id);
      if (!entry) throw ApiError.notFound("That entry");

      const gathering = requireGathering(entry.gatheringId);
      if (!canReadEntry(entry, viewer.person.id, contextFor(viewer, gathering))) {
        /* Its existence is part of what is private. */
        throw ApiError.notFound("That entry");
      }
      if (entry.authorId !== viewer.person.id) {
        throw ApiError.forbidden(text("refusal.entry.owner"));
      }

      const patch = parse(updateEntry, input);
      const { id: _id, createdAt: _created, viewerIds: storedReaders, ...rest } = entry;
      const { viewerIds: patchReaders, ...changes } = patch;
      const merged = { ...rest, ...changes };
      const saved = repo.saveEntry(id, {
        ...merged,
        ...readersFor(merged.visibility, patchReaders ?? storedReaders, entry.authorId),
      } as EntryValues);
      if (!saved) throw ApiError.notFound("That entry");
      return saved;
    },

    removeEntry(viewer: Viewer, id: string): void {
      const entry = repo.findEntry(id);
      if (!entry) throw ApiError.notFound("That entry");

      const gathering = requireGathering(entry.gatheringId);
      if (!canReadEntry(entry, viewer.person.id, contextFor(viewer, gathering))) {
        throw ApiError.notFound("That entry");
      }
      if (entry.authorId !== viewer.person.id) {
        throw ApiError.forbidden(text("refusal.entry.owner"));
      }
      repo.deleteEntry(id);
    },
  };
}

export type LifegroupService = ReturnType<typeof createLifegroupService>;
