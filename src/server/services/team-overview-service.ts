import { canDiscover, isFiled } from "@/domain/leadership-report";
import { statusLabel, type ObligationStatus } from "@/domain/obligations";
import { isLeader, scopeFor } from "@/domain/team-scope";
import {
  distribution,
  overallStatus,
  type HeatmapCell,
  type LeaderStatus,
  type ReportingHealth,
  type TeamAttentionItem,
  type TeamOverview,
  type TrendPoint,
  type WorkAreaHealth,
} from "@/domain/team-overview";
import { fromISO } from "@/domain/schedule";
import type { DashboardService } from "./dashboard-service";
import type { LeadershipReportRepository } from "../repositories/leadership-report-repository";
import type { LifegroupRepository } from "../repositories/lifegroup-repository";
import type { WorkRepository } from "../repositories/work-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { ReadStateRepository } from "../repositories/escalation-repository";
import type { Person } from "@/domain/types";
import type { Viewer } from "@/domain/viewer";

/**
 * The organization's leadership work, assembled.
 *
 * ## It answers the same question one level up
 *
 * My Binder asks "what needs *me*?"; this asks "what needs *our leadership*?".
 * It is built by running the same obligation projection for each leader in
 * scope and summarizing — which is deliberate: two pages that computed "done"
 * differently would disagree in front of the person who has to act on both.
 *
 * ## Names and content are two separate permissions
 *
 * Everyone in scope sees how the church is doing. Only a reader with recorded
 * oversight sees **whose** work is behind. And nobody sees what a report
 * *says* — a leader's state travels as a module and a state, never a title,
 * because a title is content.
 *
 * ## Aggregation must not walk around a gate
 *
 * Leadership reports are counted through `canDiscover`, the same gate the
 * module uses. Summing withheld records into a public number is a slower way
 * of disclosing them.
 */

/** How many recent periods the trend and the consistency view cover. */
const TREND_PERIODS = 8;

