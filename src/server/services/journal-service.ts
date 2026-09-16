import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { createEntry, renameEntry, summarize, writeEntry } from "@/domain/journal-contract";
import { emptyBlock } from "@/domain/meeting";
import type { WorkContentRepository } from "../repositories/work-content-repository";
import type {
  LeadershipReportRepository,
  ReportValues,
} from "../repositories/leadership-report-repository";
import type { WorkRepository, WorkValues } from "../repositories/work-repository";
import type { WorkContent } from "../repositories/work-content-repository";
import type { LeadershipReport, MeetingBlock, WorkContext } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * The leadership journal.
 *
 * Reflection a leader writes for themselves. The organising idea is the
 * **boundary**, and it is the reason this module exists rather than the journal
 * being a kind of note:
 *
 * 1. An entry is private. Not "private unless someone senior asks" — private.
 *    Its policy is `pastoral-private` with the leader as owner, so the audience
 *    resolver denies everyone else, including a bishop and an administrator.
 * 2. A leader selects **lines**, not entries, for an accountability summary.
 * 3. Those lines are **copied** into a Leadership Report, which has its own
 *    audience and its own review lifecycle.
 * 4. Nothing else in the journal moves. A derived report is not a door.
 *
 * Point 3 is the one worth defending. A report that *referenced* its source
 * entries would be a door: anyone who could read the report would have a path
 * to the journal, and widening the report's audience would silently widen the
 * journal's. Copying is what makes "unrelated entries stay closed" true rather
 * than merely intended.
 */

export interface JournalEntry {
  work: WorkContext;
  content: WorkContent;
}

