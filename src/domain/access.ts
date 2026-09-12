import type { AccessDecision, AudiencePolicy, Classification, Persona, Person } from "./types";

/**
 * Who may open a record, and how much of it.
 *
 * **This is enforcement, not a description of it.** `resolveAccess` is called
 * by `goals-service`, `work-service` and `document-service` before they return
 * anything, and by `leadership-report.ts` to decide report discovery. A change
 * here changes what people can read.
 *
 * It used to describe itself as a deterministic mock for a prototype whose
 * production enforcement was deferred. That stopped being true once the
 * services began calling it, and the comment survived the change — which is
 * the most dangerous kind of stale documentation, because it invites somebody
 * to treat a live authorization rule as disposable.
 *
 * ## The four rules it exists to hold
 *
 * - **Attention never grants access.** Being asked to look at something is not
 *   permission to read it.
 * - **Administration is not omniscience.** Administering the installation does
 *   not make somebody an audience for what is in it.
 * - **Rank never overrides a classification ceiling.** Seniority is not a key.
 * - **Default deny.** Anything the rules below do not grant is refused.
 *
 * ## Order matters
 *
 * Exclusion is checked before every grant, ownership before sharing, and a
 * section-level ceiling last — so a reviewer sees the record while sections
 * held to a stricter audience stay closed. Only the owner and an explicitly
 * named audience clear such a ceiling; without that, mixed-sensitivity records
 * could not exist.
 */

export const classificationLabel: Record<Classification, string> = {
  open: "Open organizational",
  "context-restricted": "Context restricted",
  "leadership-confidential": "Leadership confidential",
  "pastoral-private": "Pastoral / private",
};

const has = (list: string[] | undefined, id: string) => !!list?.includes(id);

function decide(
  level: AccessDecision["level"],
  rationale: string,
  policy: AudiencePolicy,
): AccessDecision {
  return {
    level,
    rationale,
    restrictedSections: level === "full" ? [] : (policy.restrictedSections ?? []),
  };
}

export function resolveAccess(
  persona: Persona,
  person: Person,
  policy: AudiencePolicy,
): AccessDecision {
  const me = persona.personId;
  const groups = policy.audienceGroups ?? [];
  /*
   * Membership of a responsibility group, which is its own record.
   *
   * `ministryIds` is still consulted because group ids used to be stored
   * there — a person's ministry list was doing two jobs. New membership lands
   * in `groupIds`; reading both means historical records keep resolving while
   * nothing new depends on the conflation.
   */
  const belongsTo = [...(person.groupIds ?? []), ...person.ministryIds];
  const inGroup = groups.some((g) => belongsTo.includes(g));
  const sameCampus = !policy.campusId || policy.campusId === person.campusId;

  // 2. Explicit exclusion beats ordinary contextual grants.
  if (has(policy.excluded, me)) {
    return decide("denied", "Explicitly restricted from this object", policy);
  }

  // 4. Ownership / direct responsibility, bounded by the classification ceiling.
  if (policy.ownerId === me) {
    return decide("full", "You own this object", policy);
  }

  // 3. Explicit audience / share.
  if (has(policy.audience, me)) {
    return decide("full", "Explicitly shared with you", policy);
  }

  /*
   * Direct responsibility grants the object, but not sections classified more
   * strictly than the object itself. Only the owner and an explicitly named
   * audience clear a section-level ceiling — see "Object and field sensitivity"
   * above. Without this, `restrictedSections` would never
   * apply to anyone and mixed-sensitivity records could not exist.
   */
  const stricterSections = (policy.restrictedSections ?? []).length > 0;

  if (has(policy.reviewers, me)) {
    return stricterSections
      ? decide(
          "limited",
          "You review this record; sections held to a stricter audience stay closed",
          policy,
        )
      : decide("full", "You are the assigned reviewer", policy);
  }

  if (has(policy.participants, me)) {
    if (policy.classification === "pastoral-private") {
      return decide("metadata", "Participation does not grant pastoral content", policy);
    }
    return stricterSections
      ? decide("limited", "You participate in this work; stricter sections stay closed", policy)
      : decide("full", "You participate in this work", policy);
  }

  switch (policy.classification) {
    // 1. Classification ceilings first — seniority cannot override them.
    case "pastoral-private":
      return decide(
        "denied",
        persona.capabilities.includes("administration")
          ? "Administration manages structure, not pastoral content"
          : "Pastoral content requires owner or explicit pastoral audience",
        policy,
      );

    case "leadership-confidential":
      if (inGroup) {
        return decide("full", "You are in the named leadership audience", policy);
      }
      return decide(
        "metadata",
        persona.capabilities.includes("cross-ministry-oversight")
          ? "Senior leadership does not imply confidential readership"
          : "Leadership confidential: explicit audience required",
        policy,
      );

    case "context-restricted":
      if (inGroup || (policy.ministryId && person.ministryIds.includes(policy.ministryId))) {
        return decide("full", "Ministry or team membership", policy);
      }
      if (
        sameCampus &&
        (persona.capabilities.includes("campus-oversight") ||
          persona.capabilities.includes("cross-ministry-oversight"))
      ) {
        return decide("limited", "Oversight scope: sensitive sections withheld", policy);
      }
      if (persona.capabilities.includes("administration")) {
        return decide("metadata", "Administrative capability grants metadata, not content", policy);
      }
      return decide("denied", "No applicable audience grant", policy);

    case "open":
    default:
      if (sameCampus) {
        return decide("full", "Open within your campus scope", policy);
      }
      return decide("limited", "Outside campus scope: summary only", policy);
  }
}

export function canOpen(decision: AccessDecision) {
  return decision.level === "full" || decision.level === "limited";
}

export const accessLabel: Record<AccessDecision["level"], string> = {
  full: "Full access",
  limited: "Limited access",
  metadata: "Metadata only",
  denied: "No access",
};
