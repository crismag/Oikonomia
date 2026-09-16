import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  History,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { FormSheet } from "@/components/oikonomia/form-sheet";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { FormFieldView } from "@/components/oikonomia/form-field";
import { useForms } from "@/components/oikonomia/forms-provider";
import { Page } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/calendar-client";
import {
  duplicateField,
  duplicateSection,
  fieldTypeLabel,
  isContentField,
  move,
  newId,
} from "@/domain/forms";
import { useViewer } from "@/domain/session";
import type { FormDefinition, FormField, FormFieldType, FormSection } from "@/domain/types";
import { formatDate, formatDayMonthShort } from "@/domain/dates";

export const Route = createFileRoute("/forms/$formId")({
  validateSearch: (search: Record<string, unknown>): { mode?: "print" } =>
    search["mode"] === "print" ? { mode: "print" } : {},
  head: () => ({ meta: [{ title: "Form — Oikonomia" }] }),
  component: FormBuilder,
});

const addableTypes: FormFieldType[] = [
  "checkbox",
  "status",
  "short-text",
  "long-text",
  "number",
  "date",
  "time",
  "single-choice",
  "multi-choice",
  "person",
  "heading",
  "instruction",
];

/**
 * The form builder.
 *
 * Edits happen on the canvas — click a field to select it, and its properties
 * appear in the rail. Reordering is by button rather than drag: it works with a
 * keyboard, works on a phone, and cannot half-drop a field into the wrong
 * section, which matters more here than the gesture does.
 *
 * Nothing is saved until Save, which bumps the version. Records already created
 * keep the structure they were made with.
 */
