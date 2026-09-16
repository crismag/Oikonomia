/**
 * What Oikonomia says to people.
 *
 * Every recurring message the application shows, in one place, under a stable
 * key. Two reasons, and the second is the one that matters later:
 *
 * 1. The same event said three different things in three modules. "Saved",
 *    "Your changes have been saved" and "Report saved." are one message that
 *    drifted.
 * 2. **Keys are not English.** `reports.publish.success` survives translation,
 *    rewording by an administrator, and a change of tone across the product.
 *    Treating the sentence as the identifier would make all three a rewrite.
 *
 * ## Definition is not presentation
 *
 * A definition says *what is being communicated* — title, body, severity, the
 * labels on its buttons. Whether that arrives as a toast, an inline alert, a
 * dialog or a banner is the handler's decision, at the call site, where the
 * context is known. See `handlers.tsx`.
 *
 * ## What does not belong here
 *
 * Interface vocabulary — "Cancel", "Back", "Search" — is the design system's,
 * not the church's. Putting it here would make a configuration screen out of
 * a button. The rule is the same one the configuration platform uses: this
 * holds what the product *communicates*, not every literal it renders.
 */

export type Severity = "success" | "info" | "warning" | "error";

export interface MessageDefinition {
  /** One short line. What happened. */
  title: string;
  /** Optional second line. Why it matters, or what to do about it. */
  body?: string;
  severity: Severity;
  /** Confirmations only. */
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * The catalogue.
 *
 * Keys are `module.thing.outcome`. Parameters are `{named}` and are filled by
 * `message()`, which refuses to leave one unresolved — a sentence reading
 * "Report {title} was published" in front of a leader is worse than no
 * message.
 */
export const messages = {
  /* ------------------------------------------------------------- common */
  "common.save.success": { title: "Saved", severity: "success" },
  "common.save.error": {
    title: "That could not be saved",
    body: "Nothing is lost. Try again in a moment.",
    severity: "error",
  },
  "common.delete.confirm": {
    title: "Delete this?",
    body: "This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete",
    cancelLabel: "Keep it",
  },
  "common.delete.success": { title: "Deleted", severity: "success" },
  "common.load.error": {
    title: "That could not be loaded",
    body: "Nothing is lost. This is a problem reaching the server.",
    severity: "error",
  },
  "common.permission.denied": {
    title: "Not yours to do",
    body: "This belongs to somebody else. Ask them, or ask an administrator.",
    severity: "warning",
  },
  "common.notFound": {
    title: "Not here",
    body: "It may have been removed, or it may never have been yours to see.",
    severity: "info",
  },
  "common.unsaved.confirm": {
    title: "Leave without saving?",
    body: "What you have typed has not been written down yet.",
    severity: "warning",
    confirmLabel: "Leave",
    cancelLabel: "Stay",
  },

  /* ---------------------------------------------------------- lifegroup */
  "lifegroup.cancel.confirm": {
    title: "Cancel the gathering on {day}?",
    body: "It stays on the schedule marked Cancelled and stops asking anyone for a report. You can restore it.",
    severity: "warning",
    confirmLabel: "Cancel the gathering",
    cancelLabel: "Keep it",
  },

  /* ------------------------------------------------------------ reports */
  "reports.publish.success": {
    title: "Report published",
    body: "It is there for the people it is for. Nobody has to process it.",
    severity: "success",
  },
  "reports.delete.confirm": {
    title: "Delete “{title}”?",
    body: "The report and its discussion go with it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete the report",
    cancelLabel: "Keep it",
  },
  /* A report somebody never titled has no name to quote, and “Delete “”?” is
     not a sentence. */
  "reports.delete.confirm.untitled": {
    title: "Delete this report?",
    body: "The report and its discussion go with it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete the report",
    cancelLabel: "Keep it",
  },
  "documents.delete.confirm.untitled": {
    title: "Delete this document?",
    body: "The document and everything written in it go with it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete the document",
    cancelLabel: "Keep it",
  },
  "documents.delete.confirm": {
    title: "Delete “{title}”?",
    body: "The document and everything written in it go with it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete the document",
    cancelLabel: "Keep it",
  },
  /* Unfiling forgets one place, never the document. People reasonably fear
     "remove" means their Drive file goes too, so the dialog says it does not. */
  "documents.unfile.confirm": {
    title: "Unfile “{title}” from {place}?",
    body: "It will no longer be listed there. Nothing is deleted: the document stays wherever it is kept — in Google Drive or at its link — and stays filed anywhere else it is filed.",
    severity: "warning",
    confirmLabel: "Unfile it",
    cancelLabel: "Keep it here",
  },
  "journal.delete.confirm": {
    title: "Delete this journal entry?",
    body: "What you wrote here goes with it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Delete the entry",
    cancelLabel: "Keep it",
  },
  "reports.confidential.notice": {
    title: "Confidential",
    body: "Visible only to you and the people you add. Nobody else will see it, or see that it exists.",
    severity: "info",
  },

  /* ---------------------------------------------------------- escalation */
  "escalation.attention.sent": { title: "Leadership attention requested", severity: "success" },
  "escalation.action.sent": { title: "Action request sent", severity: "success" },
  "escalation.approval.sent": { title: "Approval request sent", severity: "success" },
  "escalation.action.completed": { title: "Action completed", severity: "success" },
  "escalation.approval.approved": { title: "Request approved", severity: "success" },
  "escalation.approval.declined": { title: "Request declined", severity: "info" },
  "escalation.clarification.requested": { title: "Clarification requested", severity: "info" },
  "escalation.withdraw.confirm": {
    title: "Withdraw this ask?",
    body: "It is taken back from the people it was sent to, with anything said on it. This cannot be undone.",
    severity: "warning",
    confirmLabel: "Withdraw the ask",
    cancelLabel: "Keep it",
  },
  "escalation.withdrawn": { title: "Ask withdrawn", severity: "info" },
  "escalation.answered": { title: "Answer sent", severity: "success" },

  /* ------------------------------------------------------- empty states */
  "empty.attention": { title: "Nothing currently needs your attention.", severity: "info" },
  "empty.actions": { title: "You have no action requests.", severity: "info" },
  "empty.approvals": { title: "No decisions are waiting for your approval.", severity: "info" },
  "empty.newReports": { title: "You're caught up. No new reports.", severity: "info" },
  "empty.reports": {
    title: "No reports yet.",
    body: "Reports you write from LifeGroups, ministries, meetings and other areas collect here.",
    severity: "info",
  },

  /* ---------------------------------------------------------- refusals */
  /*
   * Written once and used on the **server**, where the decision is actually
   * made. `src/config/messages` is pure data and functions — no React — so a
   * service may import it without dragging the interface across the boundary.
   *
   * A refusal a leader reads should say the same thing wherever it comes from.
   * These were written three times each, in slightly different words, which is
   * how a product ends up sounding like three products.
   */
  "refusal.ministry.write": {
    title: "Writing here is for the people who work in this ministry.",
    severity: "warning",
  },
  "refusal.form.owner": {
    title: "This form belongs to whoever designed it.",
    severity: "warning",
  },
  "refusal.entry.owner": {
    title: "This entry belongs to whoever wrote it.",
    severity: "warning",
  },
  "refusal.configuration.admin": {
    title: "Configuration is an administrator's to change.",
    severity: "warning",
  },
  "refusal.organization.admin": {
    title: "Only an administrator may change the organisation.",
    severity: "warning",
  },
  "refusal.organization.self": {
    title: "Nobody confirms their own place.",
    body: "Another administrator decides where you serve, lead or belong.",
    severity: "warning",
  },

  /*
   * Every refusal a service throws, by area. `src/server-refusals-catalogued.test.ts`
   * fails when a sentence is written inline at a throw site instead.
   */
  /* auth */
  "refusal.auth.accountDisabled": {
    title: "That account cannot be signed in to.",
    severity: "warning",
  },
  "refusal.auth.emailTaken": {
    title: "Somebody else is already using that email address.",
    severity: "warning",
  },
  "refusal.auth.endCurrentSession": {
    title: "Use Sign out to end the session you are using.",
    severity: "warning",
  },
  "refusal.auth.googleAccountUnknown": {
    title: "That Google account is not set up for this church. Ask an administrator to add you.",
    severity: "warning",
  },
  "refusal.auth.inviteAdmin": {
    title: "Inviting somebody is an administrator's to do.",
    severity: "warning",
  },
  "refusal.auth.inviteEmailMissing": {
    title: "Add an email address to their record first — it is where the invitation goes.",
    severity: "warning",
  },
  "refusal.auth.inviteListMissing": {
    title: "Send a list of email addresses.",
    severity: "warning",
  },
  "refusal.auth.inviteTooMany": {
    title: "Invite at most {max} people at a time.",
    severity: "warning",
  },
  "refusal.auth.linkExpired": {
    title: "That link is no longer valid. Ask for a new one.",
    severity: "warning",
  },
  "refusal.auth.nobodySignedIn": {
    title: "Nobody is signed in on this browser.",
    severity: "warning",
  },
  "refusal.auth.nothingToShow": {
    title: "Nobody is signed in on this browser, so there is nothing to show.",
    severity: "warning",
  },
  "refusal.auth.notSignedIn": { title: "You are not signed in.", severity: "warning" },
  "refusal.auth.passwordTooShort": {
    title: "Use at least 12 characters. A passphrase is easier and stronger.",
    severity: "warning",
  },
  "refusal.auth.personUnknown": { title: "There is no such person.", severity: "warning" },
  "refusal.auth.refused": { title: "Those details were not recognised.", severity: "warning" },
  "refusal.auth.sessionEnded": { title: "That session has already ended.", severity: "warning" },
  "refusal.auth.signInFirst": { title: "Sign in first.", severity: "warning" },
  "refusal.auth.throttled": {
    title: "Too many attempts. Wait a few minutes before trying again.",
    severity: "warning",
  },

  /* calendar */
  "refusal.calendar.dateMissing": {
    title: "File it on a day, or on the week.",
    severity: "warning",
  },
  "refusal.calendar.notYours": { title: "This entry is not yours to change.", severity: "warning" },
  "refusal.calendar.occurrenceToChange": {
    title: "Say which occurrence is being changed.",
    severity: "warning",
  },
  "refusal.calendar.occurrenceToRemove": {
    title: "Say which occurrence is being removed.",
    severity: "warning",
  },
  "refusal.calendar.relatedEntryGone": {
    title: "That entry no longer exists.",
    severity: "warning",
  },
  "refusal.calendar.repeats": { title: "This entry repeats.", severity: "warning" },

  /* common */
  "refusal.common.forbidden": {
    title: "You do not have permission to do that.",
    severity: "warning",
  },
  "refusal.common.internal": {
    title: "Something went wrong saving that. Please try again.",
    severity: "error",
  },
  "refusal.common.notFound": { title: "{what} could not be found.", severity: "warning" },
  "refusal.common.unauthenticated": { title: "Nobody is signed in.", severity: "warning" },
  "refusal.common.validation": { title: "Some details need fixing.", severity: "warning" },

  /* configuration */
  "refusal.configuration.accessStrategyMissing": {
    title: "Say how this audience is enforced.",
    severity: "warning",
  },
  "refusal.configuration.closedList": {
    title:
      "The values in this list are part of the product. You can rename them, and stop offering one, but a new value would be one nothing can use.",
    severity: "warning",
  },
  "refusal.configuration.labelEmpty": {
    title: "Use a name with letters or numbers in it.",
    severity: "warning",
  },
  "refusal.configuration.labelTaken": {
    title: "Something with that name is already on the list.",
    severity: "warning",
  },
  "refusal.configuration.lastAdministeringRole": {
    title:
      "At least one role has to be able to administer Oikonomia. Give another role that permission first.",
    severity: "warning",
  },
  "refusal.configuration.notASetting": {
    title: "That configuration is part of the product, not a setting.",
    severity: "warning",
  },
  "refusal.configuration.stageBehaviorsMissing": {
    title: "Say what this stage does.",
    severity: "warning",
  },

  /* continuity */
  "refusal.continuity.admin": {
    title: "Data management is an administrator's to do.",
    severity: "warning",
  },

  /* demo */
  "refusal.demo.full": {
    title:
      "The demo has as many visitors as it can take until it next refreshes. Choose one of the people above instead.",
    severity: "warning",
  },
  "refusal.demo.notADemo": {
    title: "This installation is not a demonstration.",
    severity: "warning",
  },

  /* document */
  "refusal.document.notABinderRecord": {
    title: "That is not a binder record.",
    severity: "warning",
  },
  "refusal.document.removeMinistry": {
    title: "Removing a document is for whoever added it or whoever leads this ministry.",
    severity: "warning",
  },
  "refusal.document.removeOwner": {
    title: "Only whoever registered this document can remove it.",
    severity: "warning",
  },
  "refusal.document.staleVersion": {
    title:
      "Someone else in this ministry changed this while you were writing. Reopen it to see what they wrote.",
    severity: "warning",
  },

  /* drive */
  "refusal.drive.fileMissing": { title: "Choose a file to upload.", severity: "warning" },
  "refusal.drive.googleAddressMissing": {
    title:
      "Oikonomia needs your church Google address (…@{domain}) on your person record before it can open Drive as you. An administrator can add it.",
    severity: "warning",
  },
  "refusal.drive.ministryFoldersMissing": {
    title:
      "Ministry folders are not set up on this installation. You can still choose a file from My Drive.",
    severity: "warning",
  },
  "refusal.drive.ministryMissing": { title: "Which ministry's folder?", severity: "warning" },
  "refusal.drive.notConnected": {
    title: "Google Drive is not connected on this installation.",
    severity: "warning",
  },

  /* escalation */
  "refusal.escalation.alreadyAnswered": {
    title: "This has already been answered, so it stays on the record.",
    severity: "warning",
  },
  "refusal.escalation.alreadyDecided": {
    title: "This has been decided. The decision stays on the record.",
    severity: "warning",
  },
  "refusal.escalation.answerIsAskers": {
    title: "Only whoever asked answers a question about it.",
    severity: "warning",
  },
  "refusal.escalation.declineReasonMissing": {
    title: "Say why, so the request can be reworked.",
    severity: "warning",
  },
  "refusal.escalation.forRecipient": {
    title: "This request is for the leader it was sent to.",
    severity: "warning",
  },
  "refusal.escalation.invalidTransition": {
    title: "This request cannot move there from where it stands.",
    severity: "warning",
  },
  "refusal.escalation.noQuestion": {
    title: "Nobody has asked a question about this.",
    severity: "warning",
  },
  "refusal.escalation.notApproval": {
    title: "Only an approval request is approved or declined.",
    severity: "warning",
  },
  "refusal.escalation.recipientMissing": {
    title: "Say who this is for, or it reaches nobody.",
    severity: "warning",
  },
  "refusal.escalation.withdrawIsAskers": {
    title: "Only whoever asked may withdraw a request.",
    severity: "warning",
  },

  /* export */
  "refusal.export.damaged": { title: "That export is damaged. Run it again.", severity: "warning" },
  "refusal.export.groupMissing": { title: "Say which group.", severity: "warning" },
  "refusal.export.groupNotYours": {
    title: "That group is not yours to export.",
    severity: "warning",
  },
  "refusal.export.ministryMissing": { title: "Say which ministry.", severity: "warning" },
  "refusal.export.ministryNotYours": {
    title: "That ministry is not yours to export.",
    severity: "warning",
  },
  "refusal.export.tooWide": { title: "That is wider than you may export.", severity: "warning" },
  "refusal.export.unknownScope": {
    title: "That is not something Oikonomia can export.",
    severity: "warning",
  },

  /* form */
  "refusal.form.recordComplete": {
    title: "This record is complete. Reopen it before changing an answer.",
    severity: "warning",
  },
  "refusal.form.retired": {
    title: "This form has been retired. Its records are kept, but no new ones can be started.",
    severity: "warning",
  },

  /* goal */
  "refusal.goal.alreadyComplete": { title: "That goal is already complete.", severity: "warning" },
  "refusal.goal.carryBackward": { title: "A goal carries forward, not back.", severity: "warning" },
  "refusal.goal.groupOnly": {
    title: "Only members of that group may set its goals.",
    severity: "warning",
  },
  "refusal.goal.ministryOnly": {
    title: "Only people who work in that ministry may set its goals.",
    severity: "warning",
  },
  "refusal.goal.otherGroup": {
    title: "This goal belongs to a group you are not in.",
    severity: "warning",
  },
  "refusal.goal.otherMinistry": {
    title: "This goal belongs to another ministry.",
    severity: "warning",
  },
  "refusal.goal.personal": {
    title: "This is another leader's personal goal.",
    severity: "warning",
  },

  /* googleCalendar */
  "refusal.googleCalendar.admin": {
    title: "Publishing the church calendar is an administrator's to manage.",
    severity: "warning",
  },
  "refusal.googleCalendar.notConfigured": {
    title: "No church calendar is set. Set OIKONOMIA_GOOGLE_CALENDAR_ID on the server first.",
    severity: "warning",
  },

  /* googleWorkspace */
  "refusal.googleWorkspace.addressNotInDomain": {
    title: "That address is not a Google Workspace account in this church's domain.",
    severity: "warning",
  },
  "refusal.googleWorkspace.admin": {
    title: "Google Workspace is an administrator's to set up.",
    severity: "warning",
  },
  "refusal.googleWorkspace.delegationRefused": {
    title:
      "Google Workspace refused access. An administrator should check the service account's domain-wide delegation and scopes.",
    severity: "warning",
  },
  "refusal.googleWorkspace.notAllowed": {
    title: "Google did not allow that for this account.",
    severity: "warning",
  },
  "refusal.googleWorkspace.unreachable": {
    title: "Google could not be reached just now. Try again.",
    severity: "error",
  },

  /* journal */
  "refusal.journal.blocksNotInEntry": {
    title: "Those lines are not in this entry.",
    severity: "warning",
  },
  "refusal.journal.movedOn": {
    title: "This entry moved on. Reopen it to see the current version.",
    severity: "warning",
  },
  "refusal.journal.staleVersion": {
    title:
      "This entry was changed in another tab while you were writing. Reopen it to see the current version.",
    severity: "warning",
  },

  /* leadershipReport */
  "refusal.leadershipReport.accessIsAuthors": {
    title: "Who may read this report is the author's to set.",
    severity: "warning",
  },
  "refusal.leadershipReport.changeIsAuthors": {
    title: "This report is its author's to change.",
    severity: "warning",
  },
  "refusal.leadershipReport.noSubject": {
    title:
      "This kind of report is not written about a named person. Say who it concerns in the report itself.",
    severity: "warning",
  },
  "refusal.leadershipReport.notOpenForDiscussion": {
    title: "This report is not open for discussion.",
    severity: "warning",
  },
  "refusal.leadershipReport.owner": {
    title: "A report belongs to whoever wrote it.",
    severity: "warning",
  },
  "refusal.leadershipReport.staleVersion": {
    title:
      "This report was changed somewhere else while you were working. Reopen it to see the current version.",
    severity: "warning",
  },
  "refusal.leadershipReport.submittedArchive": {
    title: "This report has been submitted. Archive it rather than removing the record.",
    severity: "warning",
  },
  "refusal.leadershipReport.submittedReopen": {
    title: "This report has been submitted. Reopen it to make changes.",
    severity: "warning",
  },
  "refusal.leadershipReport.submittedReopenBeforeChanging": {
    title: "This report has been submitted. Reopen it before changing what it says.",
    severity: "warning",
  },
  "refusal.leadershipReport.writeIsAuthors": {
    title: "This report is its author's to write.",
    severity: "warning",
  },

  /* lifegroup */
  "refusal.lifegroup.alreadyCancelled": {
    title: "This gathering is already cancelled.",
    severity: "warning",
  },
  "refusal.lifegroup.alreadyLed": {
    title: "Someone is already leading this. You can add yourself instead.",
    severity: "warning",
  },
  "refusal.lifegroup.alreadyOnGathering": {
    title: "You are already on this gathering.",
    severity: "warning",
  },
  "refusal.lifegroup.attendeeNameMissing": { title: "Say who came.", severity: "warning" },
  "refusal.lifegroup.cancelled": { title: "This gathering was cancelled.", severity: "warning" },
  "refusal.lifegroup.cancelWrittenUp": {
    title: "This gathering has been written up. Reopen the report before cancelling it.",
    severity: "warning",
  },
  "refusal.lifegroup.coLeadersCampus": {
    title: "Who else leads this is a campus responsibility. You can add or remove yourself.",
    severity: "warning",
  },
  "refusal.lifegroup.leadersWrittenUp": {
    title: "This gathering has been written up. Who led it is part of the record.",
    severity: "warning",
  },
  "refusal.lifegroup.notCancelled": {
    title: "This gathering is not cancelled.",
    severity: "warning",
  },
  "refusal.lifegroup.notOnGathering": {
    title: "You are not on this gathering.",
    severity: "warning",
  },
  "refusal.lifegroup.notYoursToCancel": {
    title: "This gathering is not yours to cancel.",
    severity: "warning",
  },
  "refusal.lifegroup.notYoursToChange": {
    title: "This gathering is not yours to change.",
    severity: "warning",
  },
  "refusal.lifegroup.notYoursToRestore": {
    title: "This gathering is not yours to restore.",
    severity: "warning",
  },
  "refusal.lifegroup.personUnknown": {
    title: "That person is not in People.",
    severity: "warning",
  },
  "refusal.lifegroup.readersMissing": {
    title: "Name at least one person who may read this.",
    severity: "warning",
  },
  "refusal.lifegroup.readerUnknown": {
    title: "Somebody named here is not in People.",
    severity: "warning",
  },
  "refusal.lifegroup.recordCancelled": {
    title: "This gathering was cancelled. Restore it before recording it.",
    severity: "warning",
  },
  "refusal.lifegroup.recordNotAssigned": {
    title: "Only a leader assigned to this gathering can record it.",
    severity: "warning",
  },
  "refusal.lifegroup.stageHasOwnAction": {
    title: "That change of stage has its own action on the gathering.",
    severity: "warning",
  },

  /* meeting */
  "refusal.meeting.owner": { title: "This note belongs to whoever wrote it.", severity: "warning" },
  "refusal.meeting.staleVersion": {
    title:
      "This note was changed somewhere else while you were writing. Reopen it to see the current version.",
    severity: "warning",
  },

  /* ministry */
  "refusal.ministry.unknown": { title: "That ministry does not exist.", severity: "warning" },

  /* onboarding */
  "refusal.onboarding.nameIsAdministrators": {
    title: "Your name is on the church's record. An administrator changes it.",
    severity: "warning",
  },
  "refusal.onboarding.nameMissing": {
    title: "Give the name people call you — first and last.",
    severity: "warning",
  },
  "refusal.onboarding.unknownStep": { title: "That is not one of the steps.", severity: "warning" },

  /* organization */
  "refusal.organization.alreadySetUp": {
    title: "Oikonomia has already been set up. Sign in instead.",
    severity: "warning",
  },
  "refusal.organization.emailTaken": {
    title: "Somebody is already using that email address.",
    severity: "warning",
  },
  "refusal.organization.groupInactive": {
    title: "That group is no longer active.",
    severity: "warning",
  },
  "refusal.organization.groupUnderItself": {
    title: "A group cannot sit under itself.",
    severity: "warning",
  },
  "refusal.organization.lastAdministrator": {
    title:
      "Somebody has to be able to administer Oikonomia. Give another person an administering role first.",
    severity: "warning",
  },
  "refusal.organization.ministryInactive": {
    title: "That ministry is no longer running.",
    severity: "warning",
  },
  "refusal.organization.reportsToSelf": {
    title: "Somebody cannot report to themselves. Leave it unset if there is nobody.",
    severity: "warning",
  },

  /* reachOut */
  "refusal.reachOut.commentOwner": {
    title: "A comment belongs to whoever wrote it.",
    severity: "warning",
  },
  "refusal.reachOut.removeIsAuthors": {
    title: "Only whoever started this report can remove it.",
    severity: "warning",
  },
  "refusal.reachOut.staleVersion": {
    title:
      "Another leader added to this report while you were writing. Reopen it to see what they wrote.",
    severity: "warning",
  },

  /* request */
  "refusal.request.invalidJson": {
    title: "The request body was not valid JSON.",
    severity: "warning",
  },
  "refusal.request.sortUnknown": { title: "Sort must be one of: {names}.", severity: "warning" },

  /* work */
  "refusal.work.changesNoteMissing": { title: "Say what needs changing.", severity: "warning" },
  "refusal.work.closeIsOwnersOrReviewers": {
    title: "Closing this is for whoever opened it or reviews it.",
    severity: "warning",
  },
  "refusal.work.decideIsReviewers": {
    title: "Deciding this is for the leaders it was sent to.",
    severity: "warning",
  },
  "refusal.work.decisionRequestIsOwnersOrReviewers": {
    title: "Asking for a decision here is for its owner or its reviewers.",
    severity: "warning",
  },
  "refusal.work.informationOnly": {
    title:
      "This is information, not a submission for review. Comment on it, or create an action from it.",
    severity: "warning",
  },
  "refusal.work.invalidTransition": {
    title: "This cannot be {action} from where it currently stands.",
    severity: "warning",
  },
  "refusal.work.reopenIsOwnersOrReviewers": {
    title: "Reopening this is for whoever opened it or reviews it.",
    severity: "warning",
  },
  "refusal.work.reviewIsReviewers": {
    title: "Reviewing this is for the leaders it was sent to.",
    severity: "warning",
  },
  "refusal.work.staleVersion": {
    title: "This moved on while you were looking at it. Reopen it to see where it stands now.",
    severity: "warning",
  },
  "refusal.work.submitIsOwners": {
    title: "Submitting this is for whoever opened it.",
    severity: "warning",
  },
  "demo.reset.soon": {
    title: "The demo refreshes in about {minutes} minutes.",
    body: "Changes made in the demo will be reset then.",
    severity: "warning",
  },
  "refusal.installation.disabled": {
    title: "This action is disabled in this installation.",
    body: "It is turned off here for everyone, administrators included.",
    severity: "info",
  },

  /* ------------------------------------------------------ configuration */
  "common.reset.confirm": {
    title: "Reset “{label}” to its default?",
    body: "The wording Oikonomia ships with comes back, and future improvements to it reach you again.",
    severity: "warning",
    confirmLabel: "Reset it",
    cancelLabel: "Keep mine",
  },
  "configuration.deactivate.confirm": {
    title: "Make “{label}” unavailable for new records?",
    body: "Records already using it keep their wording and stay readable; nobody will be able to choose it for something new.",
    severity: "warning",
    confirmLabel: "Deactivate it",
    cancelLabel: "Leave it",
  },

  /* --------------------------------------------------------------- auth */
  "auth.signedOut": { title: "Signed out", severity: "info" },
} as const satisfies Record<string, MessageDefinition>;

export type MessageKey = keyof typeof messages;

const PARAMETER = /\{(\w+)\}/g;

/**
 * Fill a message's parameters.
 *
 * An unresolved `{title}` reaching a leader is a bug that looks like a typo,
 * so this throws in development and leaves the placeholder alone in
 * production — a rough sentence is better than a blank screen.
 */
function fill(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(PARAMETER, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      if (import.meta.env?.DEV) {
        throw new Error(`Message parameter "${name}" was not supplied for "${text}".`);
      }
      return whole;
    }
    return String(value);
  });
}

/**
 * One message, resolved.
 *
 * An unknown key returns a definition carrying the key itself rather than
 * throwing: a missing message must never take down the screen it was supposed
 * to explain, and the key on screen says exactly what is missing.
 */
export function message(
  key: MessageKey | string,
  values?: Record<string, string | number>,
): MessageDefinition {
  const found = (messages as Record<string, MessageDefinition>)[key];
  if (!found) {
    if (import.meta.env?.DEV) {
      console.error(`No message is defined for "${key}".`);
    }
    return { title: key, severity: "info" };
  }

  return {
    ...found,
    title: fill(found.title, values),
    ...(found.body ? { body: fill(found.body, values) } : {}),
  };
}

/** Just the sentence, for the places that render one line. */
export const text = (key: MessageKey | string, values?: Record<string, string | number>): string =>
  message(key, values).title;