export function createTeamOverviewService(
  dashboard: DashboardService,
  repos: {
    reports: LeadershipReportRepository;
    lifegroup: LifegroupRepository;
    work: WorkRepository;
    /* Who the leaders are is a record now, not a fixture: a campus with nobody
       in it reports on nobody, which is the truthful answer. */
    organization: OrganizationRepository;
    /** Optional: what this viewer has read, for the unread count. */
    readState?: ReadStateRepository;
  },
) {
  /** People the binder expects leadership work from. */
  function leadersOf(viewer: Viewer): { scope: ReturnType<typeof scopeFor>; leaders: Person[] } {
    const ministries = repos.organization.ministries();
    const campusName =
      repos.organization.campuses().find((c) => c.id === viewer.person.campusId)?.name ??
      "This campus";
    const scope = scopeFor(viewer.person, ministries, campusName, repos.organization.groups());

    const gatheringLeaders = new Set(
      repos.lifegroup.allGatherings().flatMap((g) => g.assignedLeaderIds),
    );
    const reportAuthors = new Set(repos.reports.allUnguarded().map((r) => r.authorId));

    let leaders = repos.organization
      .people()
      .filter((person) => isLeader(person, ministries, gatheringLeaders, reportAuthors));

    if (scope.campusId) leaders = leaders.filter((p) => p.campusId === scope.campusId);
    if (scope.ministryIds) {
      const ids = new Set(scope.ministryIds);
      leaders = leaders.filter(
        (p) =>
          p.ministryIds.some((m) => ids.has(m)) ||
          ministries.some((m) => ids.has(m.id) && m.teamIds.includes(p.id)),
      );
    }
    if (!scope.namesVisible) {
      /* Aggregates still need the whole campus behind them; the names simply
         never leave this function. */
      leaders = leaders.filter((p) => p.campusId === viewer.person.campusId);
    }

    return { scope, leaders };
  }

  return {
    build(viewer: Viewer, today: string): TeamOverview {
      const { scope, leaders } = leadersOf(viewer);

      const attention: TeamAttentionItem[] = [];
      const statuses: LeaderStatus[] = [];
      const areaTotals = new Map<string, { done: number; total: number; destination: string }>();
      const counts: Record<ObligationStatus, number> = {
        done: 0,
        in_progress: 0,
        warning: 0,
        blocked: 0,
        not_started: 0,
      };

      for (const leader of leaders) {
        /* The same projection My Binder uses, run as that leader. */
        const asLeader: Viewer = { persona: viewer.persona, person: leader };
        const board = dashboard.build(asLeader, today);
        const obligations = [...board.weekly.obligations, ...board.monthly.obligations];

        const areas: Record<string, ObligationStatus> = {};
        for (const obligation of obligations) {
          /* Worst state wins per section: an overview exists to surface
             trouble, and averaging would let a real problem disappear. */
          areas[obligation.module] = areas[obligation.module]
            ? overallStatus([areas[obligation.module]!, obligation.status])
            : obligation.status;

          const area = areaTotals.get(obligation.module) ?? {
            done: 0,
            total: 0,
            destination: obligation.destination,
          };
          area.total += 1;
          if (obligation.status === "done") area.done += 1;
          areaTotals.set(obligation.module, area);

          counts[obligation.status] += 1;

          if (obligation.status === "blocked" || obligation.status === "warning") {
            attention.push({
              id: `${leader.id}-${obligation.id}`,
              reason: obligation.blockedReason
                ? "blocked"
                : obligation.status === "blocked"
                  ? "overdue"
                  : "due-soon",
              status: obligation.status,
              module: obligation.module,
              /*
               * The system's own terms, and nothing the leader wrote. The
               * obligation's title can name what a report is about; here it
               * would be telling everyone in scope.
               */
              summary: `${obligation.module} · ${statusLabel[obligation.status]}`,
              period: obligation.cycle,
              ...(scope.namesVisible ? { personId: leader.id } : {}),
              destination: scope.namesVisible ? obligation.destination : "/reports",
            });
          }
        }

        const overall = overallStatus(Object.values(areas));
        statuses.push({
          personId: leader.id,
          areas,
          overall,
          outstanding: obligations.filter((o) => o.status !== "done").length,
        });
      }

      /* ------------------------------------------------------- reporting */

      /*
       * Counted through the module's own gate, so a withheld report cannot be
       * disclosed by being added into a public total.
       */
      const visibleReports = repos.reports
        .allUnguarded()
        .filter((report) => canDiscover(report, viewer.persona, viewer.person));

      const leaderIds = new Set(leaders.map((l) => l.id));
      const inScope = visibleReports.filter((r) => leaderIds.has(r.authorId));

      const periods = recentPeriods(today, TREND_PERIODS);
      const periodSet = new Set(periods);
      const recent = inScope.filter((r) => r.reportingPeriod && periodSet.has(r.reportingPeriod));

      /*
       * One report per leader per period — so the unit counted has to be the
       * *leader-period*, not the report row. Counting rows meant a leader who
       * filed twice in a month pushed "submitted" above "expected", and the
       * page said 83 of 56.
       */
      const expected = leaders.length * periods.length;
      const filed = new Map<string, boolean>();
      for (const report of recent) {
        const key = `${report.authorId}:${report.reportingPeriod}`;
        /* Published anywhere in the pair counts the pair as on time. */
        filed.set(key, (filed.get(key) ?? false) || isFiled(report.status));
      }
      const submitted = filed.size;
      const published = [...filed.values()].filter(Boolean).length;

      const reporting: ReportingHealth = {
        expected,
        submitted,
        onTime: published,
        late: submitted - published,
        outstanding: Math.max(expected - submitted, 0),
        /*
         * What this viewer has not opened yet. A reading state, and the count
         * is of *their* reading — it used to be "awaiting review", a number
         * that grew every time a leader did their job.
         */
        unread: repos.readState
          ? recent.filter(
              (report) =>
                isFiled(report.status) &&
                !repos.readState!.readIds(viewer.person.id, "leadership-report").has(report.id),
            ).length
          : 0,
      };

      /* ----------------------------------------------- trend and heatmap */

      const trend: TrendPoint[] = periods.map((period) => ({
        label: shortPeriod(period),
        done: recent.filter((r) => r.reportingPeriod === period && isFiled(r.status)).length,
        total: leaders.length,
      }));

      const cells: HeatmapCell[] = [];
      if (scope.namesVisible) {
        for (const leader of leaders) {
          for (const period of periods) {
            const report = recent.find(
              (r) => r.authorId === leader.id && r.reportingPeriod === period,
            );
            cells.push({
              personId: leader.id,
              period: shortPeriod(period),
              status: !report ? "blocked" : isFiled(report.status) ? "done" : "warning",
            });
          }
        }
      }

      const workAreas: WorkAreaHealth[] = [...areaTotals.entries()]
        .map(([module, area]) => ({ module, ...area }))
        .sort((a, b) => a.done / (a.total || 1) - b.done / (b.total || 1));

      return {
        scope,
        period: `Week of ${today}`,
        leaderCount: leaders.length,
        counts,
        /* Worst first, so nothing urgent is below the fold. */
        attention: attention.sort((a, b) => weightOf(a.status) - weightOf(b.status)).slice(0, 12),
        leaders: statuses,
        workAreas,
        reporting,
        trend,
        heatmap: { periods: periods.map(shortPeriod), cells },
      };
    },
  };
}

const weightOf = (status: ObligationStatus) =>
  status === "blocked" ? 0 : status === "warning" ? 1 : 2;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The last `count` monthly reporting periods, oldest first. */
function recentPeriods(today: string, count: number): string[] {
  const out: string[] = [];
  const date = fromISO(today);
  for (let back = count - 1; back >= 0; back -= 1) {
    const d = new Date(date.getFullYear(), date.getMonth() - back, 1);
    out.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  return out;
}

const shortPeriod = (period: string) => {
  const [month, year] = period.split(" ");
  return `${month!.slice(0, 3)} ${year!.slice(2)}`;
};

export type TeamOverviewService = ReturnType<typeof createTeamOverviewService>;
