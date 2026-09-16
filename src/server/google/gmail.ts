import type { DeliveryAdapter } from "../auth/delivery";
import { googleRequest, WORKSPACE_SCOPES, type WorkspaceConfig } from "./workspace";

/**
 * System mail through Gmail, as the church's application mailbox.
 *
 * ## Why this exists beside SMTP
 *
 * A church on Google Workspace that has set up delegation for Drive and
 * Calendar already has everything needed to send mail: no app password, no
 * relay, nothing more to configure. Messages leave from the church mailbox
 * (`OIKONOMIA_GOOGLE_APP_USER`), so they sit in its Sent folder where the
 * office can see what Oikonomia said on the church's behalf.
 *
 * ## What is built here
 *
 * Only the RFC 2822 message. The Gmail API takes it whole, base64url encoded,
 * and fills in Date and Message-ID itself. Headers are where mail is attacked:
 * a line break in a subject or an address is a new header, so both are
 * refused or flattened before they are written, and anything non-ASCII in the
 * subject is encoded rather than trusted to arrive intact.
 */

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface OutgoingMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
}

const base64url = (input: Buffer) =>
  input.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** One header line's worth of text: no CR or LF can survive into a header. */
const flatten = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/**
 * A subject that arrives as written.
 *
 * Plain ASCII goes as is; anything else becomes RFC 2047 encoded-words, split
 * so no encoded-word exceeds the 75-character limit and no UTF-8 character is
 * cut in half between two of them.
 */
export function encodeSubject(subject: string): string {
  const text = flatten(subject);
  if (/^[\x20-\x7e]*$/.test(text)) return text;

  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    /* 45 bytes of UTF-8 is 60 characters of base64, inside the limit with
       the `=?UTF-8?B?` and `?=` wrapping. */
    if (Buffer.byteLength(chunk + char, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

/** An address fit for a header, or a refusal. Never a header split in two. */
function address(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n<>,;]/.test(trimmed) || !trimmed.includes("@")) {
    throw new Error("That is not an email address Oikonomia will write into a message.");
  }
  return trimmed;
}

/** The whole message, as Gmail's `raw` field expects it. */
export function rawMessage(message: OutgoingMessage): string {
  /* Base64 body in 76-character lines: UTF-8 survives every relay unchanged. */
  const body = Buffer.from(message.body, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, (line) => `${line}\r\n`);

  const lines = [
    `From: Oikonomia <${address(message.from)}>`,
    `To: ${address(message.to)}`,
    `Subject: ${encodeSubject(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return base64url(Buffer.from(lines.join("\r\n"), "utf8"));
}

export class GmailDelivery implements DeliveryAdapter {
  readonly id = "gmail";
  readonly reachesRecipients = true;

  constructor(private readonly config: WorkspaceConfig) {}

  async send(message: { to: string; subject: string; body: string }): Promise<void> {
    await googleRequest(this.config, {
      subject: this.config.appUser,
      scopes: [WORKSPACE_SCOPES.gmailSend],
      method: "POST",
      url: SEND_URL,
      json: { raw: rawMessage({ ...message, from: this.config.appUser }) },
    });
  }
}
