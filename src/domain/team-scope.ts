import type { TeamScope } from "./team-overview";
import type { Ministry, Person, ResponsibilityGroup } from "./types";

/**
 * Whose leadership work a reader may see by name.
 *
 * Derived from oversight the church already records — the responsibility
 * groups it has named as leadership bodies, and who leads a ministry — rather
 * than from a rank. Seniority is not the rule anywhere else in Oikonomia and
 * must not become the rule here.
 *
 * ## Reach comes from the group's own record
 *
 * A leadership body with no campus on it answers for the whole church; one
 * with a campus answers for that campus. That is the group record speaking
 * for itself, which is the point: this used to be two constants, so a church
 * could name neither its leadership nor how far it reached.
 *
 * The default is **nobody**. A reader with no oversight responsibility sees how
 * the church is doing and not who is behind, which is the correct answer for
 * most of the people who will open this page.
 */

/** Someone the binder expects leadership work from. */
export function isLeader(
  person: Person,
  ministries: Ministry[],
  gatheringLeaderIds: Set<string>,
  reportAuthorIds: Set<string>,
): boolean {
  return (
    ministries.some((m) => m.leadId === person.id) ||
    gatheringLeaderIds.has(person.id) ||
    reportAuthorIds.has(person.id)
  );
}

/** The leadership bodies this person actually belongs to. */
const leadershipBodies = (person: Person, groups: ResponsibilityGroup[]) =>
  groups.filter(
    (group) => group.active && group.leadershipAudience && group.memberIds.includes(person.id),
  );

/**
 * The scope a reader gets, and the sentence explaining it.
 *
 * The explanation is shown. Somebody reading an organizational page has to be
 * able to tell what they are looking at the whole of — a page that quietly
 * shows a subset reads as the whole church.
 */
export function scopeFor(
  person: Person,
  ministries: Ministry[],
  campusName: string,
  groups: ResponsibilityGroup[] = [],
): TeamScope & { campusId?: string; ministryIds?: string[] } {
  const bodies = leadershipBodies(person, groups);

  const churchWide = bodies.find((group) => !group.campusId);
  if (churchWide) {
    return {
      label: "All leaders",
      reason: `You are part of ${churchWide.name}.`,
      namesVisible: true,
    };
  }

  const forThisCampus = bodies.find((group) => group.campusId === person.campusId);
  if (forThisCampus) {
    return {
      label: `${campusName} leaders`,
      reason: `You are part of ${forThisCampus.name}.`,
      namesVisible: true,
      campusId: person.campusId,
    };
  }

  const led = ministries.filter((m) => m.leadId === person.id);
  if (led.length > 0) {
    return {
      label: led.map((m) => m.name).join(" · "),
      reason: "You lead these ministries.",
      namesVisible: true,
      ministryIds: led.map((m) => m.id),
    };
  }

  /*
   * No oversight responsibility. How the church is doing is reasonable for a
   * leader to know; who is behind is not theirs, and seniority-by-default is
   * how that quietly stops being true.
   */
  return {
    label: campusName,
    reason: "You can see how the campus is doing, not who is behind.",
    namesVisible: false,
  };
}
