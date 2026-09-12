import { toISO } from "@/domain/schedule";
import type { FormDefinition, FormRecord, FormSection, FormField } from "@/domain/types";

/**
 * Form fixtures.
 *
 * The Victuals Weekly Checklist is built entirely from the generic field types —
 * nothing about it is special-cased. It is the acceptance example: whatever the
 * builder can express, a leader can build themselves.
 */

const today = new Date();
const YEAR = today.getFullYear();
const iso = (m: number, d: number) =>
  `${YEAR}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const check = (id: string, label: string, description?: string): FormField => ({
  id,
  type: "checkbox",
  label,
  ...(description ? { description } : {}),
  config: { allowNote: true },
});

const statusItem = (id: string, label: string, description?: string): FormField => ({
  id,
  type: "status",
  label,
  ...(description ? { description } : {}),
  config: { allowNote: true, reportable: false },
});

const section = (
  id: string,
  title: string,
  description: string | undefined,
  fields: FormField[],
): FormSection => ({ id, title, ...(description ? { description } : {}), fields });

/* ------------------------------------------------- Victuals weekly checklist */

const victualsSections: FormSection[] = [
  section("sec-sun-before", "Sunday", "Before service / set-up", [
    check("f-rice", "Cook rice", "Coordinate with the assigned volunteer."),
    check("f-table", "Set up table and organize food"),
    check("f-prepare", "Prepare food", "Reheat in the air fryer and oven."),
    check("f-plates", "Make sure wooden plates are clean"),
    statusItem("f-cutlery", "Stock up cutleries"),
    check("f-juice", "Prepare juice, make ice, stock cups"),
  ]),
  section("sec-sun-after", "Sunday", "After service — servers and kitchen porters", [
    check("f-pray", "Pray for the food before serving"),
    check("f-ppe", "PPE for servers"),
    check("f-distribute", "Distribute plates"),
    check("f-disinfect", "Disinfect wooden plate liners"),
    check("f-dishes", "Wash dishes"),
    check("f-coffee", "Clean the coffee station"),
    check("f-fridge", "Clean the fridge"),
    {
      id: "f-servers",
      type: "multi-choice",
      label: "Workers present",
      config: { options: ["Server", "Kitchen porter", "Coordinator"] },
    },
  ]),
  section("sec-mon", "Monday", undefined, [
    check("f-appreciation", "Send an appreciation message to Sunday's volunteers"),
  ]),
  section("sec-wed", "Wednesday", undefined, [
    check(
      "f-verify",
      "Verify the food planned by the Potbless volunteer",
      "Coordinate with the other volunteers.",
    ),
  ]),
  section("sec-fri", "Friday", undefined, [
    check("f-remind", "Remind the assigned Potbless volunteers", "Send the small schedule poster."),
  ]),
  section("sec-sat", "Saturday", undefined, [
    check("f-send", "Send designated Victuals volunteers to the team group chat"),
  ]),
  section("sec-monthly", "Monthly", undefined, [
    check("f-coordinate", "Coordinate the Potbless volunteer"),
    check("f-schedule", "Send the volunteer schedule"),
    {
      id: "f-problems",
      type: "long-text",
      label: "Problems encountered",
      description: "Anything leadership should know about.",
      config: { reportable: true },
    },
  ]),
];

export const formDefinitions: FormDefinition[] = [
  {
    id: "frm-victuals-weekly",
    title: "Victuals Ministry — Weekly Checklist",
    description: "The week's serving routine, from Sunday set-up to the monthly schedule.",
    ministryId: "min-victuals",
    campusId: "cmp-scarborough",
    ownerId: "p-esther",
    status: "published",
    version: 4,
    sections: victualsSections,
    createdAt: iso(4, 2),
    updatedAt: iso(6, 18),
    history: [
      {
        version: 4,
        date: iso(6, 18),
        summary: "Updated the food preparation instruction",
        authorId: "p-esther",
      },
      {
        version: 3,
        date: iso(5, 31),
        summary: "Made cutlery stock a status item",
        authorId: "p-esther",
      },
      { version: 2, date: iso(5, 4), summary: "Added the PPE requirement", authorId: "p-esther" },
      { version: 1, date: iso(4, 2), summary: "Created", authorId: "p-esther" },
    ],
  },
  {
    id: "frm-attendance",
    title: "Service Attendance",
    description: "Headcount and notes for a single service or gathering.",
    ministryId: "min-victuals",
    ownerId: "p-mark",
    status: "published",
    version: 2,
    createdAt: iso(3, 10),
    updatedAt: iso(5, 2),
    sections: [
      section("sec-att", "Attendance", undefined, [
        { id: "f-att-date", type: "date", label: "Date", required: true },
        {
          id: "f-att-service",
          type: "single-choice",
          label: "Service",
          config: { options: ["9:00 AM", "11:30 AM", "Evening"] },
        },
        {
          id: "f-att-present",
          type: "number",
          label: "Present",
          required: true,
          config: { reportable: true },
        },
        { id: "f-att-guests", type: "number", label: "Guests", config: { reportable: true } },
        { id: "f-att-recorder", type: "person", label: "Recorded by" },
        { id: "f-att-notes", type: "long-text", label: "Notes" },
      ]),
    ],
    history: [
      { version: 2, date: iso(5, 2), summary: "Added guest count", authorId: "p-mark" },
      { version: 1, date: iso(3, 10), summary: "Created", authorId: "p-mark" },
    ],
  },
  {
    id: "frm-ministry-report",
    title: "Monthly Ministry Report",
    description: "What happened this month, and what leadership should know.",
    ministryId: "min-victuals",
    ownerId: "p-esther",
    status: "published",
    version: 1,
    createdAt: iso(2, 14),
    updatedAt: iso(2, 14),
    sections: [
      section("sec-rep-head", "Period", undefined, [
        { id: "f-rep-month", type: "short-text", label: "Month" },
        { id: "f-rep-lead", type: "person", label: "Reported by" },
      ]),
      section("sec-rep-body", "This month", undefined, [
        {
          id: "f-rep-summary",
          type: "long-text",
          label: "Summary of ministry activity",
          config: { reportable: true },
        },
        {
          id: "f-rep-served",
          type: "number",
          label: "Services served",
          config: { reportable: true },
        },
        {
          id: "f-rep-concern",
          type: "long-text",
          label: "Concerns for leadership",
          config: { reportable: true },
        },
        {
          id: "f-rep-support",
          type: "single-choice",
          label: "Support needed",
          config: { options: ["None", "Volunteers", "Budget", "Equipment"], reportable: true },
        },
      ]),
    ],
    history: [{ version: 1, date: iso(2, 14), summary: "Created", authorId: "p-esther" }],
  },
];

/* ----------------------------------------------------------------- records */

/** Structure captured at v4, as a real record would be. */
const capturedSections = victualsSections.map((s) => ({
  ...s,
  fields: s.fields.map((f) => ({ ...f })),
}));

export const formRecords: FormRecord[] = [
  {
    id: "rec-victuals-w2",
    formDefinitionId: "frm-victuals-weekly",
    formVersion: 4,
    sections: capturedSections,
    title: "Week of 12 July",
    period: "12–18 July",
    date: iso(7, 12),
    status: "completed",
    createdBy: "p-esther",
    createdAt: iso(7, 12),
    updatedAt: iso(7, 18),
    completedAt: iso(7, 18),
    links: [],
    responses: [
      { fieldId: "f-rice", value: true },
      { fieldId: "f-table", value: true },
      { fieldId: "f-prepare", value: true },
      { fieldId: "f-plates", value: true },
      {
        fieldId: "f-cutlery",
        status: "needs-attention",
        note: "Running low on forks — about forty left.",
      },
      { fieldId: "f-juice", value: true },
      { fieldId: "f-pray", value: true },
      { fieldId: "f-ppe", value: true },
      { fieldId: "f-distribute", value: true },
      { fieldId: "f-disinfect", value: true },
      { fieldId: "f-dishes", value: true },
      { fieldId: "f-coffee", value: true },
      { fieldId: "f-fridge", value: true },
      { fieldId: "f-servers", value: ["Server", "Kitchen porter"] },
      { fieldId: "f-appreciation", value: true },
      { fieldId: "f-verify", value: true },
      { fieldId: "f-remind", value: true },
      { fieldId: "f-send", value: true },
      { fieldId: "f-coordinate", value: true },
      { fieldId: "f-schedule", value: true },
      {
        fieldId: "f-problems",
        value: "Disposable utensil supply ran short again toward the end of the month.",
      },
    ],
    history: [
      {
        id: "h1",
        at: `${iso(7, 12)} 14:08`,
        text: "Food preparation marked done",
        actorId: "p-esther",
      },
      {
        id: "h2",
        at: `${iso(7, 12)} 16:22`,
        text: "Stock up cutleries changed to Needs attention",
        actorId: "p-esther",
      },
      { id: "h3", at: `${iso(7, 18)} 09:40`, text: "Record completed", actorId: "p-esther" },
    ],
  },
  {
    id: "rec-victuals-w3",
    formDefinitionId: "frm-victuals-weekly",
    formVersion: 4,
    sections: capturedSections,
    title: "Week of 19 July",
    period: "19–25 July",
    date: iso(7, 19),
    status: "in-progress",
    createdBy: "p-esther",
    createdAt: iso(7, 19),
    updatedAt: iso(7, 20),
    links: [],
    responses: [
      { fieldId: "f-rice", value: true },
      { fieldId: "f-table", value: true },
      { fieldId: "f-plates", value: true },
      { fieldId: "f-cutlery", status: "in-progress" },
      { fieldId: "f-pray", value: true },
    ],
    history: [
      {
        id: "h4",
        at: `${iso(7, 19)} 08:15`,
        text: "Record created from Victuals Weekly Checklist v4",
        actorId: "p-esther",
      },
    ],
  },
];

/* --------------------------------------------------------------- templates */

/**
 * Starting designs, not locked forms. Choosing one creates an editable
 * definition the leader renames and reshapes.
 */

export const definitionById = (id: string) =>
  formDefinitions.find((definition) => definition.id === id);
