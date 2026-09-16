import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { ClipboardList, FileText, Plus } from "lucide-react";

import { EmptyState } from "@/components/oikonomia/empty-state";
import { useForms } from "@/components/oikonomia/forms-provider";
import { RecordTally } from "@/components/oikonomia/form-sheet";
import { FilterChip, ListToolbar } from "@/components/oikonomia/list-toolbar";
import { Page, PageHeader } from "@/components/oikonomia/page";
import { Section } from "@/components/oikonomia/section";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formTemplates } from "@/domain/form-templates";
import { allFields, responseFields } from "@/domain/forms";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { useViewer } from "@/domain/session";

export const Route = createFileRoute("/forms/")({
  head: () => ({
    meta: [
      { title: "Forms — Oikonomia" },
      {
        name: "description",
        content: "Ministry forms and checklists: reusable designs, and the records of using them.",
      },
    ],
  }),
  component: FormsLibrary,
});

/**
 * The form library.
 *
 * Two lists that must not be confused: reusable **forms** (the designs) and the
 * **records** of using them. Every action here says which it produces — "Use"
 * makes a record, "Copy" makes another design.
 */
function FormsLibrary() {
  const { ministries } = useOrganization();
  const { definitions, records, recordsFor } = useForms();
  const { person } = useViewer();
  const [query, setQuery] = useState("");
  const [ministryId, setMinistryId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  /* A retired form is not offered for new records; it keeps its own list. */
  const retired = definitions.filter((definition) => !!definition.archivedAt);
  const visible = definitions.filter((definition) => {
    if (definition.archivedAt) return false;
    if (ministryId && definition.ministryId !== ministryId) return false;
    if (!q) return true;
    /* Search reaches into the design: section names and field labels are how a
       leader actually remembers a form. */
    return (
      definition.title.toLowerCase().includes(q) ||
      (definition.description ?? "").toLowerCase().includes(q) ||
      definition.sections.some(
        (section) =>
          (section.title ?? "").toLowerCase().includes(q) ||
          section.fields.some((field) => field.label.toLowerCase().includes(q)),
      )
    );
  });

  const usedMinistries = ministries.filter((m) => definitions.some((d) => d.ministryId === m.id));

  const recent = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  return (
    <Page>
      <PageHeader
        title="Forms"
        description="Build the checklists and forms your ministry actually uses, then fill them, keep the records and print them when you need paper."
        actions={<CreateForm ownerId={person.id} />}
      />

      <ListToolbar query={query} onQuery={setQuery} placeholder="Search forms, sections or fields">
        <FilterChip active={ministryId === null} onClick={() => setMinistryId(null)}>
          All ministries
        </FilterChip>
        {usedMinistries.map((m) => (
          <FilterChip
            key={m.id}
            active={ministryId === m.id}
            onClick={() => setMinistryId(ministryId === m.id ? null : m.id)}
            count={definitions.filter((d) => d.ministryId === m.id).length}
          >
            {m.name}
          </FilterChip>
        ))}
      </ListToolbar>

      <div className="space-y-4">
        <Section title="Forms" meta={`${visible.length}`}>
          {visible.length > 0 ? (
            <ul className="divide-y divide-border">
              {visible.map((definition) => {
                const ministry = ministries.find((m) => m.id === definition.ministryId);
                const count = recordsFor(definition.id).length;

                return (
                  <li key={definition.id} className="row-quiet px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/forms/$formId"
                          params={{ formId: definition.id }}
                          className="block text-[15px] font-medium transition-colors hover:text-primary"
                        >
                          {definition.title}
                        </Link>
                        {definition.description ? (
                          <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">
                            {definition.description}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          {ministry ? `${ministry.name} · ` : ""}v{definition.version} ·{" "}
                          {responseFields(definition.sections).length} fields in{" "}
                          {definition.sections.length} sections
                          {count > 0 ? ` · ${count} ${count === 1 ? "record" : "records"}` : ""}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <UseForm definitionId={definition.id} />
                        <Link
                          to="/forms/$formId"
                          params={{ formId: definition.id }}
                          className="rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors hover:bg-muted"
                        >
                          Edit
                        </Link>
                        <CopyForm definitionId={definition.id} title={definition.title} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={query.trim() || ministryId ? "No forms match that search" : "No forms yet"}
            >
              Create the checklist or form your ministry needs — no programming required.
            </EmptyState>
          )}
        </Section>

        {retired.length > 0 ? (
          <Section title="Retired forms" meta={`${retired.length}`}>
            <p className="border-b border-border px-4 py-2 text-[12px] leading-relaxed text-muted-foreground">
              Deleted after records were made with them. The records are kept; no new ones can be
              started.
            </p>
            <ul className="divide-y divide-border">
              {retired.map((definition) => {
                const count = recordsFor(definition.id).length;
                return (
                  <li key={definition.id} className="row-quiet">
                    <Link
                      to="/forms/$formId"
                      params={{ formId: definition.id }}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
                        {definition.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {count} {count === 1 ? "record" : "records"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {recent.length > 0 ? (
          <Section title="Recent records" meta={`${records.length} total`}>
            <ul className="divide-y divide-border">
              {recent.map((record) => (
                <li key={record.id} className="row-quiet">
                  <Link
                    to="/records/$recordId"
                    params={{ recordId: record.id }}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{record.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {definitions.find((d) => d.id === record.formDefinitionId)?.title ?? "Form"}{" "}
                        · v{record.formVersion}
                        {record.status === "completed" ? " · completed" : ""}
                      </span>
                    </span>
                    <RecordTally record={record} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}

/** Choosing a template creates an editable design — never a locked form. */
function CreateForm({ ownerId }: { ownerId: string }) {
  const { createDefinition } = useForms();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={buttonVariants({ variant: "primary" })}>
        <Plus className="size-3.5" aria-hidden />
        Create form
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
          Start from a template. You can rename and reshape everything afterwards.
        </p>
        <ul className="max-h-80 overflow-y-auto">
          {formTemplates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => {
                  /* Navigate once the form actually exists — the id comes back
                     from the server, not from the browser. */
                  void createDefinition({
                    title: template.id === "tpl-blank" ? "Untitled form" : template.title,
                    sections: structuredClone(template.sections),
                    ownerId,
                  }).then((id) => {
                    setOpen(false);
                    void navigate({ to: "/forms/$formId", params: { formId: id } });
                  });
                }}
                className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex items-center gap-2 text-[14px] font-medium">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {template.title}
                </span>
                <span className="mt-0.5 block pl-[22px] text-[12px] text-muted-foreground">
                  {template.summary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** "Use" makes a record. Distinct wording from "Copy", on purpose. */
function UseForm({ definitionId }: { definitionId: string }) {
  const { createRecord, definitions } = useForms();
  const { person } = useViewer();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const definition = definitions.find((d) => d.id === definitionId);
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");

  if (!definition) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="rounded-md bg-primary px-2.5 py-1 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90">
        Use
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = title.trim() || `${definition.title} — new record`;
            void createRecord(definition.id, {
              title: name,
              createdBy: person.id,
              ...(period ? { period } : {}),
            }).then((id) => {
              setOpen(false);
              setTitle("");
              setPeriod("");
              if (id) void navigate({ to: "/records/$recordId", params: { recordId: id } });
            });
          }}
          className="space-y-2.5"
        >
          <p className="text-[12px] text-muted-foreground">
            This creates a record you can fill in. The form itself is unchanged.
          </p>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">Record name</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Week of 12 July"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">Period — optional</span>
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="12–18 July"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-2.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create record
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** "Copy" makes another design — for a different ministry or a new year. */
function CopyForm({ definitionId, title }: { definitionId: string; title: string }) {
  const { copyForm } = useForms();
  const { person } = useViewer();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${title} (copy)`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors hover:bg-muted",
        )}
      >
        Copy
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void copyForm(definitionId, name.trim() || `${title} (copy)`, person.id).then((id) => {
              setOpen(false);
              if (id) void navigate({ to: "/forms/$formId", params: { formId: id } });
            });
          }}
          className="space-y-2.5"
        >
          <p className="text-[12px] text-muted-foreground">
            This creates another reusable form you can edit separately.
          </p>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">New form name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-ring"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-2.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create copy
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
