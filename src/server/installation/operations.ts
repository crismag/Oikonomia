/**
 * Every server function, and what an installation policy may do about it.
 *
 * ## Why every one is listed
 *
 * A public demonstration is a writable Oikonomia anybody can reach. The
 * dangerous operation is not one somebody decided to allow; it is one nobody
 * decided about — a server function added next year that changes an account,
 * which a demonstration would then expose by default. So:
 *
 * - every server function has an entry here, and
 *   `src/installation-policy-classified.test.ts` fails when one does not;
 * - a POST with no entry is refused while Demo Mode is on regardless, because
 *   this table — not the test — is what decides at runtime;
 * - the key is `filename#name`, exactly as TanStack Start reports it in
 *   `serverFnMeta`, because names alone repeat (`fetchSession` is two
 *   different functions).
 *
 * ## What the values mean
 *
 * - `read`: a GET that changes nothing. Available.
 * - `allowed`: a write a demonstration keeps — church work, the organisation's
 *   own structure, memberships and assignments, onboarding, signing this
 *   browser out. Still subject to every ordinary authorization check.
 * - `denied`: refused while Demo Mode is on, administrators included, for the
 *   stated reason:
 *   - `authentication` — credentials, sign-in, invitations, first-run claims;
 *   - `sessions` — ending *other* sessions, which on a shared demonstration
 *     identity signs out everybody else using it;
 *   - `identity` — creating or changing a person, whose record carries email,
 *     access role and active state (`updatePerson` cannot yet change one
 *     without being able to change the others);
 *   - `configuration` — the installation's vocabulary, roles and capabilities;
 *   - `data` — backups, exports, retention and package checks: copies of
 *     everything, and files on the server's disk;
 *   - `integrations` — anything that reaches Google Workspace: a
 *     demonstration never acts as a real church's accounts.
 *
 * This says nothing about *who* may do something; services still decide that.
 * It only removes operations from an installation altogether.
 */

import type { InstallationRestriction } from "@/domain/installation";

export type DemoPolicy = "read" | "allowed" | "denied";

/** Named once, in the domain, because the browser is told them too. */
export type DenialReason = InstallationRestriction;

export interface ServerFunctionPolicy {
  /** As declared in source; the classification test holds the two together. */
  method: "GET" | "POST";
  demo: DemoPolicy;
  because?: DenialReason;
}

