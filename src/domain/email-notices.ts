import { escalationLabel, type EscalationType } from "./escalation";

/**
 * Notices by email: which of the bell's notices a leader also wants in their
 * inbox, and what such an email says.
 *
 * ## The rule
 *
 * The same two kinds the bell counts (`notices.ts`), and nothing else: an ask
 * somebody else made of you, and a meeting task somebody else gave you. A
 * report arriving, a date passing, work going overdue — none of these is an
 * email, for the same reason none of them is counted on the bell.
 *
 * Every kind is **off until the person turns it on**. Email leaves the binder;
 * that is a choice the recipient makes, not the church or the person asking.
 *
 * ## What an email carries
 *
 * What was asked or assigned, by whom, the date if there is one, and a link.
 * Never the record's content: the link opens the record, and opening it is
 * checked like any other request. A task from a meeting note the recipient may
 * not read does not name the meeting.
 *
 * ## Adding a kind
 *
 * Add it to `EMAIL_NOTICE_KINDS` and `emailNoticeKinds` (the switch on Account
 * & security appears by itself), compose its message here, and call the
 * notice mailer from the service that makes the write. The preference table
 * stores kinds as text, so no migration is needed.
 */

export const EMAIL_NOTICE_KINDS = ["ask", "meeting-task"] as const;

export type EmailNoticeKind = (typeof EMAIL_NOTICE_KINDS)[number];

export const emailNoticeKinds: Record<EmailNoticeKind, { label: string; description: string }> = {
  ask: {
    label: "When someone asks something of you",
    description: "An ask for attention, action or approval, made of you or a position you hold.",
  },
  "meeting-task": {
    label: "When someone gives you a meeting task",
    description: "A task from a meeting note somebody else keeps, assigned to you.",
  },
};

export type EmailNoticePreferences = Record<EmailNoticeKind, boolean>;

export const noEmailNotices = (): EmailNoticePreferences => ({ ask: false, "meeting-task": false });

export interface Link {
  to: string;
  search?: Record<string, string>;
}

/** An in-app route as an address somebody can open from their mail. */
export function absoluteLink(base: string, link: Link): string {
  const query = new URLSearchParams(link.search ?? {}).toString();
  return `${base.replace(/\/+$/, "")}${link.to}${query ? `?${query}` : ""}`;
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

const footer = (base: string) => [
  "",
  "—",
  "You receive this because you asked Oikonomia to email you about it.",
  `Change that under Account & security: ${absoluteLink(base, { to: "/account-security" })}`,
];

/** A calm date: "Tuesday 22 September 2026", or the stored text if it is not one. */
export function readableDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  /* Spelled out rather than `toLocaleDateString`, whose punctuation differs
     between the server's ICU builds. */
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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

export function askEmail(input: {
  base: string;
  askerName: string;
  type: EscalationType;
  request: string;
  neededBy?: string;
  link: Link;
}): ComposedEmail {
  const what = escalationLabel[input.type].toLowerCase();
  return {
    subject: `${input.askerName}: ${escalationLabel[input.type]}`,
    body: [
      `${input.askerName} asked something of you in Oikonomia (${what}).`,
      "",
      input.request,
      ...(input.neededBy ? ["", `Needed by ${readableDate(input.neededBy)}.`] : []),
      "",
      `Open it: ${absoluteLink(input.base, input.link)}`,
      ...footer(input.base),
    ].join("\n"),
  };
}

export function meetingTaskEmail(input: {
  base: string;
  assignerName: string;
  title: string;
  /** The meeting's title, only when the recipient may read the note. */
  meetingTitle?: string;
  dueDate?: string;
  link: Link;
}): ComposedEmail {
  return {
    subject: `${input.assignerName} gave you a task: ${input.title}`,
    body: [
      input.meetingTitle
        ? `${input.assignerName} gave you a task in "${input.meetingTitle}".`
        : `${input.assignerName} gave you a task from a meeting.`,
      "",
      input.title,
      ...(input.dueDate ? ["", `Due ${readableDate(input.dueDate)}.`] : []),
      "",
      `Open it: ${absoluteLink(input.base, input.link)}`,
      ...footer(input.base),
    ].join("\n"),
  };
}
