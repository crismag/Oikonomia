import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import { windowFor } from "../api/pagination";
import { PAGE_SIZE } from "@/domain/pagination";
import { addComment, createReport, reportQuery, updateReport } from "@/domain/reach-out-contract";
import { canDeleteReport, contributorsOf } from "@/domain/reach-out";
import { todayISO } from "@/domain/goals";
import type { ReachOutRepository, ReportValues } from "../repositories/reach-out-repository";
import type { PageMeta } from "@/lib/api-envelope";
import type { Comment, ReachOutReport } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * Reach-Out decisions.
 *
 * ## This module has no access model, and that is stated rather than implied
 *
 * Every leader may read and continue every Reach-Out report. Not because that
 * is a considered rule, but because **sharing rules for Reach-Out are an open
 * product decision** — `modules/REACH-OUT.md` records them as unresolved, and
 * §11 says to keep the model simple rather than guess.
 *
 * So there is no filtering here, and `policy` on the record is stored and read
 * by nothing. That is the honest position: a permission check invented to look
 * thorough would be a rule nobody agreed to, enforced on records that carry
 * people's names. When the decision is made, `canContribute` in
 * `domain/reach-out.ts` and this service are where it attaches.
 *
 * ## Authorship is not ownership
 *
 * `authorId` says who wrote it first. Any leader may continue any report, and
 * doing so adds them to the contributors — provenance, so the page can say who
 * has worked on it, never a gate on who may.
 */

export function createReachOutService(repo: ReachOutRepository) {
  function require(id: string): ReachOutReport {
    const report = repo.find(id);
    if (!report) throw ApiError.notFound("That report");
    return report;
  }

  const values = (report: ReachOutReport): ReportValues => {
    const {
      id: _id,
      comments: _comments,
      createdAt: _c,
      updatedAt: _u,
      version: _v,
      ...rest
    } = report;
    return rest;
  };

  return {
    /**
     * A page of reports.
     *
     * Unfiltered by viewer, for the reason above. `_viewer` is taken so that
     * adding the filter later is a change inside this method rather than a
     * change to every caller.
     */
    list(_viewer: Viewer, input: unknown): { reports: ReachOutReport[]; page: PageMeta } {
      const query = parse(reportQuery, input);
      const filters = { search: query.search, personId: query.personId };
      const total = repo.count(filters);
      const { limit, offset, meta } = windowFor(
        { page: query.page ?? 1, pageSize: query.pageSize ?? PAGE_SIZE },
        total,
      );
      return { reports: repo.list(filters, limit, offset), page: meta };
    },

    get(_viewer: Viewer, id: string): ReachOutReport {
      return require(id);
    },

    createReport(viewer: Viewer, input: unknown): ReachOutReport {
      const parsed = parse(createReport, input);
      return repo.insert({
        title: parsed.title ?? "",
        reportDate: parsed.reportDate ?? todayISO(),
        content: parsed.content ?? "",
        authorId: viewer.person.id,
      } as ReportValues);
    },

    /**
     * Continue a report.
     *
     * Any leader may. Whoever is not the first author joins the contributors,
     * oldest contribution first, so the page can say whose account this is
     * without implying that any of them owns it.
     */
    updateReport(
      viewer: Viewer,
      id: string,
      input: unknown,
      expectedVersion?: number,
    ): ReachOutReport {
      const report = require(id);
      const patch = parse(updateReport, input);

      const contributorIds =
        viewer.person.id === report.authorId
          ? report.contributorIds
          : [...new Set([...(report.contributorIds ?? []), viewer.person.id])];

      const saved = repo.save(
        id,
        {
          ...values(report),
          ...patch,
          ...(contributorIds ? { contributorIds } : {}),
        } as ReportValues,
        expectedVersion ?? report.version ?? 1,
      );

      if (saved === "stale") {
        /*
         * Two leaders continuing one report is ordinary here, so the message
         * says what happened rather than treating it as an error they caused.
         */
        throw ApiError.conflict(text("refusal.reachOut.staleVersion"));
      }
      if (!saved) throw ApiError.notFound("That report");
      return saved;
    },

    /**
     * Remove a report.
     *
     * Only the first author. Shared work means anyone may *add* to a report; it
     * does not mean anyone may delete somebody else's account of what happened.
     */
    deleteReport(viewer: Viewer, id: string): void {
      const report = require(id);
      if (!canDeleteReport(report, viewer.person.id)) {
        throw ApiError.forbidden(text("refusal.reachOut.removeIsAuthors"));
      }
      repo.delete(id);
    },

    /** Discussion around the report, never a second reporting form. */
    addComment(viewer: Viewer, input: unknown): Comment {
      const parsed = parse(addComment, input);
      require(parsed.reportId);

      return repo.insertComment({
        parentId: parsed.reportId,
        authorId: viewer.person.id,
        body: parsed.body,
        target: parsed.target,
      });
    },

    removeComment(viewer: Viewer, id: string): void {
      const comment = repo.findComment(id);
      if (!comment) throw ApiError.notFound("That comment");
      if (comment.authorId !== viewer.person.id) {
        throw ApiError.forbidden(text("refusal.reachOut.commentOwner"));
      }
      repo.deleteComment(id);
    },

    /** Who has worked on a report, the first author first. */
    contributors(report: ReachOutReport): string[] {
      return contributorsOf(report);
    },
  };
}

export type ReachOutService = ReturnType<typeof createReachOutService>;
