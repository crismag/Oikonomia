import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Aliased: `useDelivery` sets the module's delivery adapter. It is not a React
   hook, but its name trips `react-hooks/rules-of-hooks`, and renaming the
   application's own export to satisfy a lint rule about React would be the
   wrong way round. */
import { forgetDelivery, useDelivery as setDelivery } from "../auth/delivery";
import { alertMaintenanceFailure, alertRecipient, alertsConfigured } from "./alert";
import type { DeliveryAdapter } from "../auth/delivery";

/**
 * Telling somebody when the unattended work fails.
 *
 * A backup that runs at two in the morning and fails at two in the morning is
 * a backup nobody knows about — cron's own mail is not read in a church.
 */

const original = { ...process.env };

/** A delivery adapter that records rather than sends. */
const recorder = (reaches = true) => {
  const sent: { to: string; subject: string; body: string }[] = [];
  const adapter: DeliveryAdapter = {
    id: "recorder",
    reachesRecipients: reaches,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  setDelivery(adapter);
  return sent;
};

beforeEach(() => {
  process.env["OIKONOMIA_URL"] = "https://oikonomia.example.org";
});

afterEach(() => {
  process.env = { ...original };
  forgetDelivery();
  vi.restoreAllMocks();
});

describe("where an alert goes", () => {
  it("is unconfigured until an address is given", () => {
    delete process.env["OIKONOMIA_ALERT_TO"];
    recorder();
    expect(alertRecipient()).toBeUndefined();
    expect(alertsConfigured()).toBe(false);
  });

  it("treats a blank address as unset", () => {
    process.env["OIKONOMIA_ALERT_TO"] = "   ";
    expect(alertRecipient()).toBeUndefined();
  });

  /* An address with no way to send is not alerting. */
  it("needs a mail provider as well as an address", () => {
    process.env["OIKONOMIA_ALERT_TO"] = "admin@church.test";
    recorder(false);
    expect(alertsConfigured()).toBe(false);

    recorder(true);
    expect(alertsConfigured()).toBe(true);
  });
});

describe("what a failure alert says", () => {
  beforeEach(() => {
    process.env["OIKONOMIA_ALERT_TO"] = "admin@church.test";
  });

  it("names the task, the reason and where to look", async () => {
    const sent = recorder();

    expect(
      await alertMaintenanceFailure({
        task: "backup",
        reason: "ENOSPC: no space left on device",
        jobId: "job-42",
      }),
    ).toBe(true);

    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.to).toBe("admin@church.test");
    expect(message.subject).toContain("backup");
    expect(message.body).toContain("ENOSPC: no space left on device");
    expect(message.body).toContain("job-42");
    expect(message.body).toContain("https://oikonomia.example.org/administration");
  });

  /* Silence has to mean something, so it says what it means. */
  it("says that silence means the work is being done", async () => {
    const sent = recorder();
    await alertMaintenanceFailure({ task: "retention", reason: "something" });
    expect(sent[0]!.body).toContain("silence here means the work is being done");
  });

  it("sends nothing when there is nowhere to send", async () => {
    delete process.env["OIKONOMIA_ALERT_TO"];
    const sent = recorder();

    expect(await alertMaintenanceFailure({ task: "backup", reason: "x" })).toBe(false);
    expect(sent).toEqual([]);
  });

  it("sends nothing through an adapter that reaches nobody", async () => {
    const sent = recorder(false);
    expect(await alertMaintenanceFailure({ task: "backup", reason: "x" })).toBe(false);
    expect(sent).toEqual([]);
  });

  /**
   * The property that matters most here: this is called from the failure path
   * of something that has already gone wrong. An alert that throws would turn
   * a failed backup into a failed request and lose the original reason.
   */
  it("never throws, even when sending fails", async () => {
    setDelivery({
      id: "broken",
      reachesRecipients: true,
      send: () => Promise.reject(new Error("the mail server is also down")),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      alertMaintenanceFailure({ task: "backup", reason: "the disk is full" }),
    ).resolves.toBe(false);
  });
});
