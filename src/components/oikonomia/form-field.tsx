import { AlertTriangle, Check, CircleDot, Minus, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { itemStatusLabel, itemStatuses } from "@/domain/forms";
import { useOrganization } from "./organization-provider";
import type { FormField, FormItemStatus, FormResponse } from "@/domain/types";

/**
 * One field, rendered for filling, preview or print.
 *
 * A single component serves all three so a printed checklist cannot drift from
 * the on-screen one. `mode` controls interactivity; the markup and hierarchy
 * stay identical, which is what makes the printed sheet trustworthy.
 */

export type FieldMode = "fill" | "preview" | "print";

const statusIcon: Record<FormItemStatus, typeof Check> = {
  "not-started": Square,
  "in-progress": CircleDot,
  done: Check,
  "needs-attention": AlertTriangle,
  "not-applicable": Minus,
};

const statusTone: Record<FormItemStatus, string> = {
  "not-started": "text-muted-foreground",
  "in-progress": "text-status-info",
  done: "text-status-done",
  "needs-attention": "text-status-overdue",
  "not-applicable": "text-muted-foreground",
};

export function FieldLabel({ field }: { field: FormField }) {
  return (
    <span className="min-w-0">
      <span className="block text-[14px] leading-5">
        {field.label}
        {field.required ? (
          <span className="text-status-overdue" aria-label="required">
            {" "}
            *
          </span>
        ) : null}
      </span>
      {/* Guidance, not another task — quieter and indented under the label. */}
      {field.description ? (
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {field.description}
        </span>
      ) : null}
    </span>
  );
}

export function FormFieldView({
  field,
  response,
  mode,
  onChange,
}: {
  field: FormField;
  response?: FormResponse | undefined;
  mode: FieldMode;
  onChange?: (next: FormResponse, label: string) => void;
}) {
  /* Two lists, deliberately: `people` resolves a name already stored on a
     response, `activePeople` is what a new answer may choose from. */
  const { people, activePeople } = useOrganization();
  const readOnly = mode !== "fill";
  const set = (patch: Partial<FormResponse>, label: string) =>
    onChange?.({ fieldId: field.id, ...response, ...patch }, label);

  /* ---- display-only content ---- */

  if (field.type === "heading") {
    return <h4 className="pt-2 text-[13px] font-medium text-foreground">{field.label}</h4>;
  }

  if (field.type === "instruction") {
    return <p className="text-[13px] leading-relaxed text-muted-foreground">{field.label}</p>;
  }

  /* ---- checkbox: the binder's workhorse ---- */

  if (field.type === "checkbox") {
    const checked = response?.value === true;
    return (
      <div className="space-y-1">
        <label className={cn("flex items-start gap-2.5", !readOnly && "cursor-pointer")}>
          <input
            type="checkbox"
            checked={checked}
            disabled={readOnly}
            onChange={(e) =>
              set(
                { value: e.target.checked },
                `${field.label} ${e.target.checked ? "checked" : "unchecked"}`,
              )
            }
            /* Deliberately larger than a default box: these get tapped on a
               phone in a kitchen, and print needs a visible square. */
            className="mt-0.5 size-[18px] shrink-0 accent-[var(--color-primary)] print:size-4"
          />
          <FieldLabel field={field} />
        </label>
        <ItemNote field={field} response={response} readOnly={readOnly} onSet={set} />
      </div>
    );
  }

  /* ---- status item ---- */

  if (field.type === "status") {
    const current = response?.status ?? "not-started";
    const Icon = statusIcon[current];
    return (
      <div className="space-y-1.5">
        <div className="flex items-start gap-2.5">
          <Icon className={cn("mt-0.5 size-[18px] shrink-0", statusTone[current])} aria-hidden />
          <div className="min-w-0 flex-1">
            <FieldLabel field={field} />
            {readOnly ? (
              <p className={cn("mt-1 text-[12px] font-medium", statusTone[current])}>
                {itemStatusLabel[current]}
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {itemStatuses.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={current === option}
                    onClick={() =>
                      set({ status: option }, `${field.label} set to ${itemStatusLabel[option]}`)
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-[12px] transition-colors",
                      current === option
                        ? "border-primary/40 bg-area-soft font-medium text-area-ink"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {itemStatusLabel[option]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <ItemNote field={field} response={response} readOnly={readOnly} onSet={set} />
      </div>
    );
  }

  /* ---- ordinary response fields ---- */

  const value = response?.value;

  return (
    <div className="space-y-1.5">
      <FieldLabel field={field} />

      {field.type === "long-text" ? (
        readOnly ? (
          <PrintValue value={typeof value === "string" ? value : ""} lines={3} />
        ) : (
          <textarea
            rows={3}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set({ value: e.target.value }, `${field.label} updated`)}
            className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
          />
        )
      ) : null}

      {field.type === "short-text" || field.type === "number" ? (
        readOnly ? (
          <PrintValue value={value === undefined ? "" : String(value)} />
        ) : (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={value === undefined ? "" : String(value)}
            placeholder={field.config?.placeholder ?? ""}
            onChange={(e) => set({ value: e.target.value }, `${field.label} updated`)}
            className="w-full max-w-sm rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
          />
        )
      ) : null}

      {field.type === "date" || field.type === "time" ? (
        readOnly ? (
          <PrintValue value={typeof value === "string" ? value : ""} />
        ) : (
          <input
            type={field.type}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set({ value: e.target.value }, `${field.label} updated`)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
          />
        )
      ) : null}

      {field.type === "single-choice" ? (
        <div className="flex flex-wrap gap-1.5">
          {(field.config?.options ?? []).map((option) => {
            const active = value === option;
            return (
              <button
                key={option}
                type="button"
                disabled={readOnly}
                aria-pressed={active}
                onClick={() => set({ value: option }, `${field.label} set to ${option}`)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[13px] transition-colors",
                  active
                    ? "border-primary/40 bg-area-soft font-medium text-area-ink"
                    : "border-border text-muted-foreground",
                  !readOnly && !active && "hover:bg-muted hover:text-foreground",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}

      {field.type === "multi-choice" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(field.config?.options ?? []).map((option) => {
            const list = Array.isArray(value) ? value : [];
            const active = list.includes(option);
            return (
              <label
                key={option}
                className={cn("flex items-center gap-2 text-[13px]", !readOnly && "cursor-pointer")}
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={readOnly}
                  onChange={() =>
                    set(
                      {
                        value: active ? list.filter((item) => item !== option) : [...list, option],
                      },
                      `${field.label} updated`,
                    )
                  }
                  className="size-4 shrink-0 accent-[var(--color-primary)]"
                />
                {option}
              </label>
            );
          })}
        </div>
      ) : null}

      {field.type === "person" ? (
        readOnly ? (
          <PrintValue
            value={
              typeof value === "string" ? (people.find((p) => p.id === value)?.name ?? value) : ""
            }
          />
        ) : (
          /* Reuses the canonical People records — Forms never keeps its own. */
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set({ value: e.target.value }, `${field.label} updated`)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
          >
            <option value="">Nobody selected</option>
            {activePeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )
      ) : null}
    </div>
  );
}

/** Written beside a checklist row, exactly as people do on paper. */
function ItemNote({
  field,
  response,
  readOnly,
  onSet,
}: {
  field: FormField;
  response?: FormResponse | undefined;
  readOnly: boolean;
  onSet: (patch: Partial<FormResponse>, label: string) => void;
}) {
  if (!field.config?.allowNote) return null;
  const note = response?.note ?? "";

  if (readOnly) {
    if (!note) return null;
    return (
      <p className="ml-7 border-l-2 border-border pl-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {note}
      </p>
    );
  }

  return (
    <input
      value={note}
      placeholder="Add a note"
      aria-label={`Note for ${field.label}`}
      onChange={(e) => onSet({ note: e.target.value }, `Note added to ${field.label}`)}
      className="ml-7 w-[calc(100%-1.75rem)] border-b border-transparent bg-transparent py-0.5 text-[13px] outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus:border-ring"
    />
  );
}

/** A value on screen, or a ruled line to write on when printed blank. */
function PrintValue({ value, lines = 1 }: { value: string; lines?: number }) {
  if (value) {
    return <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{value}</p>;
  }
  return (
    <span aria-hidden className="block space-y-3 pt-1">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="block border-b border-border-strong/60" />
      ))}
    </span>
  );
}
