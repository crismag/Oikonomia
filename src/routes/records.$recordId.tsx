import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Check, ChevronLeft, History, Printer, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { FormSheet, RecordTally } from "@/components/oikonomia/form-sheet";
import { DetailSkeleton, ErrorState } from "@/components/oikonomia/async-state";
import { useForms } from "@/components/oikonomia/forms-provider";
import { Page } from "@/components/oikonomia/page";
import { PersonName } from "@/components/oikonomia/person";
import { cn } from "@/lib/utils";
import { reportableFromRecords } from "@/domain/forms";
import { fromISO } from "@/domain/schedule";
import { useViewer } from "@/domain/session";
import { format } from "date-fns";

export const Route = createFileRoute("/records/$recordId")({
  validateSearch: (search: Record<string, unknown>): { mode?: "print" } =>
    search["mode"] === "print" ? { mode: "print" } : {},
  head: () => ({ meta: [{ title: "Record — Oikonomia" }] }),
  component: RecordPage,
});

/**
 * A filled form record.
 *
 * This is what happened, preserved. It renders the structure captured when the
 * record was created, so editing the master afterwards never rewrites history.
 * Ticking an item changes only this record.
 */
function RecordPage() {
  const { recordId } = Route.useParams();
  const { mode } = Route.useSearch();
  const store = useForms();
  const { records, definitions, setResponse, completeRecord, reopenRecord } = store;
  const { person } = useViewer();

  const record = records.find((r) => r.id === recordId);
  /* Absent is not missing while the forms are still loading. */
  if (!record && store.status === "loading") {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }
  if (!record && store.status === "error") {
    return (
      <Page>
        <ErrorState title="This record could not be loaded" onRetry={store.retry}>
          Your records are safe. This is a problem reaching them.
        </ErrorState>
      </Page>
    );
  }
  if (!record) throw notFound();

  const definition = definitions.find((d) => d.id === record.formDefinitionId);
  const stale = definition ? definition.version > record.formVersion : false;
  const reportable = reportableFromRecords([record]);
  const completed = record.status === "completed";

  const subtitle = [record.period, record.date ? format(fromISO(record.date), "d MMMM yyyy") : null]
    .filter(Boolean)
    .join(" · ");

  if (mode === "print") {
    return (
      <div className="px-4 py-6">
        <div data-print="hide" className="mx-auto mb-4 flex flex-wrap items-center gap-2">
          <Link
            to="/records/$recordId"
            params={{ recordId }}
            className={buttonVariants({ variant: "secondary" })}
          >
            Back to the record
          </Link>
          <Button type="button" onClick={() => window.print()} variant="primary">
            <Printer className="size-3.5" aria-hidden />
            Print this record
          </Button>
          <p className="text-[12px] text-muted-foreground">
            Prints with everything as it currently stands.
          </p>
        </div>
        <FormSheet
          title={record.title}
          subtitle={subtitle}
          ministryId={definition?.ministryId}
          sections={record.sections}
          mode="print"
          record={record}
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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_264px]">
        <div className="min-w-0">
          {stale ? (
            <p className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px] text-muted-foreground">
              This record was created from v{record.formVersion}. The form has since been updated to
              v{definition?.version} — this record keeps the version it was filled under.
            </p>
          ) : null}

          <div className="rounded-lg border border-border bg-surface p-5">
            <FormSheet
              title={record.title}
              subtitle={subtitle}
              ministryId={definition?.ministryId}
              sections={record.sections}
              mode={completed ? "preview" : "fill"}
              record={record}
              onChange={(response, label) => setResponse(record.id, response, label, person.id)}
            />
          </div>

          {completed ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Completed
              {record.completedAt ? ` ${format(fromISO(record.completedAt), "d MMMM yyyy")}` : ""}.
              Reopen it to make changes.
            </p>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-[13px] font-medium">Standing</h2>
            <RecordTally record={record} className="mt-1.5" />
            <p className="mt-2 text-[12px] text-muted-foreground">
              {definition ? (
                <Link
                  to="/forms/$formId"
                  params={{ formId: definition.id }}
                  className="transition-colors hover:text-primary"
                >
                  {definition.title}
                </Link>
              ) : (
                "Form"
              )}{" "}
              · v{record.formVersion}
            </p>

            <div className="mt-3 space-y-1.5">
              {completed ? (
                <button
                  type="button"
                  onClick={() => reopenRecord(record.id, person.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  Reopen record
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => completeRecord(record.id, person.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
                >
                  <Check className="size-3.5 shrink-0 text-status-done" aria-hidden />
                  Mark completed
                </button>
              )}

              <Link
                to="/records/$recordId"
                params={{ recordId }}
                search={{ mode: "print" as const }}
                className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
              >
                <Printer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                Print this record
              </Link>
            </div>
          </div>

          {reportable.length > 0 ? (
            <div className="rounded-lg border border-status-overdue/25 bg-status-overdue-soft p-4">
              <h2 className="text-[13px] font-medium">Worth reporting</h2>
              <ul className="mt-2 space-y-2">
                {reportable.map((item) => (
                  <li key={item.id} className="text-[13px] leading-relaxed">
                    {item.text}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Offered on the Reports page. Nothing is added to a report unless you choose it.
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
              <History className="size-3.5 text-muted-foreground" aria-hidden />
              History
            </h2>
            <ol className="mt-2 space-y-2">
              {record.history.slice(0, 6).map((entry) => (
                <li key={entry.id} className="text-[12px] leading-snug">
                  <span className={cn("block")}>{entry.text}</span>
                  <span className="block text-muted-foreground">
                    {entry.actorId ? <PersonName personId={entry.actorId} /> : null}
                    {entry.actorId ? " · " : ""}
                    {entry.at}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </Page>
  );
}
