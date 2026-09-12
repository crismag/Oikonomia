import { describe, expect, it } from "vitest";

import {
  copyDefinition,
  duplicateField,
  duplicateSection,
  formatValue,
  isContentField,
  move,
  recordFromDefinition,
  recordTally,
  reportableFromRecords,
  responseFields,
  responseFor,
} from "./forms";
import { definitionById, formRecords } from "@/test/form-fixtures";
import type { FormDefinition, FormRecord, FormSection } from "./types";

/**
 * Forms behaviour.
 *
 * The load-bearing rule is separation: a definition is the reusable design, a
 * record is what happened. Editing the design must never rewrite a record, and
 * filling a record must never touch the design. Most of these cases exist to
 * stop that boundary eroding.
 */

const sections: FormSection[] = [
  {
    id: "s1",
    title: "Sunday",
    description: "Before service",
    fields: [
      { id: "f1", type: "checkbox", label: "Cook rice", config: { allowNote: true } },
      { id: "f2", type: "status", label: "Stock cutlery", config: { allowNote: true } },
      { id: "f3", type: "instruction", label: "Reheat in the air fryer." },
    ],
  },
  {
    id: "s2",
    title: "Monday",
    fields: [{ id: "f4", type: "long-text", label: "Notes", config: { reportable: true } }],
  },
];

const definition: FormDefinition = {
  id: "d1",
  title: "Weekly checklist",
  ownerId: "p-esther",
  status: "published",
  version: 3,
  sections,
  createdAt: "2026-04-02",
  updatedAt: "2026-06-18",
  history: [],
};

describe("field kinds", () => {
  it("treats headings and instructions as display-only", () => {
    expect(isContentField("heading")).toBe(true);
    expect(isContentField("instruction")).toBe(true);
    expect(isContentField("checkbox")).toBe(false);
  });

  it("excludes display-only fields from the response set", () => {
    expect(responseFields(sections).map((f) => f.id)).toEqual(["f1", "f2", "f4"]);
  });
});

describe("structure editing", () => {
  it("moves an item within a list", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("refuses to move past either end", () => {
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("gives a duplicated section fresh ids so the two are independent", () => {
    const original = sections[0]!;
    const copy = duplicateSection(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.fields.map((f) => f.id)).not.toEqual(original.fields.map((f) => f.id));
    expect(copy.fields).toHaveLength(original.fields.length);
  });

  it("marks a duplicated section as a copy", () => {
    expect(duplicateSection(sections[0]!).title).toBe("Sunday (copy)");
  });

  it("gives a duplicated field a fresh id but the same shape", () => {
    const field = sections[0]!.fields[0]!;
    const copy = duplicateField(field);
    expect(copy.id).not.toBe(field.id);
    expect(copy.label).toBe(field.label);
    expect(copy.type).toBe(field.type);
  });
});

describe("copying a definition", () => {
  const copy = copyDefinition(definition, "Worship setup checklist", "p-maria");

  it("produces a separate draft at version one", () => {
    expect(copy.id).not.toBe(definition.id);
    expect(copy.title).toBe("Worship setup checklist");
    expect(copy.status).toBe("draft");
    expect(copy.version).toBe(1);
  });

  it("rewrites every section and field id", () => {
    const originalIds = definition.sections.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)]);
    const copyIds = copy.sections.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)]);
    expect(copyIds.some((id) => originalIds.includes(id))).toBe(false);
  });

  it("records where it came from", () => {
    expect(copy.history[0]?.summary).toContain("Weekly checklist");
  });
});

describe("creating a record", () => {
  const record = recordFromDefinition(definition, {
    title: "Week of 12 July",
    period: "12–18 July",
    createdBy: "p-esther",
  });

  it("captures the version it was created under", () => {
    expect(record.formVersion).toBe(3);
  });

  it("starts in progress with no responses", () => {
    expect(record.status).toBe("in-progress");
    expect(record.responses).toEqual([]);
  });

  it("copies the structure rather than referencing it", () => {
    // Mutating the definition afterwards must not reach the record.
    const mutated = structuredClone(definition);
    mutated.sections[0]!.fields[0]!.label = "Changed later";
    expect(record.sections[0]?.fields[0]?.label).toBe("Cook rice");
  });

  it("omits a period that was not given", () => {
    const bare = recordFromDefinition(definition, { title: "Ad hoc", createdBy: "p-esther" });
    expect(bare.period).toBeUndefined();
  });
});

