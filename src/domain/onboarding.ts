import type { Persona } from "./types";

/**
 * Setting somebody up, and showing them round.
 *
 * ## Two modes over one flow
 *
 * **Setup** is the first pass: confirm who you are, where you serve, who you
 * report to. **Walkthrough** is the replay: the same screens, read-only where
 * the first pass wrote, plus the orientation. They share the flow because a
 * leader asking "how does this work again?" is looking at the same material —
 * and they differ in effect, because replaying must not re-ask the
 * organisation anything.
 *
 * ## What onboarding owns
 *
 * Its own progress, and nothing else. Every organisational fact on these
 * screens is read from the organisation's records, and every change goes back
 * through the assignment service — which writes what a person says about
 * themselves as a **claim awaiting confirmation**. There is no path from this
 * flow to membership, a role, a capability or a reporting line.
 */

export const onboardingSteps = [
  "welcome",
  "profile",
  "responsibilities",
  "ministries",
  "groups",
  "reporting",
  "summary",
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number];

/**
 * The version of the process a completed run counts as.
 *
 * Raise this when a **new confirmation becomes required**, not when wording
 * changes. Raising it asks everybody to look again, which is a cost.
 */
export const ONBOARDING_VERSION = 1;

export type OnboardingStatus = "not-started" | "in-progress" | "complete";

export interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  /** The version the person last completed. 0 when they never have. */
  version: number;
  startedAt?: string;
  completedAt?: string;
}

export const notStarted: OnboardingState = {
  status: "not-started",
  step: "welcome",
  version: 0,
};

/**
 * Whether this person still has setup to do.
 *
 * True when they have never finished, and when they finished an older version
 * than the one now required. False otherwise — including while they are
 * replaying it voluntarily, because a replay is not an obligation.
 */
export function setupRequired(state: OnboardingState): boolean {
  if (state.status === "complete") return state.version < ONBOARDING_VERSION;
  return true;
}

/**
 * Which steps this person actually sees.
 *
 * Context-aware in the sense the brief asks for: a step with nothing to show is
 * **removed rather than shown empty**. Somebody the church has recorded no
 * reporting line for is not asked to confirm one, because there is nothing to
 * confirm and a blank screen reads as a broken page.
 *
 * Order is fixed. Nothing here decides what somebody may do.
 */
export function stepsFor(context: {
  hasMinistries: boolean;
  hasGroups: boolean;
  hasReportingContext: boolean;
}): OnboardingStep[] {
  return onboardingSteps.filter((step) => {
    if (step === "ministries") return context.hasMinistries;
    if (step === "groups") return context.hasGroups;
    if (step === "reporting") return context.hasReportingContext;
    return true;
  });
}

/** Whether a step must be completed before the person can finish. */
export function isRequired(step: OnboardingStep): boolean {
  /*
   * Only the ones that establish readiness. Confirming a ministry list is
   * recommended, not required: a leader with nothing to confirm, or who
   * disagrees with everything, must still be able to reach their work — an
   * onboarding that traps somebody is worse than one they skipped.
   */
  return step === "welcome" || step === "profile" || step === "summary";
}

export function nextStep(current: OnboardingStep, available: OnboardingStep[]): OnboardingStep {
  const index = available.indexOf(current);
  return available[Math.min(index + 1, available.length - 1)] ?? "summary";
}

export function previousStep(current: OnboardingStep, available: OnboardingStep[]): OnboardingStep {
  const index = available.indexOf(current);
  return available[Math.max(index - 1, 0)] ?? "welcome";
}

export const stepTitle: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  profile: "Your details",
  responsibilities: "Your responsibilities",
  ministries: "Your ministries",
  groups: "Teams and committees",
  reporting: "Reporting",
  summary: "Your workspace is ready",
};

/* --------------------------------------------------------------- the tour */

export interface TourStop {
  /** The route it is about. Used to link, and to check it is reachable. */
  to: string;
  title: string;
  body: string;
  /** Shown only to somebody who holds this capability. */
  capability?: Persona["capabilities"][number];
}

/**
 * The orientation, in the order somebody meets these things.
 *
 * **Nothing here tours a module the viewer cannot reach.** Stops carrying a
 * capability are filtered out for everybody else, which is the difference
 * between an orientation and a sales tour: showing a leader the Administration
 * screen teaches them the product has one and that they may not use it.
 *
 * The text says what the page is *for*, not which button to press. Buttons
 * move; what a page is for does not.
 */
export const tourStops: TourStop[] = [
  {
    to: "/",
    title: "Home",
    body: "What needs you today. Open anything here to continue it where it lives. Nothing appears because somebody else read something — only because something is actually waiting on you.",
  },
  {
    to: "/weekly-agenda",
    title: "Weekly Agenda",
    body: "Your working week. Open anything on Home to land on that item. Anything assigned to you from a meeting turns up here on the day it is due.",
  },
  {
    to: "/meeting-notes",
    title: "Meeting Notes",
    body: "Two different things, deliberately: a personal note is your own working record and nobody else reads it; minutes are the meeting's own account, and its participants do.",
  },
  {
    to: "/lifegroups",
    title: "LifeGroup",
    body: "The schedule of gatherings. Claiming one makes it yours to record — who came, and what was worth writing down.",
  },
  {
    to: "/leadership-reports",
    title: "Leadership Reports",
    body: "Your account of your work, addressed to an audience you choose. Publishing one puts it in front of those people; it does not put it in anybody's queue.",
  },
  {
    to: "/goals",
    title: "Goals",
    body: "What the ministry said it wanted to improve this year, and where each goal stands. Home will send you here when a goal needs you.",
  },
  {
    to: "/inbox",
    title: "Leadership Inbox",
    body: "What has actually been asked of you. Being able to read something never puts it here. An action you take on can be put on your week from here.",
  },
  {
    to: "/team",
    title: "Team Overview",
    body: "How the leadership work is going across the people you oversee. You see how things stand, never what a report says.",
    capability: "campus-oversight",
  },
  {
    to: "/administration",
    title: "Administration",
    body: "Who is in the church, how it is organised, and what things are called. Managing structure is not permission to read what people write.",
    capability: "administration",
  },
];

export function tourFor(persona: Persona): TourStop[] {
  return tourStops.filter(
    (stop) => !stop.capability || persona.capabilities.includes(stop.capability),
  );
}
