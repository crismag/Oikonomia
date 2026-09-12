import type { FormField, FormSection } from "./types";

/**
 * Starting structures for a new form.
 *
 * **Product configuration, not data.** These are what Oikonomia offers as a
 * starting point when somebody creates a form — the same kind of thing as the
 * field types or the entry categories. Nobody's answers are here, no ministry
 * is named, and nothing in this file is a record anybody entered.
 *
 * A template is copied at the moment of creation and never referred to again,
 * so editing one has no effect on any form already made from it.
 */

const check = (id: string, label: string, description?: string): FormField => ({
  id,
  type: "checkbox",
  label,
  ...(description ? { description } : {}),
  config: { allowNote: true },
});

const section = (
  id: string,
  title: string,
  description: string | undefined,
  fields: FormField[],
): FormSection => ({ id, title, ...(description ? { description } : {}), fields });

export interface FormTemplate {
  id: string;
  title: string;
  summary: string;
  sections: FormSection[];
}

export const formTemplates: FormTemplate[] = [
  {
    id: "tpl-blank",
    title: "Blank form",
    summary: "Start with one empty section.",
    sections: [{ id: "sec-1", title: "Section", fields: [] }],
  },
  {
    id: "tpl-checklist",
    title: "Weekly checklist",
    summary: "Day-by-day operational checklist, like the Victuals sheet.",
    sections: [
      section("sec-1", "Sunday", "Before service", [
        check("f-1", "First task"),
        check("f-2", "Second task"),
      ]),
      section("sec-2", "During the week", undefined, [check("f-3", "Midweek task")]),
    ],
  },
  {
    id: "tpl-attendance",
    title: "Attendance",
    summary: "Date, headcount, who recorded it, and notes.",
    sections: [
      section("sec-1", "Attendance", undefined, [
        { id: "f-1", type: "date", label: "Date", required: true },
        { id: "f-2", type: "number", label: "Present", required: true },
        { id: "f-3", type: "number", label: "Guests" },
        { id: "f-4", type: "person", label: "Recorded by" },
        { id: "f-5", type: "long-text", label: "Notes" },
      ]),
    ],
  },
  {
    id: "tpl-report",
    title: "Ministry report",
    summary: "Period, summary, numbers and concerns for leadership.",
    sections: [
      section("sec-1", "Period", undefined, [
        { id: "f-1", type: "short-text", label: "Month" },
        { id: "f-2", type: "person", label: "Reported by" },
      ]),
      section("sec-2", "This period", undefined, [
        { id: "f-3", type: "long-text", label: "Summary", config: { reportable: true } },
        { id: "f-4", type: "long-text", label: "Concerns", config: { reportable: true } },
      ]),
    ],
  },
  {
    id: "tpl-schedule",
    title: "Volunteer schedule",
    summary: "Who is serving, when, and in what role.",
    sections: [
      section("sec-1", "Schedule", "One entry per serving slot.", [
        { id: "f-1", type: "date", label: "Date" },
        { id: "f-2", type: "time", label: "Call time" },
        { id: "f-3", type: "person", label: "Assigned volunteer" },
        {
          id: "f-4",
          type: "single-choice",
          label: "Role",
          config: { options: ["Server", "Kitchen porter", "Coordinator"] },
        },
      ]),
    ],
  },
  {
    id: "tpl-event",
    title: "Event preparation",
    summary: "Setup, materials and follow-up for a one-off event.",
    sections: [
      section("sec-1", "Before", undefined, [
        check("f-1", "Confirm venue"),
        check("f-2", "Confirm volunteers"),
      ]),
      section("sec-2", "On the day", undefined, [check("f-3", "Set up")]),
      section("sec-3", "After", undefined, [
        {
          id: "f-4",
          type: "long-text",
          label: "What to do differently",
          config: { reportable: true },
        },
      ]),
    ],
  },
];