export const SERVER_FUNCTIONS: Readonly<Record<string, ServerFunctionPolicy>> = {
  /* auth-api.ts */
  "src/lib/auth-api.ts#fetchSession": { method: "GET", demo: "read" },
  "src/lib/auth-api.ts#signInWithPassword": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#requestMagicLink": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#signInWithMagicLink": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#requestPasswordReset": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#resetPassword": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#claimFirstAccount": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#signOut": { method: "POST", demo: "allowed" },
  "src/lib/auth-api.ts#changePassword": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#fetchAccountOverview": { method: "GET", demo: "read" },
  "src/lib/auth-api.ts#signOutSession": { method: "POST", demo: "denied", because: "sessions" },
  "src/lib/auth-api.ts#signOutOtherSessions": {
    method: "POST",
    demo: "denied",
    because: "sessions",
  },
  "src/lib/auth-api.ts#inviteToOikonomia": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },
  "src/lib/auth-api.ts#inviteManyToOikonomia": {
    method: "POST",
    demo: "denied",
    because: "authentication",
  },

  /* workspace-api.ts */
  "src/lib/workspace-api.ts#fetchWorkspaceStatus": { method: "GET", demo: "read" },
  "src/lib/workspace-api.ts#checkWorkspaceConnection": {
    method: "POST",
    demo: "denied",
    because: "integrations",
  },

  /* calendar-api.ts */
  "src/lib/calendar-api.ts#fetchCalendarRange": { method: "GET", demo: "read" },
  "src/lib/calendar-api.ts#createCalendarEntry": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#updateCalendarEntry": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#deleteCalendarEntry": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#duplicateCalendarEntry": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#createAgendaItem": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#updateAgendaItem": { method: "POST", demo: "allowed" },
  "src/lib/calendar-api.ts#deleteAgendaItem": { method: "POST", demo: "allowed" },

  /* configuration-api.ts */
  "src/lib/configuration-api.ts#fetchConfiguration": { method: "GET", demo: "read" },
  "src/lib/configuration-api.ts#fetchConfigurationAdmin": { method: "GET", demo: "read" },
  "src/lib/configuration-api.ts#addConfigurationOption": {
    method: "POST",
    demo: "denied",
    because: "configuration",
  },
  "src/lib/configuration-api.ts#setConfigurationOption": {
    method: "POST",
    demo: "denied",
    because: "configuration",
  },
  "src/lib/configuration-api.ts#setConfigurationValue": {
    method: "POST",
    demo: "denied",
    because: "configuration",
  },
  "src/lib/configuration-api.ts#resetConfiguration": {
    method: "POST",
    demo: "denied",
    because: "configuration",
  },
  "src/lib/configuration-api.ts#fetchConfigurationHistory": { method: "GET", demo: "read" },

  /* dashboard-api.ts */
  "src/lib/dashboard-api.ts#fetchDashboard": { method: "GET", demo: "read" },

  /* data-management-api.ts */
  "src/lib/data-management-api.ts#runExport": { method: "POST", demo: "denied", because: "data" },
  "src/lib/data-management-api.ts#downloadExport": {
    method: "GET",
    demo: "denied",
    because: "data",
  },
  "src/lib/data-management-api.ts#fetchDataJobs": { method: "GET", demo: "read" },
  "src/lib/data-management-api.ts#fetchContinuity": { method: "GET", demo: "read" },
  "src/lib/data-management-api.ts#runBackup": { method: "POST", demo: "denied", because: "data" },
  "src/lib/data-management-api.ts#verifyBackup": {
    method: "POST",
    demo: "denied",
    because: "data",
  },
  "src/lib/data-management-api.ts#validatePackage": {
    method: "POST",
    demo: "denied",
    because: "data",
  },
  "src/lib/data-management-api.ts#runRetention": {
    method: "POST",
    demo: "denied",
    because: "data",
  },
  "src/lib/data-management-api.ts#setRetentionPolicy": {
    method: "POST",
    demo: "denied",
    because: "data",
  },
  "src/lib/data-management-api.ts#fetchDataAudit": { method: "GET", demo: "read" },

  /* demo-api.ts — the demonstration's own entrance. Allowed here because a
     demonstration is what they exist for; on an ordinary installation the
     policy steps aside and the entry service refuses them itself. */
  "src/lib/demo-api.ts#fetchDemoEntry": { method: "GET", demo: "read" },
  "src/lib/demo-api.ts#enterDemoAs": { method: "POST", demo: "allowed" },
  "src/lib/demo-api.ts#createDemoVisitor": { method: "POST", demo: "allowed" },

  /* documents-api.ts */
  "src/lib/documents-api.ts#searchDocuments": { method: "GET", demo: "read" },
  "src/lib/documents-api.ts#fetchDocumentFilters": { method: "GET", demo: "read" },
  "src/lib/documents-api.ts#fetchFiledDocuments": { method: "GET", demo: "read" },
  "src/lib/documents-api.ts#fetchDocument": { method: "GET", demo: "read" },
  "src/lib/documents-api.ts#registerDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#updateDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#fileDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#unfileDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#createBinderDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#fetchBinderDocument": { method: "GET", demo: "read" },
  "src/lib/documents-api.ts#saveBinderDocument": { method: "POST", demo: "allowed" },
  "src/lib/documents-api.ts#removeDocument": { method: "POST", demo: "allowed" },

  /* escalation-api.ts */
  "src/lib/escalation-api.ts#fetchInbox": { method: "GET", demo: "read" },
  "src/lib/escalation-api.ts#fetchEscalationsFor": { method: "GET", demo: "read" },
  "src/lib/escalation-api.ts#raiseEscalation": { method: "POST", demo: "allowed" },
  "src/lib/escalation-api.ts#moveEscalation": { method: "POST", demo: "allowed" },
  "src/lib/escalation-api.ts#withdrawEscalation": { method: "POST", demo: "allowed" },
  "src/lib/escalation-api.ts#replyToEscalation": { method: "POST", demo: "allowed" },
  "src/lib/escalation-api.ts#fetchMyRoles": { method: "GET", demo: "read" },
  "src/lib/escalation-api.ts#fetchReadState": { method: "GET", demo: "read" },
  "src/lib/escalation-api.ts#markRead": { method: "POST", demo: "allowed" },
  "src/lib/escalation-api.ts#markSeen": { method: "POST", demo: "allowed" },

  /* forms-api.ts */
  "src/lib/forms-api.ts#fetchForms": { method: "GET", demo: "read" },
  "src/lib/forms-api.ts#createFormDefinition": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#saveFormDefinition": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#renameFormDefinition": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#copyFormDefinition": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#deleteFormDefinition": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#createFormRecord": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#setFormResponse": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#completeFormRecord": { method: "POST", demo: "allowed" },
  "src/lib/forms-api.ts#reopenFormRecord": { method: "POST", demo: "allowed" },

  /* goals-api.ts */
  "src/lib/goals-api.ts#fetchGoalYear": { method: "GET", demo: "read" },
  "src/lib/goals-api.ts#createGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#updateGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#deleteGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#addGoalUpdate": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#completeGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#holdGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#resumeGoal": { method: "POST", demo: "allowed" },
  "src/lib/goals-api.ts#carryGoalForward": { method: "POST", demo: "allowed" },

  /* journal-api.ts */
  "src/lib/journal-api.ts#fetchJournal": { method: "GET", demo: "read" },
  "src/lib/journal-api.ts#fetchEntry": { method: "GET", demo: "read" },
  "src/lib/journal-api.ts#createEntry": { method: "POST", demo: "allowed" },
  "src/lib/journal-api.ts#writeEntry": { method: "POST", demo: "allowed" },
  "src/lib/journal-api.ts#renameEntry": { method: "POST", demo: "allowed" },
  "src/lib/journal-api.ts#removeEntry": { method: "POST", demo: "allowed" },
  "src/lib/journal-api.ts#summarizeEntry": { method: "POST", demo: "allowed" },

  /* lifegroup-api.ts */
  "src/lib/lifegroup-api.ts#fetchLifegroup": { method: "GET", demo: "read" },
  "src/lib/lifegroup-api.ts#createGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#joinGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#updateGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#cancelGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#restoreGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#markAttendance": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#removeAttendance": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#setExhortation": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#setSummary": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#completeGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#reopenGathering": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#addEntry": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#updateEntry": { method: "POST", demo: "allowed" },
  "src/lib/lifegroup-api.ts#removeEntry": { method: "POST", demo: "allowed" },

  /* meeting-api.ts */
  "src/lib/meeting-api.ts#fetchNotes": { method: "GET", demo: "read" },
  "src/lib/meeting-api.ts#fetchNote": { method: "GET", demo: "read" },
  "src/lib/meeting-api.ts#createNote": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#updateNote": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#deleteNote": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#createMeetingTask": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#updateMeetingTask": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#deleteMeetingTask": { method: "POST", demo: "allowed" },
  "src/lib/meeting-api.ts#fetchMyTasks": { method: "GET", demo: "read" },

  /* onboarding-api.ts */
  "src/lib/onboarding-api.ts#fetchOnboarding": { method: "GET", demo: "read" },
  "src/lib/onboarding-api.ts#startOnboarding": { method: "POST", demo: "allowed" },
  "src/lib/onboarding-api.ts#moveOnboarding": { method: "POST", demo: "allowed" },
  "src/lib/onboarding-api.ts#completeOnboarding": { method: "POST", demo: "allowed" },
  "src/lib/onboarding-api.ts#giveOwnName": { method: "POST", demo: "denied", because: "identity" },

  /* organization-api.ts */
  "src/lib/organization-api.ts#fetchSession": { method: "GET", demo: "read" },
  "src/lib/organization-api.ts#claimFirstPerson": {
    method: "POST",
    demo: "denied",
    because: "identity",
  },
  "src/lib/organization-api.ts#addCampus": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#addPerson": { method: "POST", demo: "denied", because: "identity" },
  "src/lib/organization-api.ts#updatePerson": {
    method: "POST",
    demo: "denied",
    because: "identity",
  },
  "src/lib/organization-api.ts#addMinistry": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#updateMinistry": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#setMembership": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#addVenue": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#addGroup": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#updateGroup": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#setGroupMembership": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#fetchAssignments": { method: "GET", demo: "read" },
  "src/lib/organization-api.ts#setAssignment": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#claimAssignment": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#requestAssignmentCorrection": { method: "POST", demo: "allowed" },
  "src/lib/organization-api.ts#fetchAssignmentsAwaitingDecision": { method: "GET", demo: "read" },
  "src/lib/organization-api.ts#fetchChurchSetup": { method: "GET", demo: "read" },

  /* reach-out-api.ts */
  "src/lib/reach-out-api.ts#fetchReachOut": { method: "GET", demo: "read" },
  "src/lib/reach-out-api.ts#fetchReachOutReport": { method: "GET", demo: "read" },
  "src/lib/reach-out-api.ts#createReachOutReport": { method: "POST", demo: "allowed" },
  "src/lib/reach-out-api.ts#updateReachOutReport": { method: "POST", demo: "allowed" },
  "src/lib/reach-out-api.ts#deleteReachOutReport": { method: "POST", demo: "allowed" },
  "src/lib/reach-out-api.ts#addReachOutComment": { method: "POST", demo: "allowed" },

  /* reports-api.ts */
  "src/lib/reports-api.ts#fetchReports": { method: "GET", demo: "read" },
  "src/lib/reports-api.ts#fetchReport": { method: "GET", demo: "read" },
  "src/lib/reports-api.ts#fetchConfidentialReads": { method: "GET", demo: "read" },
  "src/lib/reports-api.ts#createReport": { method: "POST", demo: "allowed" },
  "src/lib/reports-api.ts#updateReport": { method: "POST", demo: "allowed" },
  "src/lib/reports-api.ts#writeReport": { method: "POST", demo: "allowed" },
  "src/lib/reports-api.ts#transitionReport": { method: "POST", demo: "allowed" },
  "src/lib/reports-api.ts#commentOnReport": { method: "POST", demo: "allowed" },
  "src/lib/reports-api.ts#removeReport": { method: "POST", demo: "allowed" },

  /* notice-email-api.ts */
  "src/lib/notice-email-api.ts#fetchEmailNotices": { method: "GET", demo: "read" },
  /*
   * Allowed: it records a person's own preference and sends nothing. On a
   * demonstration `delivery()` is suppressed before any adapter, so a switch
   * turned on there reaches nobody — and the page says mail cannot be sent.
   */
  "src/lib/notice-email-api.ts#setEmailNotice": { method: "POST", demo: "allowed" },

  /* starred-api.ts */
  "src/lib/starred-api.ts#fetchStarred": { method: "GET", demo: "read" },
  "src/lib/starred-api.ts#setStarred": { method: "POST", demo: "allowed" },

  /* team-overview-api.ts */
  "src/lib/team-overview-api.ts#fetchTeamOverview": { method: "GET", demo: "read" },

  /* work-api.ts */
  "src/lib/work-api.ts#fetchWorkList": { method: "GET", demo: "read" },
  "src/lib/work-api.ts#fetchWork": { method: "GET", demo: "read" },
  "src/lib/work-api.ts#transitionWork": { method: "POST", demo: "allowed" },
  "src/lib/work-api.ts#commentOnWork": { method: "POST", demo: "allowed" },
  "src/lib/work-api.ts#requestWorkDecision": { method: "POST", demo: "allowed" },
  "src/lib/work-api.ts#recordWorkDecision": { method: "POST", demo: "allowed" },
};
