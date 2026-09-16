import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  addComment,
  createReport,
  setBlocks,
  transition,
  updateReport,
} from "@/domain/report-contract";
import {
  canDiscover,
  initialStatus,
  planTransition,
  reportCapabilities,
  statusBehavior,
  subjectMattersFor,
  withheldCount,
} from "@/domain/leadership-report";
import { newBlockId } from "@/domain/meeting";
import { config } from "@/config";
import type {
  LeadershipReportRepository,
  ReportValues,
} from "../repositories/leadership-report-repository";
import type { TransitionPlan } from "@/domain/leadership-report";
import type { Comment, LeadershipReport, MeetingBlock, ReportCapabilities } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Leadership Reports.
 *
 * ## Discovery is decided in the domain, and applied before anything leaves
 *
 * `canDiscover` resolves an audience policy from the report's visibility, its
 * named audience, the viewer's persona and their groups — and treats "you may
 * know this exists" as **no discovery**, because knowing a confidential report
 * about you exists is itself disclosure. That rule is the subtlest in the
 * application, so it has exactly one statement of it, in `domain/`, and this
 * module applies it rather than restating it in SQL.
 *
 * Everything a caller can reach goes through `readable` or `require` below.
 * There is no code path that returns a report without one of them.
 *
 * ## What the in-memory prototype did not do
 *
 * The provider this replaces gated *discovery* and nothing else: any viewer who
 * could see a report could also have published it, archived it, rewritten it or
 * changed its audience, because the interface simply did not offer those
 * controls. Hiding a control is a user-interface courtesy, not a rule. Every
 * capability in `reportCapabilities` is now checked here, where a caller cannot
 * decline to ask.
 *
 * ## Withholding is a 404
 *
 * Consistent with the rest of the backend, and load-bearing here: "you may not
 * see this" would confirm that a report about somebody exists.
 */

