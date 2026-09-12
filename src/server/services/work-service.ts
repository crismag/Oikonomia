import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { resolveAccess } from "@/domain/access";
import {
  recordDecision,
  requestDecision,
  workComment,
  workTransition,
} from "@/domain/work-contract";
import type { WorkRepository, WorkValues } from "../repositories/work-repository";
import type {
  AccessDecision,
  Classification,
  Comment,
  Decision,
  WorkContext,
  WorkKind,
  WorkStatus,
} from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * The work / review context — the reviewer side of reporting.
 *
 * `modules/REPORTS.md` is explicit that this and Leadership Reports are two
 * perspectives and must not be merged. A leader writes and submits in their
 * binder; a reviewer reads, questions, requests changes and acknowledges here.
 *
 * ## Four outcomes, not a boolean
 *
 * `resolveAccess` answers `full`, `limited`, `metadata` or `denied`, and each
 * means something different:
 *
 * | Outcome    | What leaves this service |
 * | ---------- | ------------------------ |
 * | `full`     | the record |
 * | `limited`  | the record with its stricter sections **removed here** |
 * | `metadata` | routing information only — kind, context, classification, owner, last activity |
 * | `denied`   | nothing, as not-found |
 *
 * `metadata` is not a refusal, which is why the list and the detail page treat
 * it differently from `denied`: it is a deliberate product state that says "this
 * exists and is routed to you, and you may not read it".
 *
 * ## Redaction happens here
 *
 * A `limited` viewer used to receive the whole record and have the interface
 * skip the restricted sections while rendering. That is not withholding — the
 * text was in the browser. Sections are removed before the response is built,
 * so what a viewer may not read never reaches them.
 */

export interface WorkMetadata {
  id: string;
  kind: WorkKind;
  contextLabel: string;
  classification: Classification;
  ownerId: string;
  lastActivity?: string;
}

export type WorkView =
  | { level: "full" | "limited"; decision: AccessDecision; work: WorkContext }
  | { level: "metadata"; decision: AccessDecision; metadata: WorkMetadata };

/**
 * A named slice of the binder's work, for a page that is about one kind of it.
 *
 * `development` is leadership development material: somebody's own reflection
 * and the records derived from it. It is a *view*, not a permission — what a
 * viewer may read of anything in it is still the audience policy's answer.
 */
export type WorkScope = "development";

const inScope = (work: WorkContext, scope?: WorkScope): boolean => {
  if (!scope) return true;
  return (
    work.kind === "development-record" ||
    work.contextLabel.startsWith("Leadership Development") ||
    work.policy.classification === "pastoral-private"
  );
};

