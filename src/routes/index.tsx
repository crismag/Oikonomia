import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarRange,
  FileText,
  Gauge,
  Inbox,
  Plus,
  Sprout,
  Target,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { HomeOrientation } from "@/components/oikonomia/home-orientation";
import { Page } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { StatusDot } from "@/components/oikonomia/semantic-status";
import { CardEmpty, ObjectRow, WorkspaceCard } from "@/components/oikonomia/workspace-card";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { useReports } from "@/components/oikonomia/report-provider";
import { useSchedule } from "@/components/oikonomia/schedule-provider";
import { useMyMeetingTasks } from "@/components/oikonomia/meeting-provider";
import { useLeadershipInbox } from "@/components/oikonomia/escalation-provider";
import { ChurchSetupCard } from "@/components/oikonomia/church-setup-card";
import { escalationHref, escalationLabel, isOverdue } from "@/domain/escalation";
import { fetchDashboard, type Dashboard } from "@/lib/dashboard-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import { dueLabel, needsAttention, statusLabel } from "@/domain/obligations";
import {
  gatheringHeadline,
  gatheringStatusLabel,
  homeGatherings,
  myAction,
  myActionLabel,
} from "@/domain/lifegroup";
import { canJoinGathering } from "@/domain/authorize";
import { isCurrent, isFiled, reportStatusLabel } from "@/domain/leadership-report";
import { planningForDays, planningHref, planningTime } from "@/domain/planning";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { fromISO, toISO, weekDays, weekOf } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";
import { daylight, type AreaId } from "@/domain/appearance";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home — Oikonomia" },
      {
        name: "description",
        content: "What needs your attention, what is happening around you, and where to go next.",
      },
    ],
  }),
  component: HomePage,
});

/**
 * Home — where a leader lands, and where they leave from.
 *
 * Its whole job is orientation: **what needs me, what is happening, where do I
 * go next** — answered in seconds, then got out of the way.
 *
 * ## It is a set of windows, not a copy of the product
 *
 * Every object has one authoritative home and this is not it. A report belongs
 * to Leadership Reports, a gathering to LifeGroup, an obligation to My
 * Progress; each card previews a few and hands the leader over. Nothing is
 * edited here, and no card is the place to do the work.
 *
 * ## It is not My Progress
 *
 * My Progress asks the slower question — how am I doing against what is
 * expected? — with the cycle, the completion and the stages. Home asks what to
 * do in the next minute. Two depths of the same personal question, and one page
 * trying to be both would do neither.
 *
 * ## It is not the Team Overview
 *
 * That is oversight of other people, and it appears only for readers who have
 * it. Home is this leader's own orientation.
 */