function FormBuilder() {
  const { formId } = Route.useParams();
  const store = useForms();
  const definition = store.definitions.find((d) => d.id === formId);

  /* Absent is not missing while the forms are still loading: opening a form by
     its address used to answer "not found" for one that exists. */
  if (!definition && store.status === "loading") {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (!definition && store.status === "error") {
    return (
      <Page>
        <ErrorState title="This form could not be loaded" onRetry={store.retry}>
          Your forms are safe. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }
  if (!definition) throw notFound();

  return <FormDesigner key={definition.id} definition={definition} />;
}

function FormDesigner({ definition }: { definition: FormDefinition }) {
  const formId = definition.id;
  const { mode } = Route.useSearch();
  const { saveDefinition, renameDefinition, recordsFor, deleteDefinition } = useForms();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<unknown>(null);
  const { person } = useViewer();

  const [sections, setSections] = useState<FormSection[]>(definition.sections);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(definition.title);

  const records = recordsFor(definition.id);
  const selectedField = sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === selected);

  const update = (next: FormSection[]) => {
    setSections(next);
    setDirty(true);
  };

  const patchField = (fieldId: string, patch: Partial<FormField>) =>
    update(
      sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.id === fieldId ? { ...field, ...patch } : field,
        ),
      })),
    );

  /* Print view renders the sheet alone; the stylesheet hides everything else. */
  if (mode === "print") {
    return (
      <div className="px-4 py-6">
        <div data-print="hide" className="mx-auto mb-4 flex max-w-3xl items-center gap-2">
          <Link
            to="/forms/$formId"
            params={{ formId }}
            className={buttonVariants({ variant: "secondary" })}
          >
            Back to the form
          </Link>
          <Button type="button" onClick={() => window.print()} variant="primary">
            <Printer className="size-3.5" aria-hidden />
            Print blank
          </Button>
          <p className="text-[12px] text-muted-foreground">Blank copy, for filling in by hand.</p>
        </div>
        <FormSheet
          title={definition.title}
          subtitle={definition.description}
          ministryId={definition.ministryId}
          sections={definition.sections}
          mode="print"
        />
      </div>
    );
  }

  return (
    <Page>
      <Link
        to="/forms"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        Forms
      </Link>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== definition.title) {
                renameDefinition(definition.id, title.trim());
              }
            }}
            aria-label="Form title"
            className="w-full min-w-0 rounded-md border border-transparent bg-transparent font-display text-[22px] leading-tight outline-none transition-colors hover:border-border focus:border-ring"
          />
          <p className="mt-1 text-[12px] text-muted-foreground">
            Form design · v{definition.version} · updated {formatDate(definition.updatedAt)}
            {records.length > 0
              ? ` · ${records.length} ${records.length === 1 ? "record" : "records"} already created`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
            {(["edit", "preview"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-[13px] capitalize transition-colors",
                  view === option
                    ? "bg-area-soft font-medium text-area-ink"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <Link
            to="/forms/$formId"
            params={{ formId }}
            search={{ mode: "print" as const }}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Printer className="size-3.5" aria-hidden />
            Print blank
          </Link>

          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              saveDefinition(definition.id, sections, "Form design updated", person.id);
              setDirty(false);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              dirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border text-muted-foreground",
            )}
          >
            {dirty ? `Save as v${definition.version + 1}` : "Saved"}
          </button>

          {definition.ownerId === person.id && !definition.archivedAt ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-status-overdue"
            >
              Delete form
            </button>
          ) : null}
        </div>
      </header>

      {definition.archivedAt ? (
        <p className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px] text-muted-foreground">
          This form was retired on {formatDate(definition.archivedAt)}. Its {records.length}{" "}
          {records.length === 1 ? "record is" : "records are"} kept; no new ones can be started.
        </p>
      ) : null}

      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-label="Delete this form?"
          className="mb-3 rounded-md border border-status-overdue/30 bg-surface px-3 py-2.5 text-[13px]"
        >
          <p>
            {records.length > 0
              ? `${records.length} ${records.length === 1 ? "record was" : "records were"} filled in with this form. They are kept: the form is retired instead of deleted, and no new records can be started from it.`
              : "Nothing has been filled in with this form, so it is deleted. There is no undo."}
          </p>
          {deleteFailure ? (
            <p role="alert" className="mt-1 text-status-overdue">
              {errorMessage(deleteFailure)}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void deleteDefinition(definition.id)
                  .then((outcome) => {
                    setConfirmingDelete(false);
                    if (outcome === "deleted") void navigate({ to: "/forms" });
                  })
                  .catch(setDeleteFailure)
              }
            >
              {records.length > 0 ? "Retire the form" : "Delete the form"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {dirty ? (
        <p className="mb-3 rounded-md border border-status-waiting/30 bg-status-waiting-soft px-3 py-2 text-[13px] text-status-waiting">
          Unsaved design changes. They live in this browser tab only — saving keeps them for this
          session, and existing records are unaffected either way.
        </p>
      ) : null}

      {view === "preview" ? (
        <div className="rounded-2xl border border-border bg-surface shadow-card p-5">
          <p className="mb-4 text-[12px] text-muted-foreground">
            This is what someone filling the form will see. Nothing here is saved.
          </p>
          <FormSheet
            title={title}
            subtitle={definition.description}
            ministryId={definition.ministryId}
            sections={sections}
            mode="preview"
          />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Canvas */}
          <div className="min-w-0 space-y-3">
            {sections.map((section, sectionIndex) => (
              <SectionCard
                key={section.id}
                section={section}
                index={sectionIndex}
                total={sections.length}
                selected={selected}
                onSelect={setSelected}
                onPatch={(patch) =>
                  update(sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)))
                }
                onMove={(delta) => update(move(sections, sectionIndex, sectionIndex + delta))}
                onDuplicate={() =>
                  update([
                    ...sections.slice(0, sectionIndex + 1),
                    duplicateSection(section),
                    ...sections.slice(sectionIndex + 1),
                  ])
                }
                onDelete={() => update(sections.filter((s) => s.id !== section.id))}
                onAddField={(type) =>
                  update(
                    sections.map((s) =>
                      s.id === section.id
                        ? {
                            ...s,
                            fields: [
                              ...s.fields,
                              {
                                id: newId("fld"),
                                type,
                                label: defaultLabel(type),
                                ...(type === "single-choice" || type === "multi-choice"
                                  ? { config: { options: ["Option one", "Option two"] } }
                                  : {}),
                                ...(type === "checkbox" || type === "status"
                                  ? { config: { allowNote: true } }
                                  : {}),
                              },
                            ],
                          }
                        : s,
                    ),
                  )
                }
                onFieldMove={(fieldIndex, delta) =>
                  update(
                    sections.map((s) =>
                      s.id === section.id
                        ? { ...s, fields: move(s.fields, fieldIndex, fieldIndex + delta) }
                        : s,
                    ),
                  )
                }
                onFieldDuplicate={(field, fieldIndex) =>
                  update(
                    sections.map((s) =>
                      s.id === section.id
                        ? {
                            ...s,
                            fields: [
                              ...s.fields.slice(0, fieldIndex + 1),
                              duplicateField(field),
                              ...s.fields.slice(fieldIndex + 1),
                            ],
                          }
                        : s,
                    ),
                  )
                }
                onFieldDelete={(fieldId) =>
                  update(
                    sections.map((s) =>
                      s.id === section.id
                        ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) }
                        : s,
                    ),
                  )
                }
              />
            ))}

            <button
              type="button"
              onClick={() =>
                update([...sections, { id: newId("sec"), title: "New section", fields: [] }])
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <Plus className="size-4" aria-hidden />
              Add section
            </button>
          </div>

          {/* Properties */}
          <aside className="space-y-4 lg:sticky lg:top-20">
            {selectedField ? (
              <FieldProperties
                field={selectedField}
                onPatch={(patch) => patchField(selectedField.id, patch)}
              />
            ) : (
              <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
                <h2 className="text-[13px] font-medium">Field properties</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  Select a field on the left to change its label, guidance and options.
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
              <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
                <History className="size-3.5 text-muted-foreground" aria-hidden />
                Version history
              </h2>
              <ol className="mt-2 space-y-2">
                {definition.history.slice(0, 5).map((entry) => (
                  <li key={entry.version} className="text-[12px] leading-snug">
                    <span className="font-medium">v{entry.version}</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {formatDayMonthShort(entry.date)}
                    </span>
                    <span className="block text-muted-foreground">{entry.summary}</span>
                  </li>
                ))}
              </ol>
            </div>

            {records.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
                <h2 className="text-[13px] font-medium">Records</h2>
                <ul className="mt-2 space-y-1.5">
                  {records.map((record) => (
                    <li key={record.id} className="text-[13px]">
                      <Link
                        to="/records/$recordId"
                        params={{ recordId: record.id }}
                        className="transition-colors hover:text-primary"
                      >
                        {record.title}
                      </Link>
                      <span className="block text-[12px] text-muted-foreground">
                        v{record.formVersion} ·{" "}
                        {record.status === "completed" ? "Completed" : "In progress"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  Existing records keep the version they were created with.
                </p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
              <h2 className="text-[13px] font-medium">Owner</h2>
              <p className="mt-1 text-[13px]">
                <PersonName personId={definition.ownerId} />
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                Anyone who can open this ministry can use the form. Changing its design is the
                owner's.
              </p>
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}

function defaultLabel(type: FormFieldType): string {
  if (type === "heading") return "Heading";
  if (type === "instruction") return "Instruction text";
  if (type === "checkbox") return "New item";
  if (type === "status") return "New status item";
  return fieldTypeLabel[type];
}

function SectionCard({
  section,
  index,
  total,
  selected,
  onSelect,
  onPatch,
  onMove,
  onDuplicate,
  onDelete,
  onAddField,
  onFieldMove,
  onFieldDuplicate,
  onFieldDelete,
}: {
  section: FormSection;
  index: number;
  total: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (patch: Partial<FormSection>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddField: (type: FormFieldType) => void;
  onFieldMove: (fieldIndex: number, delta: number) => void;
  onFieldDuplicate: (field: FormField, fieldIndex: number) => void;
  onFieldDelete: (fieldId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <input
            value={section.title ?? ""}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder="Section title"
            aria-label="Section title"
            className="w-full rounded-md border border-transparent bg-transparent text-[14px] font-semibold outline-none transition-colors hover:border-border focus:border-ring"
          />
          <input
            value={section.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            placeholder="Cadence or context — optional"
            aria-label="Section description"
            className="w-full rounded-md border border-transparent bg-transparent text-[13px] text-muted-foreground outline-none transition-colors hover:border-border focus:border-ring"
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Move section up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUp className="size-4" />
          </IconButton>
          <IconButton
            label="Move section down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown className="size-4" />
          </IconButton>
          <IconButton label="Duplicate section" onClick={onDuplicate}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton label="Delete section" destructive onClick={onDelete}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {section.fields.map((field, fieldIndex) => (
          <li
            key={field.id}
            className={cn(
              "group/field flex items-start gap-2 px-3 py-2.5 transition-colors",
              selected === field.id ? "bg-area-soft" : "hover:bg-surface-muted",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(selected === field.id ? null : field.id)}
              className="min-w-0 flex-1 text-left"
            >
              <FormFieldView field={field} mode="preview" />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {fieldTypeLabel[field.type]}
                {field.required ? " · required" : ""}
                {field.config?.reportable ? " · reportable" : ""}
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/field:opacity-100">
              <IconButton
                label="Move field up"
                disabled={fieldIndex === 0}
                onClick={() => onFieldMove(fieldIndex, -1)}
              >
                <ChevronUp className="size-3.5" />
              </IconButton>
              <IconButton
                label="Move field down"
                disabled={fieldIndex === section.fields.length - 1}
                onClick={() => onFieldMove(fieldIndex, 1)}
              >
                <ChevronDown className="size-3.5" />
              </IconButton>
              <IconButton
                label="Duplicate field"
                onClick={() => onFieldDuplicate(field, fieldIndex)}
              >
                <Copy className="size-3.5" />
              </IconButton>
              <IconButton label="Delete field" destructive onClick={() => onFieldDelete(field.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-border px-3 py-2">
        <AddField onAdd={onAddField} />
      </div>
    </section>
  );
}

function AddField({ onAdd }: { onAdd: (type: FormFieldType) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3.5" aria-hidden />
        Add field
      </button>

      {open ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {addableTypes.map((type) => (
            <li key={type}>
              <button
                type="button"
                onClick={() => {
                  onAdd(type);
                  setOpen(false);
                }}
                className="rounded-md border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted"
              >
                {fieldTypeLabel[type]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FieldProperties({
  field,
  onPatch,
}: {
  field: FormField;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const hasOptions = field.type === "single-choice" || field.type === "multi-choice";
  const isItem = field.type === "checkbox" || field.type === "status";

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
      <h2 className="text-[13px] font-medium">Field properties</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{fieldTypeLabel[field.type]}</p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">Label</span>
          <input
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
          />
        </label>

        {!isContentField(field.type) ? (
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Guidance — shown under the label
            </span>
            <textarea
              rows={2}
              value={field.description ?? ""}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder="What you want the person filling this in to know"
              className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>
        ) : null}

        {hasOptions ? (
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Options — one per line
            </span>
            <textarea
              rows={3}
              value={(field.config?.options ?? []).join("\n")}
              onChange={(e) =>
                onPatch({
                  config: {
                    ...field.config,
                    options: e.target.value.split("\n").filter((o) => o.trim() !== ""),
                  },
                })
              }
              className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>
        ) : null}

        {!isContentField(field.type) ? (
          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={field.required ?? false}
                onChange={(e) => onPatch({ required: e.target.checked })}
                className="size-3.5 accent-[var(--color-primary)]"
              />
              Required
            </label>

            {isItem ? (
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={field.config?.allowNote ?? false}
                  onChange={(e) =>
                    onPatch({ config: { ...field.config, allowNote: e.target.checked } })
                  }
                  className="size-3.5 accent-[var(--color-primary)]"
                />
                Allow a note beside this item
              </label>
            ) : null}

            <label className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={field.config?.reportable ?? false}
                onChange={(e) =>
                  onPatch({ config: { ...field.config, reportable: e.target.checked } })
                }
                className="mt-0.5 size-3.5 accent-[var(--color-primary)]"
              />
              <span>
                Offer this answer for reports
                <span className="block text-[12px] text-muted-foreground">
                  Items marked Needs attention are always offered.
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors",
        disabled
          ? "cursor-not-allowed text-disabled"
          : destructive
            ? "hover:bg-muted hover:text-destructive"
            : "hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