export function createWorkService(repo: WorkRepository) {
  const decide = (viewer: Viewer, work: WorkContext): AccessDecision =>
    resolveAccess(viewer.persona, viewer.person, work.policy);

  /**
   * Take out what this viewer may not read.
   *
   * Matched on the section title, which is what `restrictedSections` names.
   */
  function redact(work: WorkContext, decision: AccessDecision): WorkContext {
    if (decision.level === "full" || decision.restrictedSections.length === 0) return work;
    const hidden = new Set(decision.restrictedSections);
    return {
      ...work,
      ...(work.sections ? { sections: work.sections.filter((s) => !hidden.has(s.title)) } : {}),
    };
  }

  const metadataOf = (work: WorkContext): WorkMetadata => ({
    id: work.id,
    kind: work.kind,
    contextLabel: work.contextLabel,
    classification: work.policy.classification,
    ownerId: work.ownerId,
    ...(work.activity.at(-1)?.at ? { lastActivity: work.activity.at(-1)!.at } : {}),
  });

  function view(viewer: Viewer, work: WorkContext): WorkView | undefined {
    const decision = decide(viewer, work);
    if (decision.level === "denied") return undefined;
    if (decision.level === "metadata") {
      return { level: "metadata", decision, metadata: metadataOf(work) };
    }
    return { level: decision.level, decision, work: redact(work, decision) };
  }

  /** The record, for a viewer who may actually read it. Anything less is 404. */
  function readable(viewer: Viewer, id: string): { work: WorkContext; decision: AccessDecision } {
    const work = repo.find(id);
    if (!work) throw ApiError.notFound("That record");
    const decision = decide(viewer, work);
    if (decision.level === "denied" || decision.level === "metadata") {
      throw ApiError.notFound("That record");
    }
    return { work, decision };
  }

  const isReviewer = (viewer: Viewer, work: WorkContext) =>
    work.reviewerIds.includes(viewer.person.id);
  const isOwner = (viewer: Viewer, work: WorkContext) => work.ownerId === viewer.person.id;

  const values = (work: WorkContext): WorkValues => {
    const {
      id: _id,
      decisions: _decisions,
      comments: _comments,
      activity: _activity,
      ...rest
    } = work;
    return rest as WorkValues;
  };

  function write(
    id: string,
    work: WorkContext,
    changes: Partial<WorkValues>,
    expectedVersion?: number,
  ): WorkContext {
    const saved = repo.save(
      id,
      { ...values(work), ...changes } as WorkValues,
      expectedVersion ?? repo.versionOf(id) ?? 1,
    );
    if (saved === "stale") {
      throw ApiError.conflict(
        "This moved on while you were looking at it. Reopen it to see where it stands now.",
      );
    }
    if (!saved) throw ApiError.notFound("That record");
    return saved;
  }

  return {
    /**
     * The review library.
     *
     * Only what the viewer may actually read. A `metadata` decision is counted
     * with the withheld rather than listed: this page is for reading records,
     * and a row that cannot be opened is not one.
     */
    list(
      viewer: Viewer,
      filter?: WorkKind | { kind?: WorkKind; scope?: WorkScope },
    ): { work: WorkContext[]; withheld: number } {
      const options = typeof filter === "string" ? { kind: filter } : (filter ?? {});
      /*
       * The scope is applied here rather than by the caller, because the
       * withheld count has to be of the same set the list is of. A page that
       * filtered the rows itself would report "3 development records are held
       * by other leaders" while counting every withheld record in the binder.
       */
      const all = repo.allUnguarded(options.kind).filter((work) => inScope(work, options.scope));
      const readableViews = all
        .map((work) => view(viewer, work))
        .filter(
          (v): v is Extract<WorkView, { level: "full" | "limited" }> =>
            v?.level === "full" || v?.level === "limited",
        );
      return {
        work: readableViews.map((v) => v.work),
        withheld: all.length - readableViews.length,
      };
    },

    /**
     * One record, as much of it as policy permits.
     *
     * Three outcomes reach the caller because three of them are real surfaces.
     * Only `denied` is nothing at all, and it is not-found rather than
     * forbidden.
     */
    get(viewer: Viewer, id: string): WorkView {
      const work = repo.find(id);
      if (!work) throw ApiError.notFound("That record");
      const seen = view(viewer, work);
      if (!seen) throw ApiError.notFound("That record");
      return seen;
    },

    /**
     * Move it along.
     *
     * Who may do what is the point of this module: the owner submits, the
     * reviewers decide. Nobody else does either, whatever else they can read.
     */
    transition(viewer: Viewer, input: unknown): WorkContext {
      const parsed = parse(workTransition, input);
      const { work } = readable(viewer, parsed.id);

      const reviewer = isReviewer(viewer, work);
      const owner = isOwner(viewer, work);

      const onlyReviewer = (what: string) => {
        if (!reviewer) {
          throw ApiError.forbidden(`Reviewing this is for the leaders it was sent to.`);
        }
        return what;
      };

      /*
       * A review step on a record nobody asked to have reviewed is refused.
       *
       * The interface does not offer these controls in that case; this is the
       * server saying the same thing, so that turning review on stays a
       * decision somebody made about a process rather than something a client
       * can assume.
       */
      const requireReviewProcess = (record: WorkContext) => {
        if (!record.reviewRequired) {
          throw ApiError.conflict(
            "This is information, not a submission for review. Comment on it, or create an action from it.",
          );
        }
      };

      const from = (allowed: WorkStatus[], action: string) => {
        if (!allowed.includes(work.status)) {
          throw ApiError.conflict(`This cannot be ${action} from where it currently stands.`);
        }
      };

      let status: WorkStatus = work.status;
      let currentState = work.currentState;
      let kind = "status";
      let summary = "";

      switch (parsed.action) {
        case "submit": {
          if (!owner) throw ApiError.forbidden("Submitting this is for whoever opened it.");
          from(["draft", "changes-requested"], "submitted");
          status = "submitted";
          /*
           * Submitting is **publishing**, unless this record is one of the few
           * that a process says must be reviewed. A leader's report reaching
           * its audience does not put it in anybody's queue: it is there to be
           * read, and nothing is owed. Saying "waiting to be picked up" on
           * every submission is how a product turns forty reports into forty
           * obligations.
           */
          currentState = work.reviewRequired
            ? "Submitted for review."
            : "Published. Your leaders can read it.";
          kind = "submitted";
          summary = work.reviewRequired ? "submitted this for review" : "published this";
          break;
        }

        case "start-review": {
          requireReviewProcess(work);
          onlyReviewer("reviewed");
          from(["submitted", "changes-requested"], "taken into review");
          status = "in-review";
          currentState = "Being reviewed.";
          kind = "review";
          summary = "started reviewing";
          break;
        }

        case "request-changes": {
          requireReviewProcess(work);
          onlyReviewer("returned");
          from(["submitted", "in-review"], "returned");
          /*
           * "Changes requested" without saying what sends a leader back to
           * reread the whole thread — which is the thing this shell exists to
           * prevent. So the note is required here and nowhere else.
           */
          if (!parsed.note) {
            throw ApiError.validation({ note: "Say what needs changing." });
          }
          status = "changes-requested";
          currentState = parsed.note;
          kind = "review";
          summary = "asked for changes";
          break;
        }

        case "acknowledge": {
          requireReviewProcess(work);
          onlyReviewer("acknowledged");
          from(["submitted", "in-review"], "acknowledged");
          status = "acknowledged";
          currentState = parsed.note ?? "Acknowledged.";
          kind = "review";
          summary = "acknowledged this";
          break;
        }

        case "resolve": {
          /*
           * A concern or follow-up ends by being resolved, and whoever opened
           * it may say so — it was never sent to anyone.
           *
           * Something *under review* is different: letting its owner resolve it
           * would be closing their own submission without the review it was
           * sent for. From those states it is the reviewers'.
           */
          const underReview = ["submitted", "in-review", "acknowledged"].includes(work.status);
          if (underReview) {
            onlyReviewer("resolved");
          } else if (!owner && !reviewer) {
            throw ApiError.forbidden("Closing this is for whoever opened it or reviews it.");
          }
          from(["open", "in-review", "acknowledged", "submitted"], "resolved");
          status = "resolved";
          currentState = parsed.note ?? "Resolved.";
          kind = "resolution";
          summary = "resolved this";
          break;
        }

        case "reopen":
        default: {
          if (!owner && !reviewer) {
            throw ApiError.forbidden("Reopening this is for whoever opened it or reviews it.");
          }
          from(["resolved", "closed", "acknowledged"], "reopened");
          status = "open";
          currentState = parsed.note ?? "Open again.";
          kind = "status";
          summary = "reopened this";
          break;
        }
      }

      repo.addActivity(parsed.id, { actorId: viewer.person.id, kind, summary });
      if (parsed.note) {
        /* The reviewer's words, kept in the conversation as well as in the
           state line, so the thread reads as what actually happened. */
        repo.insertComment({
          workId: parsed.id,
          authorId: viewer.person.id,
          body: parsed.note,
          system: true,
        });
      }

      /* `currentState` is rewritten by every transition rather than left to
         drift — it is the answer to "where does this stand?", and a stale one
         is worse than none. */
      return write(parsed.id, work, { status, currentState }, parsed.expectedVersion);
    },

    /** Ask for a decision that has not been made. */
    requestDecision(viewer: Viewer, input: unknown): Decision {
      const parsed = parse(requestDecision, input);
      const { work } = readable(viewer, parsed.workId);
      if (!isOwner(viewer, work) && !isReviewer(viewer, work)) {
        throw ApiError.forbidden("Asking for a decision here is for its owner or its reviewers.");
      }

      const decision = repo.addDecision(parsed.workId, {
        summary: parsed.summary,
        decidedById: viewer.person.id,
        state: "requested",
      });
      repo.addActivity(parsed.workId, {
        actorId: viewer.person.id,
        kind: "decision",
        summary: "asked for a decision",
      });
      return decision;
    },

    /**
     * Record what was decided.
     *
     * A requested decision becomes a recorded one rather than being answered
     * beside itself, so the card above the thread says the outcome once.
     */
    recordDecision(viewer: Viewer, input: unknown): Decision {
      const parsed = parse(recordDecision, input);
      const { work } = readable(viewer, parsed.workId);
      if (!isReviewer(viewer, work)) {
        throw ApiError.forbidden("Deciding this is for the leaders it was sent to.");
      }

      if (parsed.decisionId) {
        const resolved = repo.resolveDecision(parsed.decisionId, parsed.summary, viewer.person.id);
        if (!resolved) throw ApiError.notFound("That request for a decision");
      } else {
        repo.addDecision(parsed.workId, {
          summary: parsed.summary,
          decidedById: viewer.person.id,
          state: "recorded",
        });
      }

      repo.addActivity(parsed.workId, {
        actorId: viewer.person.id,
        kind: "decision",
        summary: "recorded a decision",
      });
      return repo.find(parsed.workId)!.decisions.at(-1)!;
    },

    /**
     * Say something.
     *
     * Anyone who may actually read the record. A metadata-only viewer cannot —
     * commenting on something you may not read would disclose that you were
     * shown it.
     */
    comment(viewer: Viewer, input: unknown): Comment {
      const parsed = parse(workComment, input);
      readable(viewer, parsed.workId);

      const comment = repo.insertComment({
        workId: parsed.workId,
        authorId: viewer.person.id,
        body: parsed.body,
        ...(parsed.target ? { target: parsed.target } : {}),
      });
      repo.addActivity(parsed.workId, {
        actorId: viewer.person.id,
        kind: "comment",
        summary: "commented",
      });
      return comment;
    },
  };
}

export type WorkService = ReturnType<typeof createWorkService>;
