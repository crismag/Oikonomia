import { cn } from "@/lib/utils";
import { isContentField, recordTally, responseFor } from "@/domain/forms";
import { useOrganization } from "./organization-provider";
import { FormFieldView, type FieldMode } from "./form-field";
import type { FormRecord, FormResponse, FormSection } from "@/domain/types";

/**
 * The form as a document.
 *
 * Used for filling, previewing and printing, so what a leader sees on screen is
 * what comes out of the printer. Sections are ruled groups rather than cards:
 * the paper original is dense, and density is what makes it usable mid-service.
 */
export function FormSheet({
  title,
  subtitle,
  ministryId,
  sections,
  mode,
  record,
  onChange,
}: {
  title: string;
  subtitle?: string | undefined;
  ministryId?: string | undefined;
  sections: FormSection[];
  mode: FieldMode;
  record?: FormRecord | undefined;
  onChange?: (response: FormResponse, label: string) => void;
}) {
  const { ministries } = useOrganization();
  const ministry = ministries.find((m) => m.id === ministryId);

  return (
    <article data-print="sheet" className="mx-auto max-w-3xl">
      <header className="border-b border-border-strong pb-3">
        {ministry ? (
          <p className="text-[12px] font-medium tracking-wide text-muted-foreground">
            {ministry.name}
          </p>
        ) : null}
        <h1 className="mt-0.5 font-display text-[22px] leading-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </header>

      <div className="divide-y divide-border">
        {sections.map((section) => (
          <section key={section.id} data-print="section" className="py-4">
            {section.title || section.description ? (
              <header className="mb-2.5">
                {section.title ? (
                  <h2 className="text-[13px] font-semibold tracking-wide">{section.title}</h2>
                ) : null}
                {section.description ? (
                  <p className="text-[13px] text-muted-foreground">{section.description}</p>
                ) : null}
              </header>
            ) : null}

            {section.fields.length > 0 ? (
              <ul className="space-y-2.5">
                {section.fields.map((field) => (
                  <li key={field.id} className={cn(isContentField(field.type) && "pt-0.5")}>
                    <FormFieldView
                      field={field}
                      mode={mode}
                      response={record ? responseFor(record, field.id) : undefined}
                      {...(onChange ? { onChange } : {})}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No fields in this section yet.</p>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}

/**
 * A record's standing, as a tally rather than a percentage.
 *
 * "31 done · 1 needs attention" tells a leader what to do next; "94%" does not.
 */
export function RecordTally({ record, className }: { record: FormRecord; className?: string }) {
  const tally = recordTally(record);

  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]", className)}>
      <span className="text-status-done">{tally.done} done</span>
      {tally.attention > 0 ? (
        <span className="text-status-overdue">{tally.attention} needs attention</span>
      ) : null}
      {tally.outstanding > 0 ? (
        <span className="text-muted-foreground">{tally.outstanding} outstanding</span>
      ) : null}
      {tally.notApplicable > 0 ? (
        <span className="text-muted-foreground">{tally.notApplicable} N/A</span>
      ) : null}
    </span>
  );
}
