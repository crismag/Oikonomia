import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canDeliver, delivery, forgetDelivery } from "../auth/delivery";
import { encodeSubject, GmailDelivery, rawMessage } from "./gmail";
import { useGoogleTransport, workspaceConfig } from "./workspace";

/**
 * System mail through Gmail, without Gmail.
 *
 * The transport is replaced, so these hold what Oikonomia hands Google — who it
 * acts as, and the message itself — and that a demonstration hands it nothing.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let calls: { url: string; init: RequestInit }[];

beforeEach(() => {
  vi.stubEnv(
    "OIKONOMIA_GOOGLE_SA_KEY",
    JSON.stringify({ client_email: "oik@proj.iam.gserviceaccount.com", private_key: pem }),
  );
  vi.stubEnv("OIKONOMIA_GOOGLE_DOMAIN", "stjohns.org");
  vi.stubEnv("OIKONOMIA_GOOGLE_APP_USER", "office@stjohns.org");
  vi.stubEnv("OIKONOMIA_DEMO_MODE", "false");
  forgetDelivery();
  calls = [];
  useGoogleTransport(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    return new Response(JSON.stringify({ id: "msg-1" }));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  forgetDelivery();
});

/** The RFC 2822 message Google was given, decoded. */
function sentMessage(): { headers: Record<string, string>; body: string } {
  const send = calls.find((call) => call.url.includes("gmail.googleapis.com"));
  if (!send) throw new Error("Nothing was sent to Gmail.");
  const { raw } = JSON.parse(String(send.init.body)) as { raw: string };
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [head = "", ...rest] = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r\n /g, " ").split("\r\n")) {
    const at = line.indexOf(": ");
    headers[line.slice(0, at)] = line.slice(at + 2);
  }
  return {
    headers,
    body: Buffer.from(rest.join("").replace(/\s+/g, ""), "base64").toString("utf8"),
  };
}

const decodeSubject = (value: string) =>
  value
    .split(" ")
    .map((word) => {
      const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word);
      return match ? Buffer.from(match[1]!, "base64").toString("utf8") : word;
    })
    .join("");

describe("sending through Gmail", () => {
  it("sends as the church mailbox, with To, From, Subject and body intact", async () => {
    await new GmailDelivery(workspaceConfig()!).send({
      to: "maria@stjohns.org",
      subject: "Joel Tan: Action requested",
      body: "Please book the hall.\nThank you.",
    });

    const send = calls.find((call) => call.url.includes("gmail.googleapis.com"))!;
    expect(send.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(send.init.method).toBe("POST");

    /* The token was minted for the church mailbox with only the send scope. */
    const token = calls.find((call) => call.url.includes("oauth2"))!;
    const assertion = new URLSearchParams(String(token.init.body)).get("assertion")!;
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString()) as {
      sub: string;
      scope: string;
    };
    expect(claims.sub).toBe("office@stjohns.org");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/gmail.send");

    const { headers, body } = sentMessage();
    expect(headers["From"]).toBe("Oikonomia <office@stjohns.org>");
    expect(headers["To"]).toBe("maria@stjohns.org");
    expect(headers["Subject"]).toBe("Joel Tan: Action requested");
    expect(headers["Content-Type"]).toContain("UTF-8");
    expect(body).toBe("Please book the hall.\nThank you.");
  });

  it("keeps a subject and body outside ASCII readable", async () => {
    const subject = "Iglesia San José — reunión de líderes ✝ ".repeat(3).trim();
    await new GmailDelivery(workspaceConfig()!).send({
      to: "ines@stjohns.org",
      subject,
      body: "¿Puedes reservar el salón? 🙏",
    });

    const { headers, body } = sentMessage();
    expect(headers["Subject"]).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeSubject(headers["Subject"]!)).toBe(subject);
    expect(body).toBe("¿Puedes reservar el salón? 🙏");
  });

  it("cannot be made to write a header of somebody else's choosing", () => {
    expect(encodeSubject("Hello\r\nBcc: everyone@example.org")).toBe(
      "Hello Bcc: everyone@example.org",
    );
    expect(() =>
      rawMessage({
        from: "office@stjohns.org",
        to: "maria@stjohns.org\r\nBcc: everyone@example.org",
        subject: "x",
        body: "x",
      }),
    ).toThrow();
  });
});

describe("which delivery an installation has", () => {
  it("is Gmail when Google Workspace is configured, and it reaches people", () => {
    vi.stubEnv("OIKONOMIA_SMTP_HOST", "smtp.example.org");
    vi.stubEnv("OIKONOMIA_MAIL_FROM", "no-reply@example.org");
    forgetDelivery();
    expect(delivery()).toBeInstanceOf(GmailDelivery);
    expect(canDeliver()).toBe(true);
  });

  it("is never Gmail on a demonstration, and nothing reaches Google", async () => {
    vi.stubEnv("OIKONOMIA_DEMO_MODE", "true");
    forgetDelivery();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await delivery().send({ to: "maria@stjohns.org", subject: "x", body: "x" });

    expect(delivery()).not.toBeInstanceOf(GmailDelivery);
    expect(canDeliver()).toBe(false);
    expect(calls).toEqual([]);
  });

  it("falls back to SMTP when the Workspace configuration is broken", () => {
    vi.stubEnv("OIKONOMIA_GOOGLE_SA_KEY", "not json");
    vi.stubEnv("OIKONOMIA_SMTP_HOST", "smtp.example.org");
    vi.stubEnv("OIKONOMIA_MAIL_FROM", "no-reply@example.org");
    forgetDelivery();
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(delivery().id).toBe("smtp");
  });
});
