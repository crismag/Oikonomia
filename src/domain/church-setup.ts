/**
 * Setting up a church, after the first administrator exists.
 *
 * `/setup` creates one person. Everything after that — a campus, the
 * ministries, the leaders, a way in for them, and where they serve — is done
 * on Administration, which is a set of forms and says nothing about order. An
 * administrator who has just finished `/setup` lands on a Home full of
 * leadership-cycle obligations for a church that does not exist yet.
 *
 * These steps are computed from what the installation actually holds. Nothing
 * here can be ticked by hand, and nothing is invented: when the records exist
 * the step is done, and when every step is done the checklist is gone.
 */

export interface ChurchSetupProgress {
  campuses: number;
  ministries: number;
  /** Everybody in the directory, including whoever is looking. */
  people: number;
  /** People other than the viewer who have an account — invited or signed in. */
  othersWithAccounts: number;
  /** Ministry and group assignments an administrator has confirmed. */
  confirmedAssignments: number;
}

export type ChurchSetupStepId = "campus" | "ministries" | "leaders" | "invitations" | "assignments";

export interface ChurchSetupStep {
  id: ChurchSetupStepId;
  title: string;
  /** What doing it involves, in one sentence. */
  detail: string;
  done: boolean;
  /** The section of Administration where this is done. */
  section: string;
}

export function churchSetupSteps(progress: ChurchSetupProgress): ChurchSetupStep[] {
  return [
    {
      id: "campus",
      title: "Add your campus",
      detail: "Where the church meets. A church with one site has one campus.",
      done: progress.campuses > 0,
      section: "campuses",
    },
    {
      id: "ministries",
      title: "Add the ministries",
      detail: "The areas leaders serve in, so reports and goals have somewhere to belong.",
      done: progress.ministries > 0,
      section: "ministries",
    },
    {
      id: "leaders",
      title: "Add the leaders",
      detail: "The people who will use Oikonomia, with who each reports to.",
      done: progress.people > 1,
      section: "people",
    },
    {
      id: "invitations",
      title: "Invite them in",
      detail: "An invitation gives someone a way to sign in, and nothing else.",
      done: progress.othersWithAccounts > 0,
      section: "people",
    },
    {
      id: "assignments",
      title: "Confirm where they serve",
      detail:
        "When invited leaders first sign in they say where they serve. Confirming it is what decides what each one sees.",
      done: progress.confirmedAssignments > 0,
      section: "assignments",
    },
  ];
}

/** Whether the checklist still has anything to say. */
export const churchSetupComplete = (steps: ChurchSetupStep[]) => steps.every((step) => step.done);
