import { afterEach, describe, expect, it } from "vitest";

import { canDeliver, ConsoleDelivery, delivery, forgetDelivery } from "./delivery";
import { SmtpDelivery, smtpConfigured, smtpSettings } from "./smtp";

/**
 * Getting a sign-in link to somebody.
 *
 * The readiness audit's gap 2: magic-link sign-in and password reset were
 * implemented and could not reach anybody, so the sign-in screen removed both
 * controls and said so.
 */

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  forgetDelivery();
});

const settingsFrom = (env: Record<string, string>) => smtpSettings(env as NodeJS.ProcessEnv);

describe("reading SMTP settings", () => {
  const complete = {
    OIKONOMIA_SMTP_HOST: "smtp.example.org",
    OIKONOMIA_MAIL_FROM: "Oikonomia <no-reply@example.org>",
  };

  it("needs somewhere to send and an address to send as", () => {
    expect(settingsFrom(complete)).toBeDefined();
    expect(settingsFrom({ OIKONOMIA_SMTP_HOST: "smtp.example.org" })).toBeUndefined();
    expect(settingsFrom({ OIKONOMIA_MAIL_FROM: "a@b.org" })).toBeUndefined();
    expect(settingsFrom({})).toBeUndefined();
  });

  it("defaults to the submission port", () => {
    expect(settingsFrom(complete)!.port).toBe(587);
  });

  /* Guessing implicit TLS on 587 produces a connection that hangs rather than
     an error explaining itself. */
  it("assumes implicit TLS only on the port that means it", () => {
    expect(settingsFrom({ ...complete, OIKONOMIA_SMTP_PORT: "465" })!.secure).toBe(true);
    expect(settingsFrom({ ...complete, OIKONOMIA_SMTP_PORT: "587" })!.secure).toBe(false);
  });

  it("lets the deployment override the TLS assumption", () => {
    expect(
      settingsFrom({ ...complete, OIKONOMIA_SMTP_PORT: "587", OIKONOMIA_SMTP_SECURE: "true" })!
        .secure,
    ).toBe(true);
    expect(
      settingsFrom({ ...complete, OIKONOMIA_SMTP_PORT: "465", OIKONOMIA_SMTP_SECURE: "false" })!
        .secure,
    ).toBe(false);
  });

  it("refuses a port that is not one", () => {
    for (const port of ["0", "-1", "70000", "not-a-port"]) {
      expect(settingsFrom({ ...complete, OIKONOMIA_SMTP_PORT: port }), port).toBeUndefined();
    }
  });

  /* An internal relay often needs no credential at all. */
  it("treats credentials as optional", () => {
    expect(settingsFrom(complete)!.user).toBeUndefined();
    const withAuth = settingsFrom({
      ...complete,
      OIKONOMIA_SMTP_USER: "postmaster",
      OIKONOMIA_SMTP_PASSWORD: "a secret",
    })!;
    expect(withAuth.user).toBe("postmaster");
    expect(withAuth.password).toBe("a secret");
  });

  it("treats blank values as unset", () => {
    expect(
      settingsFrom({ OIKONOMIA_SMTP_HOST: "  ", OIKONOMIA_MAIL_FROM: "a@b.org" }),
    ).toBeUndefined();
  });
});

describe("which adapter an installation gets", () => {
  it("is the console when nothing is configured, and says nothing was sent", () => {
    delete process.env["OIKONOMIA_SMTP_HOST"];
    forgetDelivery();

    expect(delivery()).toBeInstanceOf(ConsoleDelivery);
    expect(canDeliver()).toBe(false);
  });

  /**
   * The behaviour that matters: configuring SMTP turns the magic-link and
   * password-reset controls back on by itself, because they are gated on
   * `canDeliver()` and nothing decides it twice.
   */
  it("is SMTP once configured, and then a link can reach somebody", () => {
    process.env["OIKONOMIA_SMTP_HOST"] = "smtp.example.org";
    process.env["OIKONOMIA_MAIL_FROM"] = "Oikonomia <no-reply@example.org>";
    forgetDelivery();

    expect(delivery()).toBeInstanceOf(SmtpDelivery);
    expect(canDeliver()).toBe(true);
    expect(smtpConfigured()).toBe(true);
  });

  it("does not decide once and for all at module load", () => {
    delete process.env["OIKONOMIA_SMTP_HOST"];
    forgetDelivery();
    expect(canDeliver()).toBe(false);

    process.env["OIKONOMIA_SMTP_HOST"] = "smtp.example.org";
    process.env["OIKONOMIA_MAIL_FROM"] = "a@b.org";
    forgetDelivery();
    expect(canDeliver()).toBe(true);
  });
});