export function createJournalService(
  work: WorkRepository,
  content: WorkContentRepository,
  reports: LeadershipReportRepository,
) {
  /**
   * An entry, and the only way to get one.
   *
   * Owner or nothing. There is no reviewer, no audience and no seniority
   * exception — a journal with an exception is not a journal.
   */
  function mine(viewer: Viewer, id: string): WorkContext {
    const entry = work.find(id);
    if (!entry || entry.kind !== "development-record" || entry.ownerId !== viewer.person.id) {
      /* Not-found rather than forbidden: that somebody keeps a journal, and
         what is in it, are the same secret. */
      throw ApiError.notFound("That entry");
    }
    return entry;
  }

  const values = (entry: WorkContext): WorkValues => {
    const {
      id: _id,
      decisions: _decisions,
      comments: _comments,
      activity: _activity,
      ...rest
    } = entry;
    return rest as WorkValues;
  };

  return {
    /** This leader's own entries, newest first. Never anybody else's. */
    list(viewer: Viewer): WorkContext[] {
      return work
        .allUnguarded("development-record")
        .filter((entry) => entry.ownerId === viewer.person.id);
    },

    /**
     * Start an entry.
     *
     * Private from the first keystroke. There is no step at which a new entry
     * is visible and then narrowed — a reflection should never be readable
     * because somebody had not got round to closing it.
     */
    create(viewer: Viewer, input: unknown): JournalEntry {
      const parsed = parse(createEntry, input);

      const entry = work.insert({
        kind: "development-record",
        subject: parsed.title ?? "",
        contextLabel: "Leadership Development",
        contextPath: "/leadership",
        status: "open",
        currentState: "Private to you.",
        campusId: viewer.person.campusId,
        ownerId: viewer.person.id,
        assigneeIds: [],
        reviewerIds: [],
        participantIds: [],
        artifactIds: [],
        openQuestions: [],
        policy: { classification: "pastoral-private", ownerId: viewer.person.id },
      } as WorkValues);

      work.addActivity(entry.id, {
        actorId: viewer.person.id,
        kind: "status",
        summary: "started this entry",
      });
      const body = content.create(entry.id, [emptyBlock("paragraph")], viewer.person.id);
      return { work: work.find(entry.id)!, content: body };
    },

    open(viewer: Viewer, id: string): JournalEntry {
      const entry = mine(viewer, id);
      const body = content.find(id);
      if (!body) throw ApiError.notFound("That entry");
      return { work: entry, content: body };
    },

    write(viewer: Viewer, input: unknown): WorkContent {
      const parsed = parse(writeEntry, input);
      mine(viewer, parsed.id);

      const current = content.find(parsed.id);
      if (!current) throw ApiError.notFound("That entry");

      const saved = content.save(
        parsed.id,
        parsed.blocks as MeetingBlock[],
        viewer.person.id,
        parsed.expectedVersion ?? current.version,
      );
      if (saved === "stale") {
        throw ApiError.conflict(text("refusal.journal.staleVersion"));
      }
      if (!saved) throw ApiError.notFound("That entry");
      return saved;
    },

    rename(viewer: Viewer, input: unknown): WorkContext {
      const parsed = parse(renameEntry, input);
      const entry = mine(viewer, parsed.id);

      const saved = work.save(
        parsed.id,
        { ...values(entry), subject: parsed.title } as WorkValues,
        work.versionOf(parsed.id) ?? 1,
      );
      if (saved === "stale") {
        throw ApiError.conflict(text("refusal.journal.movedOn"));
      }
      if (!saved) throw ApiError.notFound("That entry");
      return saved;
    },

    /**
     * Remove an entry.
     *
     * The owner's alone, and irreversible: a journal entry is the only copy of
     * itself. Lines already taken into a summary stay in that summary, because
     * they were copied — the report is not left with a hole where the entry
     * used to be.
     */
    remove(viewer: Viewer, id: string): void {
      mine(viewer, id);
      work.delete(id);
    },

    /**
     * Select what belongs in an accountability summary.
     *
     * Produces a **Leadership Report** carrying copies of the chosen lines. The
     * report starts private, exactly as any other does, so sharing it is still
     * a second deliberate act — choosing what to say and choosing who hears it
     * are two decisions, and collapsing them is how private reflection ends up
     * in front of somebody by accident.
     */
    summarize(viewer: Viewer, input: unknown): LeadershipReport {
      const parsed = parse(summarize, input);
      const entry = mine(viewer, parsed.entryId);

      const body = content.find(parsed.entryId);
      if (!body) throw ApiError.notFound("That entry");

      const chosen = new Set(parsed.blockIds);
      const selected = body.blocks.filter((block) => chosen.has(block.id));
      if (selected.length === 0) {
        throw ApiError.validation({ blockIds: text("refusal.journal.blocksNotInEntry") });
      }

      /*
       * Copies, with fresh ids. Sharing the same block id would make the two
       * records the same thing in two places, which is precisely what must not
       * be true of a journal and a report derived from it.
       */
      const copied: MeetingBlock[] = selected.map((block, index) => ({
        ...block,
        id: `${block.id}-s${index + 1}`,
      }));

      const report = reports.insert({
        title: parsed.title || entry.subject || "",
        reportType: parsed.reportType ?? "leadership-development",
        authorId: viewer.person.id,
        status: "draft",
        /* As private as the entry it came from, until its author says otherwise. */
        visibility: "private",
        audienceIds: [],
        discussionPolicy: "viewers",
        contentSource: "native",
        relatedDocumentIds: [],
        links: [],
        tags: [],
        blocks: copied,
      } as ReportValues);

      reports.addActivity(report.id, {
        actorId: viewer.person.id,
        kind: "submitted",
        summary: "drew this from a leadership journal entry",
      });
      /*
       * Recorded on the entry too, so a leader can see what they have already
       * put into a summary — the journal's own history, not a link out of it.
       */
      work.addActivity(parsed.entryId, {
        actorId: viewer.person.id,
        kind: "artifact",
        summary:
          selected.length === 1
            ? "took one line into a summary"
            : `took ${selected.length} lines into a summary`,
      });

      return reports.find(report.id)!;
    },
  };
}

export type JournalService = ReturnType<typeof createJournalService>;