describe("record tally", () => {
  const base = recordFromDefinition(definition, { title: "T", createdBy: "p-esther" });

  const withResponses = (responses: FormRecord["responses"]): FormRecord => ({
    ...base,
    responses,
  });

  it("counts nothing done on an untouched record", () => {
    const tally = recordTally(base);
    expect(tally.done).toBe(0);
    expect(tally.outstanding).toBe(3);
  });

  it("counts a ticked checkbox as done", () => {
    expect(recordTally(withResponses([{ fieldId: "f1", value: true }])).done).toBe(1);
  });

  it("does not count an unticked checkbox", () => {
    expect(recordTally(withResponses([{ fieldId: "f1", value: false }])).done).toBe(0);
  });

  it("counts needs-attention separately from done", () => {
    const tally = recordTally(withResponses([{ fieldId: "f2", status: "needs-attention" }]));
    expect(tally.attention).toBe(1);
    expect(tally.done).toBe(0);
  });

  it("counts N/A separately again", () => {
    const tally = recordTally(withResponses([{ fieldId: "f2", status: "not-applicable" }]));
    expect(tally.notApplicable).toBe(1);
    expect(tally.outstanding).toBe(2);
  });

  it("ignores display-only fields entirely", () => {
    expect(recordTally(base).total).toBe(3);
  });

  it("treats an empty text answer as outstanding", () => {
    expect(recordTally(withResponses([{ fieldId: "f4", value: "" }])).done).toBe(0);
  });
});

describe("reportable material", () => {
  const base = recordFromDefinition(definition, {
    title: "Week of 12 July",
    createdBy: "p-esther",
  });

  it("offers an item that needs attention, with its note", () => {
    const record = {
      ...base,
      responses: [
        { fieldId: "f2", status: "needs-attention" as const, note: "Running low on forks" },
      ],
    };
    const items = reportableFromRecords([record]);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain("Stock cutlery needs attention");
    expect(items[0]?.text).toContain("Running low on forks");
    expect(items[0]?.emphasis).toBe("on-hold");
  });

  it("never offers ordinary ticked checkboxes", () => {
    const record = { ...base, responses: [{ fieldId: "f1", value: true }] };
    expect(reportableFromRecords([record])).toEqual([]);
  });

  it("offers a field the author marked reportable", () => {
    const record = { ...base, responses: [{ fieldId: "f4", value: "Supply ran short" }] };
    const items = reportableFromRecords([record]);
    expect(items[0]?.text).toBe("Notes: Supply ran short");
    expect(items[0]?.emphasis).toBe("progress");
  });

  it("skips a reportable field left blank", () => {
    const record = { ...base, responses: [{ fieldId: "f4", value: "" }] };
    expect(reportableFromRecords([record])).toEqual([]);
  });

  it("attributes the item to its record", () => {
    const record = { ...base, responses: [{ fieldId: "f4", value: "Something" }] };
    expect(reportableFromRecords([record])[0]?.source).toMatchObject({
      kind: "form-record",
      label: "Week of 12 July",
    });
  });
});

describe("value formatting", () => {
  const checkbox = sections[0]!.fields[0]!;
  const status = sections[0]!.fields[1]!;

  it("renders a ticked checkbox as Done and an unticked one as nothing", () => {
    expect(formatValue(checkbox, { fieldId: "f1", value: true })).toBe("Done");
    expect(formatValue(checkbox, { fieldId: "f1", value: false })).toBeUndefined();
  });

  it("renders a status by its label", () => {
    expect(formatValue(status, { fieldId: "f2", status: "needs-attention" })).toBe(
      "Needs attention",
    );
  });

  it("joins a multiple-choice answer", () => {
    const field = { id: "m", type: "multi-choice" as const, label: "Workers" };
    expect(formatValue(field, { fieldId: "m", value: ["Server", "Porter"] })).toBe(
      "Server, Porter",
    );
  });

  it("has nothing to show for an unanswered field", () => {
    expect(formatValue(checkbox, undefined)).toBeUndefined();
  });
});

describe("the Victuals fixture", () => {
  const form = definitionById("frm-victuals-weekly");
  const record = formRecords.find((r) => r.id === "rec-victuals-w2");

  it("is built from the generic model with the binder's cadence sections", () => {
    expect(
      form?.sections.map((s) => `${s.title}${s.description ? ` — ${s.description}` : ""}`),
    ).toEqual([
      "Sunday — Before service / set-up",
      "Sunday — After service — servers and kitchen porters",
      "Monday",
      "Wednesday",
      "Friday",
      "Saturday",
      "Monthly",
    ]);
  });

  it("carries guidance under an item rather than as another item", () => {
    const prepare = form?.sections[0]?.fields.find((f) => f.label === "Prepare food");
    expect(prepare?.description).toBe("Reheat in the air fryer and oven.");
    expect(prepare?.type).toBe("checkbox");
  });

  it("keeps a completed record readable and its exception intact", () => {
    expect(record?.status).toBe("completed");
    const cutlery = record ? responseFor(record, "f-cutlery") : undefined;
    expect(cutlery?.status).toBe("needs-attention");
    expect(cutlery?.note).toContain("forks");
  });

  it("surfaces that exception for reporting", () => {
    const items = record ? reportableFromRecords([record]) : [];
    expect(items.some((i) => i.text.includes("Stock up cutleries needs attention"))).toBe(true);
  });

  it("pins the record to the version it was filled under", () => {
    expect(record?.formVersion).toBe(4);
    expect(form?.version).toBe(4);
  });
});