describe("what a failure says", () => {
  it("does not put the message body in the error", async () => {
    /* Unroutable host, so the transport fails without a server. */
    const adapter = new SmtpDelivery({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      from: "no-reply@example.org",
    });

    await expect(
      adapter.send({
        to: "somebody@example.org",
        subject: "Your Oikonomia sign-in link",
        body: "https://oikonomia.example.org/login?token=a-secret-token",
      }),
    ).rejects.toThrow(/could not be sent/);
  });
});

/**
 * Actually delivering one.
 *
 * Everything above is configuration. This is the question configuration exists
 * to answer — does a sign-in link reach a mailbox — and it is answered against
 * a real SMTP conversation rather than a mock, because the thing most likely
 * to be wrong is the protocol exchange itself.
 *
 * The server is forty lines of `node:net` speaking the minimum SMTP needs. It
 * is a sink, not an implementation: it accepts, records, and says 250.
 */
describe("delivering a message for real", () => {
  const listen = async () => {
    const { createServer } = await import("node:net");
    const received: string[] = [];

    const server = createServer((socket) => {
      let inData = false;
      let body = "";

      socket.write("220 smtp.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        const text = chunk.toString();

        if (inData) {
          body += text;
          if (body.includes("\r\n.\r\n")) {
            inData = false;
            received.push(body);
            socket.write("250 2.0.0 Ok: queued\r\n");
          }
          return;
        }

        for (const line of text.split("\r\n").filter(Boolean)) {
          const verb = line.split(" ")[0]?.toUpperCase();
          if (verb === "EHLO" || verb === "HELO") socket.write("250-smtp.test\r\n250 SIZE\r\n");
          else if (verb === "MAIL" || verb === "RCPT") socket.write("250 2.1.0 Ok\r\n");
          else if (verb === "DATA") {
            inData = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (verb === "QUIT") {
            socket.write("221 2.0.0 Bye\r\n");
            socket.end();
          } else socket.write("250 2.0.0 Ok\r\n");
        }
      });
      socket.on("error", () => {});
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    return { server, port, received };
  };

  it("delivers a sign-in link to the address it names", async () => {
    const { server, port, received } = await listen();

    try {
      const adapter = new SmtpDelivery({
        host: "127.0.0.1",
        port,
        secure: false,
        from: "Oikonomia <no-reply@example.org>",
      });

      await adapter.send({
        to: "perpetua@church.test",
        subject: "Your Oikonomia sign-in link",
        body: "https://oikonomia.example.org/login?token=a-secret-token",
      });

      expect(received).toHaveLength(1);
      const message = received[0]!;
      expect(message).toContain("To: perpetua@church.test");
      expect(message).toContain("Your Oikonomia sign-in link");
      expect(message).toContain("token=a-secret-token");
      expect(message).toContain("no-reply@example.org");
    } finally {
      server.close();
    }
  });

  it("reports a refusal rather than pretending it was sent", async () => {
    const { createServer } = await import("node:net");
    const server = createServer((socket) => {
      socket.write("554 5.7.1 Service unavailable\r\n");
      socket.on("data", () => socket.write("554 5.7.1 Service unavailable\r\n"));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const adapter = new SmtpDelivery({
        host: "127.0.0.1",
        port,
        secure: false,
        from: "no-reply@example.org",
      });

      await expect(adapter.send({ to: "a@b.org", subject: "s", body: "b" })).rejects.toThrow(
        /could not be sent/,
      );
    } finally {
      server.close();
    }
  });
});
