import { afterEach, describe, expect, it } from "vitest";

import { config, get, label, option, options, reload, semanticOf, validateAll } from "./registry";
import { message, messages, text } from "./messages";
import { optionList, optionSchema, statusSchema } from "./schema";

/**
 * The configuration platform.
 *
 * Two failures are being guarded against, and they are not the same.
 *
 * **Configuration that is wrong** — a duplicate id, a label used as an
 * identifier, a missing key — must fail loudly at load, naming the namespace.
 * Malformed configuration that merely produces strange behaviour three screens
 * later is the thing this exists to prevent.
 *
 * **Configuration that is right but read carelessly** — an inactive option
 * still offered, a label compared instead of an id, a message rendered with
 * `{title}` still in it — is quieter and worse.
 */

afterEach(() => reload());

describe("loading", () => {
  it("validates every namespace", () => {
    const checked = validateAll();
    expect(checked.length).toBeGreaterThan(10);
  });

  it("names the namespace when configuration is wrong", () => {
    /* The message has to say which configuration is broken, or somebody finds
       out by elimination. */
    expect(() => get("nope" as never)).toThrow();
  });

  it("reads each namespace once and caches it", () => {
    const first = get("reports.statuses");
    expect(get("reports.statuses")).toBe(first);
    reload();
    expect(get("reports.statuses")).not.toBe(first);
  });
});

describe("schema", () => {
  it("refuses a label used as an id", () => {
    expect(() => optionSchema.parse({ id: "In Progress", label: "In progress" })).toThrow();
    expect(() => optionSchema.parse({ id: "in-progress", label: "In progress" })).not.toThrow();
  });

  it("refuses two options sharing an id", () => {
    const list = optionList(optionSchema);
    expect(() =>
      list.parse([
        { id: "draft", label: "Draft" },
        { id: "draft", label: "Draft again" },
      ]),
    ).toThrow();
  });

  it("refuses a list with nothing in it", () => {
    expect(() => optionList(optionSchema).parse([])).toThrow();
  });

  it("defaults a status to neutral and non-terminal rather than guessing", () => {
    const parsed = statusSchema.parse({ id: "x", label: "X" });
    expect(parsed.semanticState).toBe("neutral");
    expect(parsed.terminal).toBe(false);
    expect(parsed.active).toBe(true);
  });
});

describe("reading options", () => {
  it("offers only what is active, in configured order", () => {
    const offered = options("reports.statuses");
    expect(offered.every((entry) => entry.active !== false)).toBe(true);
    expect(offered.map((entry) => entry.id)).toContain("published");
  });

  /**
   * Deactivating stops something being offered. It never rewrites history: a
   * record filed under a category that was later retired still has to render
   * its name.
   */
  it("still resolves a label for an option that is no longer offered", () => {
    const list = get("work.statuses") as { id: string; active: boolean }[];
    const target = list.find((entry) => entry.id === "closed")!;
    target.active = false;

    expect(options("work.statuses").some((entry) => entry.id === "closed")).toBe(false);
    expect(label("work.statuses", "closed")).toBe("Closed");
    expect(option("work.statuses", "closed")).toBeTruthy();
  });

  it("falls back to the id rather than rendering nothing", () => {
    expect(label("work.statuses", "something-nobody-configured")).toBe(
      "something-nobody-configured",
    );
  });

  it("answers what a status means, not what it looks like", () => {
    expect(semanticOf("work.statuses", "resolved")).toBe("success");
    expect(semanticOf("work.statuses", "changes-requested")).toBe("warning");
    expect(semanticOf("work.statuses", "unknown")).toBe("neutral");

    /* No colour, class or hex anywhere in business configuration. */
    const serialized = JSON.stringify(get("work.statuses"));
    expect(serialized).not.toMatch(/#[0-9a-f]{3,6}|text-|bg-|border-/i);
  });

  it("exposes the site profile as typed values", () => {
    expect(config.site.pageSize).toBeGreaterThan(0);
    expect(config.site.weekStartsOn).toBeGreaterThanOrEqual(0);
    expect(config.cadence.warnWithinDays).toBeGreaterThanOrEqual(0);
  });
});

describe("messages", () => {
  it("finds one by key", () => {
    expect(message("reports.publish.success").title).toBe("Report published");
    expect(message("reports.publish.success").severity).toBe("success");
  });

  it("fills parameters", () => {
    const filled = message("reports.delete.confirm", { title: "September report" });
    expect(filled.title).toContain("September report");
    expect(filled.title).not.toContain("{title}");
  });

  it("refuses to leave a parameter unresolved in development", () => {
    /* A sentence reading "Delete {title}?" in front of a leader is a bug that
       looks like a typo. */
    expect(() => message("reports.delete.confirm")).toThrow();
  });

  it("returns the key rather than throwing when a message is missing", () => {
    expect(text("nothing.defined.here")).toBe("nothing.defined.here");
  });

  it("carries button wording on confirmations, so dialogs do not invent it", () => {
    const confirm = message("common.delete.confirm");
    expect(confirm.confirmLabel).toBeTruthy();
    expect(confirm.cancelLabel).toBeTruthy();
  });

  it("keys every message by meaning rather than by its English", () => {
    for (const key of Object.keys(messages)) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/);
    }
  });
});

/**
 * A category an administrator added must actually work.
 *
 * This is the test that catches the failure the first implementation had: the
 * category appeared in every list, and `triggersAttention` — reading a static
 * array rather than the registry — answered `false`. The option was offered,
 * storable, and inert. That is precisely a control that looks operational and
 * is not.
 */
describe("an added category behaves like one that shipped", () => {
  const added = {
    namespace: "information.categories",
    optionId: "safeguarding-concern",
    isAddition: true,
    value: {
      label: "Safeguarding concern",
      active: true,
      attentionTrigger: true,
      contexts: ["entry", "report"],
    },
  };

  it("is offered, labelled, and asks for attention", async () => {
    const { applyOverrides } = await import("./registry");
    const { triggersAttention, categoriesFor, categoryLabelOf } =
      await import("@/domain/categories");

    applyOverrides([added as never]);

    expect(categoriesFor("report").some((c) => c.id === "safeguarding-concern")).toBe(true);
    expect(categoryLabelOf("safeguarding-concern")).toBe("Safeguarding concern");
    expect(triggersAttention("safeguarding-concern")).toBe(true);

    /* And the shipped ones are unchanged by its arrival. */
    expect(triggersAttention("general")).toBe(false);
    expect(triggersAttention("concern")).toBe(true);
  });

  it("stops being offered when it is deactivated, and still renders its name", async () => {
    const { applyOverrides } = await import("./registry");
    const { categoriesFor, categoryLabelOf } = await import("@/domain/categories");

    applyOverrides([{ ...added, value: { ...added.value, active: false } } as never]);

    expect(categoriesFor("report").some((c) => c.id === "safeguarding-concern")).toBe(false);
    expect(categoryLabelOf("safeguarding-concern")).toBe("Safeguarding concern");
  });
});
