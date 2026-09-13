/**
 * Getting a sign-in link to somebody.
 *
 * ## The boundary, and why it is one
 *
 * Authentication should not know how mail is sent. The provider a church uses
 * is a deployment decision, and binding a login flow to one would mean
 * rewriting the login flow to change it.
 *
 * ## What exists today
 *
 * Two adapters, and which one is in force is a deployment decision rather than
 * a code one.
 *
 * **SMTP**, when `OIKONOMIA_SMTP_HOST` and `OIKONOMIA_MAIL_FROM` are set.
 * Every church already has SMTP — a Google Workspace account, an Exchange
 * server, a transactional provider — where picking one vendor's HTTP API would
 * have left the others unable to use magic links at all.
 *
 * **The console**, otherwise, which writes the link where a developer can see
 * it. Genuinely useful and genuinely not production: nothing reaches anybody
 * who is not reading the server log.
 *
 * The consequence is stated rather than hidden. `canDeliver()` is false with
 * the console adapter, and the sign-in screen removes the controls that end in
 * an email and says why. Configuring SMTP turns them back on by itself; no
 * code decides that twice.
 */

import { currentInstallation } from "../installation/policy";
import { siteUrl } from "./site-url";
import { SmtpDelivery, smtpSettings } from "./smtp";

export interface DeliveryAdapter {
  readonly id: string;
  /** Whether a message sent through this reaches somebody who is not us. */
  readonly reachesRecipients: boolean;
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

/**
 * Writes the message to the server's own output — in development.
 *
 * A link printed in a log is a credential sitting in a log. For a developer
 * that is the point: it is how they sign in without a mail server. In a
 * production build it is a way into somebody's account for anyone who can read
 * the log, and on a public installation anyone can ask for a link to be
 * issued. So a production process says that a message was not sent, and never
 * what it said or who it was for.
 */
export class ConsoleDelivery implements DeliveryAdapter {
  readonly id = "console";
  readonly reachesRecipients = false;

  send(message: { to: string; subject: string; body: string }): Promise<void> {
    if (process.env["NODE_ENV"] === "production") {
      console.warn(`Oikonomia did not send "${message.subject}": no mail provider is configured.`);
      return Promise.resolve();
    }

    console.info(
      [
        "",
        "┌─ Oikonomia · development mail ───────────────────────────────",
        `│ To:      ${message.to}`,
        `│ Subject: ${message.subject}`,
        "│",
        ...message.body.split("\n").map((line) => `│ ${line}`),
        "│",
        "│ No mail provider is configured, so this was not sent anywhere.",
        "└──────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return Promise.resolve();
  }
}

/**
 * Delivery an installation policy has switched off.
 *
 * Sends nothing and prints nothing about the message: not who it was for, what
 * it said, or the link inside it. On a public demonstration anybody can cause
 * a message to be composed, and the log is not the place for it to go instead.
 */
export class SuppressedDelivery implements DeliveryAdapter {
  readonly id = "suppressed";
  readonly reachesRecipients = false;

  send(): Promise<void> {
    console.warn("Email delivery suppressed by installation policy.");
    return Promise.resolve();
  }
}

const suppressed = new SuppressedDelivery();

let adapter: DeliveryAdapter | undefined;

/**
 * The adapter this installation actually has.
 *
 * Chosen from configuration on first use rather than at module load, so a
 * process that sets its own environment — a test, a script — is not stuck with
 * a decision made before it ran. SMTP when it is configured; the console
 * otherwise, which says on screen that nothing was sent.
 *
 * **Demo Mode comes first, and is asked every time.** The operations that send
 * mail are already refused before they run, but this is where mail actually
 * leaves, so it refuses too — ahead of SMTP settings, and ahead of any adapter
 * installed with `useDelivery()`. A path added later that reaches delivery
 * without passing the operation policy still sends nothing.
 */
export function delivery(): DeliveryAdapter {
  if (currentInstallation().demoMode) return suppressed;
  if (adapter) return adapter;

  const settings = smtpSettings();
  adapter = settings ? new SmtpDelivery(settings) : new ConsoleDelivery();
  return adapter;
}

/** For a deployment that configures a real provider, and for tests. */
export function useDelivery(next: DeliveryAdapter): void {
  adapter = next;
}

/** Forget the chosen adapter, so configuration is read again. */
export function forgetDelivery(): void {
  adapter = undefined;
}

/** Whether a link sent now would actually reach the person it names. */
export const canDeliver = (): boolean => delivery().reachesRecipients;

/**
 * The address of this installation, for building a link somebody can follow.
 *
 * See `site-url.ts` for why it is configuration rather than the request's host,
 * and why a production process without it refuses instead of guessing.
 */
export const baseUrl = siteUrl;

export function magicLinkMessage(token: string): { subject: string; body: string } {
  return {
    subject: "Your Oikonomia sign-in link",
    body: [
      "Somebody asked to sign in to Oikonomia with this address.",
      "",
      `${baseUrl()}/login?token=${encodeURIComponent(token)}`,
      "",
      "The link works once and expires in 15 minutes.",
      "If this was not you, nothing has happened and you can ignore this.",
    ].join("\n"),
  };
}
