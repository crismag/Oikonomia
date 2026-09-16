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