export function createLeadershipReportService(
  repo: LeadershipReportRepository,
  /**
   * Where the leadership audience comes from.
   *
   * The groups a church has marked as leadership bodies — records, not two
   * constants. Optional so that callers which never touch that audience need
   * not wire it; absent means **no** leadership audience, so such a report
   * reaches only its author. Empty and safe beats guessed and wide.
   */
  organization?: { leadershipGroupIds: () => string[] },
  /**
   * Where opening a confidential report is recorded, and read back.
   *
   * Optional so internal callers that never hand a report to a person need not
   * wire it. Without it a confidential report still opens; it is simply not
   * recorded — which is why the browser-facing API always passes one.
   */
  confidentialReads?: {
    record: (actorId: string, reportId: string) => void;
    of: (reportId: string) => { actorId: string; at: string }[];
  },
) {
  const leadershipGroups = () => organization?.leadershipGroupIds() ?? [];

  /** Every report this viewer may know about. The only list anything gets. */
  function readable(viewer: Viewer): LeadershipReport[] {
    return repo
      .allUnguarded()
      .filter((report) => canDiscover(report, viewer.persona, viewer.person, leadershipGroups()));
  }

  function require(viewer: Viewer, id: string): LeadershipReport {
    const report = repo.find(id);
    if (!report || !canDiscover(report, viewer.persona, viewer.person, leadershipGroups())) {
      throw ApiError.notFound("That report");
    }
    return report;
  }

  const can = (viewer: Viewer, report: LeadershipReport): ReportCapabilities =>
    reportCapabilities(report, viewer.persona, viewer.person, leadershipGroups());

  /**
   * Demand one capability, by name.
   *
   * The message says what is true rather than what is missing: a subject
   * reading an evaluation about themselves is not a failed author, and telling
   * them "you lack edit permission" describes the system instead of the
   * situation.
   */
  function demand(
    viewer: Viewer,
    report: LeadershipReport,
    capability: keyof ReportCapabilities,
    because: string,
  ): void {
    if (!can(viewer, report)[capability]) throw ApiError.forbidden(because);
  }

  /** Everything a save writes, minus what only the repository maintains. */
  const values = (report: LeadershipReport): ReportValues => {
    const {
      id: _id,
      comments: _comments,
      activity: _activity,
      revisions: _revisions,
      createdAt: _created,
      updatedAt: _updated,
      ...rest
    } = report;
    return rest as ReportValues;
  };

  function write(
    id: string,
    report: LeadershipReport,
    changes: Partial<ReportValues>,
    expectedVersion?: number,
  ): LeadershipReport {
    const saved = repo.save(
      id,
      { ...values(report), ...changes } as ReportValues,
      expectedVersion ?? repo.versionOf(id) ?? 1,
    );
    if (saved === "stale") {
      throw ApiError.conflict(
        "This report was changed somewhere else while you were working. Reopen it to see the current version.",
      );
    }
    if (!saved) throw ApiError.notFound("That report");
    return saved;
  }

  return {
    /**
     * The reports a leader may read, and how many were withheld.
     *
     * The count is deliberate. That confidential reporting exists may be said
     * in aggregate; which report, about whom, and what it is called may not.
     */
    list(viewer: Viewer): { reports: LeadershipReport[]; withheld: number } {
      const all = repo.allUnguarded();
      return {
        reports: all.filter((report) =>
          canDiscover(report, viewer.persona, viewer.person, leadershipGroups()),
        ),
        withheld: withheldCount(all, viewer.persona, viewer.person),
      };
    },

    /**
     * One report. Not found when it may not be discovered.
     *
     * Opening a confidential report as anyone but its author is recorded —
     * who and which report, never what it says.
     */
    get(viewer: Viewer, id: string): LeadershipReport {
      const report = require(viewer, id);
      if (report.confidential && report.authorId !== viewer.person.id) {
        confidentialReads?.record(viewer.person.id, report.id);
      }
      return report;
    },

    /**
     * A report as it may travel to this viewer in a list or an action's reply.
     *
     * A confidential report goes to anyone but its author without its content
     * — no text, no revisions, no discussion — so the only way to read it is to
     * open it, and opening it is what gets recorded.
     */
    forBrowser(viewer: Viewer, report: LeadershipReport): LeadershipReport {
      if (!report.confidential || report.authorId === viewer.person.id) return report;
      const { blocks: _blocks, relatedText: _related, ...rest } = report;
      return { ...rest, comments: [], revisions: [], activity: [], contentWithheld: true };
    },

    /** Who has opened a confidential report. Its author's to see, and nobody else's. */
    confidentialReads(viewer: Viewer, id: string): { actorId: string; at: string }[] {
      const report = require(viewer, id);
      if (report.authorId !== viewer.person.id) throw ApiError.notFound("That report");
      return confidentialReads?.of(id) ?? [];
    },

    /**
     * Start a report.
     *
     * **It starts private.** Widening who may read it is a separate, deliberate
     * act — a report should never become visible because somebody forgot to
     * narrow it.
     */
    create(viewer: Viewer, input: unknown): LeadershipReport {
      const parsed = parse(createReport, input);
      const contentSource = parsed.contentSource ?? "native";

      /*
       * A structured subject is refused unless the kind of report is one the
       * church writes *about a person* — an evaluation, a development record.
       *
       * It is not a neutral label. Naming somebody in `subject_id` makes the
       * report findable by their name and gives them a way in: a subject may
       * read a report written about them. On a pastoral concern that is
       * exactly backwards, and a control that merely hid the field would leave
       * the field settable by anything that could call this.
       *
       * Whoever a report concerns is written in the report, in the leader's
       * own words. A sentence is not an index entry.
       */
      if (parsed.subjectId && !subjectMattersFor(parsed.reportType)) {
        throw ApiError.validation({
          subjectId:
            "This kind of report is not written about a named person. Say who it concerns in the report itself.",
        });
      }

      const report = repo.insert({
        title: parsed.title ?? "",
        reportType: parsed.reportType,
        authorId: viewer.person.id,
        status: initialStatus() as ReportValues["status"],
        /*
         * Private until its author says otherwise — including one written
         * from inside a shared workspace. Membership of the place a report was
         * written in has never been permission to read it.
         */
        visibility: parsed.visibility ?? "private",
        audienceIds: parsed.audienceIds ?? [],
        category: parsed.category ?? "general",
        ...(parsed.contextType ? { contextType: parsed.contextType } : {}),
        ...(parsed.contextId ? { contextId: parsed.contextId } : {}),
        ...(parsed.subjectId ? { subjectId: parsed.subjectId } : {}),
        ...(parsed.subjectText ? { subjectText: parsed.subjectText } : {}),
        ...(parsed.confidential ? { confidential: true } : {}),
        discussionPolicy: "viewers",
        contentSource,
        relatedDocumentIds: [],
        links: [],
        tags: [],
        ...(contentSource === "native"
          ? { blocks: [{ id: newBlockId(), type: "paragraph", html: "" }] }
          : {}),
        ...(parsed.primaryDocumentId ? { primaryDocumentId: parsed.primaryDocumentId } : {}),
      } as ReportValues);

      repo.addActivity(report.id, {
        actorId: viewer.person.id,
        kind: "submitted",
        summary: "created this report",
      });
      return repo.find(report.id)!;
    },

    /**
     * Change a report's metadata.
     *
     * Two different capabilities meet here. Who may *read* a report is
     * `manageAccess` and belongs to its author for as long as it is not
     * archived; everything else is `edit`, which stops when the report is
     * finalized. A caller that sends both in one patch needs both.
     */
    update(viewer: Viewer, id: string, input: unknown, expectedVersion?: number): LeadershipReport {
      const report = require(viewer, id);
      const patch = parse(updateReport, input);

      /* The same rule on the way in as at creation: a subject may be named
         only on a kind of report the church writes about a person. Otherwise
         an edit would be a second door to the thing creation refuses. */
      if (patch.subjectId && !subjectMattersFor(patch.reportType ?? report.reportType)) {
        throw ApiError.validation({
          subjectId:
            "This kind of report is not written about a named person. Say who it concerns in the report itself.",
        });
      }

      /* Confidentiality travels with the audience: both are the author's to set. */
      const audienceKeys = [
        "visibility",
        "audienceIds",
        "commenterIds",
        "discussionPolicy",
        "confidential",
      ];
      const touchesAudience = audienceKeys.some((key) => key in (patch as object));
      const touchesContent = Object.keys(patch as object).some((k) => !audienceKeys.includes(k));

      if (touchesAudience) {
        demand(viewer, report, "manageAccess", "Who may read this report is the author's to set.");
      }
      if (touchesContent) {
        demand(
          viewer,
          report,
          "edit",
          report.authorId === viewer.person.id
            ? "This report has been submitted. Reopen it to make changes."
            : "This report is its author's to change.",
        );
      }

      return write(id, report, patch as Partial<ReportValues>, expectedVersion);
    },

    /**
     * Write the report.
     *
     * Refused once published or archived. A finalized report is the record
     * leadership actually read, and a correction is made by reopening it — not
     * by quietly replacing what was there.
     */
    write(viewer: Viewer, input: unknown): LeadershipReport {
      const parsed = parse(setBlocks, input);
      const report = require(viewer, parsed.id);

      if (!statusBehavior(report.status).editable) {
        throw ApiError.conflict(
          "This report has been submitted. Reopen it before changing what it says.",
        );
      }
      demand(viewer, report, "edit", "This report is its author's to write.");

      return write(
        parsed.id,
        report,
        { blocks: parsed.blocks as MeetingBlock[] },
        parsed.expectedVersion,
      );
    },

    /**
     * Move a report to another stage.
     *
     * One call rather than four named ones. What the move does — whether the
     * content is snapshotted, whether the stamps are set or cleared — and what
     * the actor must be able to do are both read off the two statuses'
     * behaviours, so a church that adds a stage gets correct handling of it
     * without a code change.
     */
    transition(viewer: Viewer, input: unknown): LeadershipReport {
      /** Why the move was refused, in terms of what the move is. */
      const refusalFor = (capability: TransitionPlan["capability"]) =>
        capability === "manageAccess"
          ? "Only the author reopens a report."
          : capability === "archive"
            ? "Only the author retires a report."
            : capability === "publish"
              ? "Only the author submits a report."
              : "This report is its author's to change.";

      const parsed = parse(transition, input);
      const report = require(viewer, parsed.id);
      const at = new Date().toISOString().slice(0, 19);

      if (report.status === parsed.to) return report;

      const plan = planTransition(report.status, parsed.to);
      demand(viewer, report, plan.capability, refusalFor(plan.capability));

      /*
       * The content at the moment it stops changing becomes a revision, so a
       * later correction can never quietly replace the record leadership read.
       * Reopening keeps every revision: it is not an erasure.
       */
      if (plan.snapshot) {
        repo.addRevision(parsed.id, {
          revision: report.revisions.length + 1,
          blocks: report.blocks ?? [],
          actorId: viewer.person.id,
          note: config.label("reports.statuses", parsed.to),
        });
      }

      repo.addActivity(parsed.id, {
        actorId: viewer.person.id,
        kind: "status",
        summary: `moved the report to ${config.label("reports.statuses", parsed.to)}`,
      });

      return write(
        parsed.id,
        report,
        {
          status: parsed.to as ReportValues["status"],
          ...(plan.marksFinal ? { publishedAt: at } : {}),
          ...(plan.reopens ? { publishedAt: undefined } : {}),
          ...(plan.retires ? { archivedAt: at } : {}),
          ...(plan.restores || plan.reopens ? { archivedAt: undefined } : {}),
        },
        parsed.expectedVersion,
      );
    },

    /**
     * Say something about a report.
     *
     * Gated on `comment`, which is not the same as being able to read it: an
     * evaluation may be readable by its subject and closed to discussion, or
     * open only to leaders the author named.
     */
    comment(viewer: Viewer, input: unknown): Comment {
      const parsed = parse(addComment, input);
      const report = require(viewer, parsed.reportId);
      demand(viewer, report, "comment", "This report is not open for discussion.");

      const comment = repo.insertComment({
        reportId: parsed.reportId,
        authorId: viewer.person.id,
        body: parsed.body,
        ...(parsed.target ? { target: parsed.target } : {}),
      });
      repo.addActivity(parsed.reportId, {
        actorId: viewer.person.id,
        kind: "comment",
        summary: "commented",
      });
      return comment;
    },

    /**
     * Remove a report.
     *
     * Only its author, and never once it has been published: a submitted report
     * is a record, and archiving is how it stops being current.
     */
    remove(viewer: Viewer, id: string): void {
      const report = require(viewer, id);
      if (report.authorId !== viewer.person.id) {
        throw ApiError.forbidden("A report belongs to whoever wrote it.");
      }
      /* A record leadership has read is not deletable, whatever the stage
         that froze it is called. */
      if (!statusBehavior(report.status).editable) {
        throw ApiError.forbidden(
          "This report has been submitted. Archive it rather than removing the record.",
        );
      }
      repo.delete(id);
    },

    /** What this viewer may do with one report they can already discover. */
    capabilities(viewer: Viewer, report: LeadershipReport): ReportCapabilities {
      return can(viewer, report);
    },
  };
}

export type LeadershipReportService = ReturnType<typeof createLeadershipReportService>;
