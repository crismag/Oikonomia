import { createTransport, type Transporter } from "nodemailer";

import type { DeliveryAdapter } from "./delivery";

/**
 * Sending a message to somebody who is not the server log.
 *
 * ## Why SMTP rather than a vendor's API
 *
 * Because every church already has one. A parish with a Google Workspace
 * account, a diocese with an Exchange server and somebody using a transactional
 * provider all speak SMTP; picking one vendor's HTTP API would mean the others
 * cannot use magic links at all. It is also the boundary that does not need a
 * new dependency the day the church changes provider.
 *
 * ## What is configuration and what is code
 *
 * All of it is configuration. There is no host, no credential and no from
 * address in this repository, and `configured()` is false until the
 * environment supplies them — at which point `canDeliver()` becomes true and
 * the sign-in screen offers magic links by itself, because those controls are
 * already gated on it.
 *
 * ## What never appears in a log
 *
 * The password, and the body of a message carrying a sign-in link. A failure
 * is reported as a failure with the recipient and the reason; a transport
 * error that echoes the credential it just tried is how a secret ends up in a
 * log aggregator.
 */

export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS, as on port 465. Port 587 upgrades with STARTTLS instead. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/**
 * Settings from the environment, or nothing.
 *
 * A host and a from address are the minimum: without somewhere to send and an
 * address to send as, there is no configuration, only a half of one. Username
 * and password are optional because an internal relay often needs neither.
 */
export function smtpSettings(env: NodeJS.ProcessEnv = process.env): SmtpSettings | undefined {
  const host = env["OIKONOMIA_SMTP_HOST"]?.trim();
  const from = env["OIKONOMIA_MAIL_FROM"]?.trim();
  if (!host || !from) return undefined;

  const port = Number(env["OIKONOMIA_SMTP_PORT"]?.trim() || 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined;

  /* Implicit TLS is the default only on the port that means it. Guessing
     `secure: true` on 587 produces a connection that hangs rather than an
     error that explains itself. */
  const declared = env["OIKONOMIA_SMTP_SECURE"]?.trim().toLowerCase();
  const secure = declared ? declared === "true" : port === 465;

  const user = env["OIKONOMIA_SMTP_USER"]?.trim();
  const password = env["OIKONOMIA_SMTP_PASSWORD"];

  return {
    host,
    port,
    secure,
    from,
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}

export const smtpConfigured = (env?: NodeJS.ProcessEnv): boolean =>
  Boolean(smtpSettings(env ?? process.env));

/**
 * A real destination.
 *
 * `reachesRecipients` is true, which is the whole difference from the console
 * adapter: it is what `canDeliver()` reads, and what decides whether the
 * sign-in screen offers a control that ends in an email.
 */
export class SmtpDelivery implements DeliveryAdapter {
  readonly id = "smtp";
  readonly reachesRecipients = true;

  private transporter: Transporter | undefined;

  constructor(private readonly settings: SmtpSettings) {}

  /** Built once, lazily: constructing one opens no socket, sending does. */
  private transport(): Transporter {
    this.transporter ??= createTransport({
      host: this.settings.host,
      port: this.settings.port,
      secure: this.settings.secure,
      ...(this.settings.user && this.settings.password
        ? { auth: { user: this.settings.user, pass: this.settings.password } }
        : {}),
    });
    return this.transporter;
  }

  async send(message: { to: string; subject: string; body: string }): Promise<void> {
    try {
      await this.transport().sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    } catch (error) {
      /* The recipient and the reason, and never the body — it carries the
         sign-in link this whole mechanism exists to keep private. */
      console.error(
        `Could not send "${message.subject}" to ${message.to}:`,
        error instanceof Error ? error.message : error,
      );
      throw new Error("That message could not be sent.");
    }
  }
}