function HomePage() {
  const { ministries, venues } = useOrganization();
  const viewer = useViewer();
  const { person } = viewer;
  const today = useMemo(() => toISO(new Date()), []);

  const dashboard = useQuery<Dashboard>({
    queryKey: ["dashboard", today],
    queryFn: async () => unwrap(await withTimeout(fetchDashboard({ data: { today } }))),
    retry: 1,
    retryDelay: 500,
    networkMode: "always",
  });

  const schedule = useSchedule();
  /* Tasks a meeting gave this leader. The same records, in their week. */
  const myTasks = useMyMeetingTasks();
  const lifegroup = useLifegroup();
  const reports = useReports();
  const inbox = useLeadershipInbox();

  const days = weekDays(weekOf(today));
  const ministryName = (id: string | undefined) =>
    id ? ministries.find((m) => m.id === id)?.name : undefined;

  /* ------------------------------------------------------------ windows */

  const obligations = dashboard.data
    ? [...dashboard.data.weekly.obligations, ...dashboard.data.monthly.obligations]
    : [];
  const attention = needsAttention(obligations).filter(
    (o) => o.status === "blocked" || o.status === "warning",
  );
  /* Work in hand is not the same as work that needs a decision — one belongs
     under attention, the other under what I am carrying. */
  const mine = needsAttention(obligations).filter(
    (o) => o.status === "in_progress" || o.status === "not_started",
  );

  const weekOpen = planningForDays(
    days,
    schedule.entries,
    schedule.agenda,
    ministryName,
    myTasks.tasks,
  ).filter((item) => item.date >= today && !item.completed);
  const week = weekOpen.slice(0, 6);
  const weekLeft = weekOpen.length;

  /* The board's light, read after mount so the server's render and the
     browser's agree; the day's light is the neutral first guess. */
  const [light, setLight] = useState<ReturnType<typeof daylight>>("day");
  useEffect(() => setLight(daylight(new Date().getHours())), []);

  /*
   * The week, not the future. A gathering led last night still needs writing
   * up, and a card that showed only what is ahead would say "nothing
   * scheduled" to a leader who owes a report for Thursday. And this leader's,
   * not the whole schedule: unclaimed rows follow, labelled as needing a leader.
   */
  const weekStart = days[0]!;
  const myGatherings = homeGatherings(lifegroup.gatherings, person.id, weekStart, today);

  /*
   * What is still open first, then the most recent. A card that led with last
   * June's published report would be answering a question nobody asked.
   */
  const myReports = reports.visible
    .filter((r) => r.authorId === person.id && isCurrent(r.status))
    .sort(
      (a, b) =>
        Number(isFiled(a.status)) - Number(isFiled(b.status)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 3);
  /*
   * What has been **asked of** this leader — a decision, a task, a matter
   * raised for them to consider. Not "reports submitted to me": a report
   * arriving is information, and putting it here would make the home page
   * claim that reading is owed.
   */
  const askedOfMe = inbox.mine.slice(0, 3);
  /* Asks are not obligations, so they never enter "Needs your attention" — but
     that card must not say nothing is overdue while one of them is. */
  const askOverdue = inbox.mine.some((item) => isOverdue(item, today));

  const myMinistries = ministries.filter(
    (m) => m.leadId === person.id || m.teamIds.includes(person.id),
  );

  const next = attention[0];

  return (
    <Page width="workspace">
      {/*
       * The greeting board. Its light follows the time of day; the tiles are
       * the four questions Home answers, each a door to where it is answered.
       */}
      <header
        data-area="home"
        data-daylight={light}
        style={{ backgroundImage: `var(--hero-${light})` }}
        className={cn(
          "relative mb-6 overflow-hidden rounded-3xl border border-border shadow-card",
          light === "night" ? "text-white" : "text-foreground",
        )}
      >
        <div className="hero-glow pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative grid gap-6 px-6 py-7 sm:px-9 sm:py-9 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <p
              className={cn(
                "text-[13px] font-medium",
                light === "night" ? "text-white/75" : "text-muted-foreground",
              )}
            >
              {format(fromISO(today), "EEEE, d MMMM")}
            </p>
            <h1 className="mt-1 text-[32px] leading-[1.08] sm:text-[42px]">
              {greeting()}, <PersonName personId={person.id} />
            </h1>
            <p
              className={cn(
                "mt-2 max-w-xl text-[15px]",
                light === "night" ? "text-white/85" : "text-foreground/80",
              )}
            >
              {attention.length > 0
                ? attention.length === 1
                  ? "One thing needs you. The rest of the week is below."
                  : `${attention.length} things need you. The rest of the week is below.`
                : inbox.mine.length > 0
                  ? inbox.mine.length === 1
                    ? "One thing has been asked of you."
                    : `${inbox.mine.length} things have been asked of you.`
                  : "Nothing is waiting on you."}
            </p>

            {/*
             * When something needs you, the one press continues it. Adding to
             * the week is always available — it is not the thing the page is
             * for when something is already overdue.
             */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {next ? (
                <Link to={next.destination} className={buttonVariants({ variant: "primary" })}>
                  {next.nextAction ?? "Continue"}
                </Link>
              ) : null}
              <Link
                to="/weekly-agenda"
                className={buttonVariants({ variant: next ? "secondary" : "primary" })}
              >
                <Plus className="size-3.5" aria-hidden />
                Add to the week
              </Link>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:w-[34rem]">
            <HeroTile
              area="home"
              icon={Gauge}
              label="Need you"
              value={dashboard.isLoading ? undefined : attention.length}
              to="/my-progress"
              night={light === "night"}
            />
            <HeroTile
              area="lead"
              icon={Inbox}
              label="Asked of you"
              value={inbox.mine.length}
              to="/inbox"
              night={light === "night"}
            />
            <HeroTile
              area="plan"
              icon={CalendarRange}
              label="Left this week"
              value={schedule.status === "loading" ? undefined : weekLeft}
              to="/weekly-agenda"
              night={light === "night"}
            />
            <HeroTile
              area="life"
              icon={Sprout}
              label="Gatherings"
              value={lifegroup.status === "loading" ? undefined : myGatherings.length}
              to="/lifegroups"
              night={light === "night"}
            />
          </ul>
        </div>
      </header>

      <ChurchSetupCard />
      <HomeOrientation />

      {dashboard.isError ? (
        <ErrorState title="Your binder could not be read" onRetry={() => void dashboard.refetch()}>
          Nothing is lost. This is a problem reaching it, not a quiet week.
        </ErrorState>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* -------------------------------------------- 1. attention */}

          <WorkspaceCard
            title="Needs your attention"
            area="home"
            icon={Gauge}
            count={attention.length}
            action={{ label: "My Progress", to: "/my-progress" }}
            className="lg:col-span-2"
          >
            {dashboard.isLoading ? (
              <ListSkeleton rows={3} />
            ) : attention.length > 0 ? (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {attention.map((item) => (
                  <ObjectRow
                    key={item.id}
                    to={item.destination}
                    title={item.title}
                    context={item.module}
                    mark={<StatusDot status={item.status} size="sm" />}
                    {...(item.nextAction ? { action: item.nextAction } : {})}
                    meta={
                      item.blockedReason ??
                      dueLabel(item.dueAt, today, item.status) ??
                      statusLabel[item.status]
                    }
                  />
                ))}
              </ul>
            ) : (
              <CardEmpty>
                {askOverdue
                  ? "Nothing in your own cycle is overdue. Something asked of you is past the date it was needed by — it is below."
                  : "Nothing is overdue or close to it. What you are carrying is below."}
              </CardEmpty>
            )}
          </WorkspaceCard>

          {/* --------------------------------------- asked of you */}

          {askedOfMe.length > 0 ? (
            <WorkspaceCard
              title="Asked of you"
              area="lead"
              icon={Inbox}
              /* All that is waiting, though the card previews only a few. */
              count={inbox.mine.length}
              action={{ label: "Leadership Inbox", to: "/inbox" }}
              className="lg:col-span-2"
            >
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {askedOfMe.map((item) => {
                  const href = escalationHref(item.sourceType, item.sourceId);
                  return (
                    <ObjectRow
                      key={item.id}
                      to={href?.to ?? "/inbox"}
                      {...(href?.search ? { search: href.search } : {})}
                      title={item.request}
                      context={item.contextLabel || "Leadership Inbox"}
                      action={
                        item.type === "approval"
                          ? "Decide"
                          : item.type === "action"
                            ? "Act"
                            : "Consider"
                      }
                      meta={dueLabel(item.neededBy, today) ?? escalationLabel[item.type]}
                    />
                  );
                })}
              </ul>
            </WorkspaceCard>
          ) : null}

          {/* ------------------------------------------- 2. this week */}

          <WorkspaceCard
            title="This week"
            area="plan"
            icon={CalendarRange}
            action={{ label: "Weekly Agenda", to: "/weekly-agenda" }}
          >
            {schedule.status === "loading" ? (
              <ListSkeleton rows={3} />
            ) : week.length > 0 ? (
              <ul>
                {week.map((item) => {
                  const href = planningHref(item);
                  return (
                    <ObjectRow
                      key={item.id}
                      to={href.to}
                      {...(href.search ? { search: href.search } : {})}
                      title={item.title}
                      context={[item.contextLabel, item.location].filter(Boolean).join(" · ")}
                      meta={
                        <>
                          {format(fromISO(item.date), "EEE")}
                          {planningTime(item) ? ` · ${planningTime(item)}` : ""}
                        </>
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <CardEmpty
                action={
                  <Link
                    to="/weekly-agenda"
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Plan the week
                  </Link>
                }
              >
                Nothing left on the week. Add what you intend to do.
              </CardEmpty>
            )}
          </WorkspaceCard>

          {/* --------------------------------------------- 3. my work */}

          <WorkspaceCard
            title="What you are carrying"
            area="goals"
            icon={Target}
            count={mine.length}
            action={{ label: "My Progress", to: "/my-progress" }}
          >
            {dashboard.isLoading ? (
              <ListSkeleton rows={3} />
            ) : mine.length > 0 ? (
              <ul>
                {mine.map((item) => (
                  <ObjectRow
                    key={item.id}
                    to={item.destination}
                    title={item.title}
                    /* A report stays a report and a goal stays a goal — the
                       section it belongs to is the context, not a type tag. */
                    context={item.module}
                    mark={<StatusDot status={item.status} size="sm" />}
                    {...(item.nextAction ? { action: item.nextAction } : {})}
                    meta={dueLabel(item.dueAt, today, item.status) ?? statusLabel[item.status]}
                  />
                ))}
              </ul>
            ) : (
              <CardEmpty>Everything expected of you this cycle is recorded.</CardEmpty>
            )}
          </WorkspaceCard>

          {/* ------------------------------------------ 4. lifegroups */}

          <WorkspaceCard
            title="LifeGroup"
            area="life"
            icon={Sprout}
            action={{ label: "The schedule", to: "/lifegroups" }}
          >
            {lifegroup.status === "loading" ? (
              <ListSkeleton rows={2} />
            ) : myGatherings.length > 0 ? (
              <ul>
                {myGatherings.map(({ gathering, needsLeader }) => {
                  const action = myAction(
                    gathering,
                    person.id,
                    canJoinGathering(viewer, gathering),
                  );
                  if (needsLeader) {
                    return (
                      <ObjectRow
                        key={gathering.id}
                        to={`/lifegroups/${gathering.id}`}
                        search={{}}
                        title={gatheringHeadline(venues, gathering)}
                        context={`${format(fromISO(gathering.date), "EEE d MMM")}${gathering.startTime ? ` · ${gathering.startTime}` : ""}`}
                        {...(action === "claim" ? { action: myActionLabel.claim } : {})}
                        meta="Needs a leader"
                      />
                    );
                  }
                  return (
                    <ObjectRow
                      key={gathering.id}
                      to={`/lifegroups/${gathering.id}`}
                      search={{}}
                      title={gatheringHeadline(venues, gathering)}
                      context={`${format(fromISO(gathering.date), "EEE d MMM")}${gathering.startTime ? ` · ${gathering.startTime}` : ""}`}
                      {...(action === "claim" ? { action: myActionLabel.claim } : {})}
                      {...(action === "leave"
                        ? { meta: "You are leading" }
                        : action === "claim"
                          ? {}
                          : { meta: gatheringStatusLabel[gathering.status] })}
                    />
                  );
                })}
              </ul>
            ) : (
              <CardEmpty
                action={
                  <Link
                    to="/lifegroups"
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Open the schedule
                  </Link>
                }
              >
                You are not leading a gathering this week, and none is waiting for a leader.
              </CardEmpty>
            )}
          </WorkspaceCard>

          {/* --------------------------------------------- 5. reports */}

          <WorkspaceCard
            title="Your reports"
            area="reports"
            icon={FileText}
            action={{ label: "Leadership Reports", to: "/leadership-reports" }}
          >
            {myReports.length > 0 ? (
              <ul>
                {myReports.map((report) => (
                  <ObjectRow
                    key={report.id}
                    to={`/leadership-reports/${report.id}`}
                    title={report.title || "Untitled report"}
                    context={report.reportingPeriod ?? "No period set"}
                    meta={reportStatusLabel[report.status]}
                  />
                ))}
              </ul>
            ) : (
              <CardEmpty
                action={
                  <Link
                    to="/leadership-reports"
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Write a report
                  </Link>
                }
              >
                Nothing of yours is open.
              </CardEmpty>
            )}
          </WorkspaceCard>

          {/* ----------------------------------------- 6. shared work */}

          <WorkspaceCard
            title="Shared with others"
            area="ministry"
            icon={UsersRound}
            action={{ label: "Ministry", to: "/ministries" }}
            className="lg:col-span-2"
          >
            {myMinistries.length > 0 ? (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {myMinistries.slice(0, 6).map((ministry) => (
                  <ObjectRow
                    key={ministry.id}
                    to={`/ministries/${ministry.id}`}
                    search={{}}
                    title={ministry.name}
                    context={ministry.leadId === person.id ? "You lead this" : "You serve here"}
                  />
                ))}
              </ul>
            ) : (
              <CardEmpty
                action={
                  <Link
                    to="/lifegroups"
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    LifeGroup schedule
                  </Link>
                }
              >
                No ministry is recorded against you yet. The LifeGroup schedule is still shared —
                anyone can add a row or claim a gathering.
              </CardEmpty>
            )}
            {myMinistries.length > 0 ? (
              <p className={cn("mt-2 text-[12px] text-muted-foreground")}>
                The LifeGroup schedule is shared too — anyone can add a row or claim a gathering.
              </p>
            ) : null}
          </WorkspaceCard>
        </div>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <CalendarClock className="size-3.5" aria-hidden />
        Open anything here to continue it. Home does not keep a second copy.
      </p>
    </Page>
  );
}

/** What time of day it is, in the leader's terms. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * One of the questions Home answers, as a number and a door.
 *
 * The number is a count of real records; a dash while it is still loading, never
 * a zero that is not yet true.
 */
function HeroTile({
  area,
  icon: Icon,
  label,
  value,
  to,
  night,
}: {
  area: AreaId;
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  to: string;
  night: boolean;
}) {
  return (
    <li data-area={area}>
      <Link
        to={to}
        className={cn(
          "group flex h-full items-center gap-3 rounded-2xl p-3 backdrop-blur-md transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:p-3.5",
          night
            ? "bg-white/10 ring-1 ring-white/15 hover:bg-white/15"
            : "bg-surface/70 ring-1 ring-border hover:bg-surface/90",
        )}
      >
        <span
          className="grid size-8 place-items-center rounded-xl bg-area text-on-area shadow-raised"
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <span>
          <span className="block font-display text-[22px] leading-none tabular-nums sm:text-[26px]">
            {value === undefined ? "–" : value}
          </span>
          <span
            className={cn(
              "mt-1 block text-[12px] font-medium",
              night ? "text-white/75" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </span>
      </Link>
    </li>
  );
}
