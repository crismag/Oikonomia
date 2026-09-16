import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronLeft, ExternalLink, Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notify, useConfirm } from "@/config/messages/handlers";
import {
  CalendarError,
  errorMessage,
  fieldErrors,
  unwrap,
  withTimeout,
} from "@/lib/calendar-client";
import { fetchDocumentRecord, unfileDocument, updateDocument } from "@/lib/documents-api";
import {
  openableUrl,
  placeHref,
  placeName,
  type DocumentPlace,
  type DocumentRecord,
} from "@/domain/document-record";
import { originLabel, relationshipLabel } from "@/domain/registry";
import { sectionLabel } from "@/domain/resources";
import { DriveFileIcon, driveLine, useDriveDetails } from "./drive-details";
import { Page } from "./page";
import { PersonName } from "./person";
import { Section } from "./section";

/** The record behind `/documents/$documentId`, withheld as search withholds it. */
export function useDocumentRecord(id: string) {
  return useQuery<DocumentRecord>({
    queryKey: ["document-record", id],
    queryFn: async () => unwrap(await withTimeout(fetchDocumentRecord({ data: { id } }))),
    /* A document that is not there, or not this viewer's to find, will not
       appear on a second try. */
    retry: (count, error) =>
      !(error instanceof CalendarError && error.code === "not-found") && count < 1,
    networkMode: "always",
  });
}

/**
 * A registered document: a link, or a Drive file.
 *
 * The binder holds a record of it, not the document. So this page says what
 * the record knows — what it is, where it lives, where it is filed, who
 * registered it — and its main act is **Open**, which leaves the binder for
 * wherever the document is kept. Whether it then opens is that place's
 * decision, not this page's.
 *
 * Editing and unfiling change the record only. They are shown to whoever the
 * server allows (`mayEdit`, `mayUnfile` come back with the record) and to no
 * one else.
 */
export function RegisteredDocumentPage({ record }: { record: DocumentRecord }) {
  const { document, places } = record;
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const url = openableUrl(document.url);
  const drive = useDriveDetails(
    record.driveFileId ? [{ id: document.id, driveFileId: record.driveFileId }] : [],
  ).get(document.id);
  const live = driveLine(drive);
  const ministry = places.find((p) => p.entityType === "ministry" && p.entityId && p.label);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["document-record", document.id] });
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void queryClient.invalidateQueries({ queryKey: ["resource-filters"] });
    void queryClient.invalidateQueries({ queryKey: ["filed-documents"] });
    void queryClient.invalidateQueries({ queryKey: ["drive-details"] });
  };

  const unfile = async (place: DocumentPlace) => {
    if (
      !(await confirm("documents.unfile.confirm", {
        title: document.title,
        place: placeName(place),
      }))
    ) {
      return;
    }
    try {
      unwrap(await withTimeout(unfileDocument({ data: { id: place.id } })));
    } catch (error) {
      notify.error("That could not be unfiled.", undefined, errorMessage(error));
      return;
    }
    notify.success(`Unfiled from ${placeName(place)}.`);
    refresh();
  };

  return (
    <Page width="regular">
      {ministry ? (
        <Link
          to="/ministries/$ministryId"
          params={{ ministryId: ministry.entityId }}
          search={{ view: "documents" as const }}
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {ministry.label}
        </Link>
      ) : (
        <Link
          to="/documents"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Documents &amp; Forms
        </Link>
      )}

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight break-words">{document.title}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {document.kind} · {originLabel[document.origin]}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {record.mayEdit && !editing ? (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" aria-hidden />
              Edit details
            </Button>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "primary" })}
            >
              {document.origin === "drive" ? "Open in Drive" : "Open"}
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">, opens in a new tab</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className="space-y-4">
        {editing ? (
          <EditDetails
            record={record}
            onDone={(saved) => {
              setEditing(false);
              if (saved) {
                notify.success("Details saved.");
                refresh();
              }
            }}
          />
        ) : null}

        {document.description ? (
          <p className="max-w-prose whitespace-pre-line text-[14px] leading-relaxed text-foreground/90">
            {document.description}
          </p>
        ) : null}

        <Section title="Where it lives">
          <div className="space-y-2 px-4 py-3 text-[13px]">
            <p className="flex items-center gap-2">
              {drive?.available ? <DriveFileIcon mimeType={drive.file.mimeType} /> : null}
              <span>{originLabel[document.origin]}</span>
            </p>
            {url ? (
              <p className="break-all text-muted-foreground">{url}</p>
            ) : (
              <p className="text-muted-foreground">
                This record has no web address that can be opened.
              </p>
            )}
            {live ? <p className="text-area-ink">In Drive: {live}</p> : null}
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              The binder keeps this record, not the document. Whoever keeps the document decides
              whether it opens for you.
            </p>
          </div>
        </Section>

        <Section title="Filed under" meta={places.length > 0 ? String(places.length) : undefined}>
          {places.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Not filed anywhere. It is still listed in Documents &amp; Forms.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {places.map((place) => (
                <PlaceRow key={place.id} place={place} onUnfile={() => void unfile(place)} />
              ))}
            </ul>
          )}
        </Section>

        <p className="text-[12px] text-muted-foreground">
          Registered by <PersonName personId={document.registeredById} /> on{" "}
          {format(new Date(document.createdAt), "d MMM yyyy")}
          {document.updatedAt !== document.createdAt
            ? ` · details changed ${format(new Date(document.updatedAt), "d MMM yyyy")}`
            : ""}
        </p>
      </div>
    </Page>
  );
}

function PlaceRow({ place, onUnfile }: { place: DocumentPlace; onUnfile: () => void }) {
  const href = placeHref(place);
  const name = [place.label, place.secondaryLabel].filter(Boolean).join(" › ");

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-muted-foreground">
          {sectionLabel[place.section]}
          {place.relationship !== "filed-in" ? ` · ${relationshipLabel[place.relationship]}` : ""}
        </span>
        {href && place.label ? (
          <Link
            to={href.to}
            {...(href.search ? { search: href.search } : {})}
            className="block truncate text-[14px] text-area-ink underline-offset-2 hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="block truncate text-[14px]">{name || "The whole section"}</span>
        )}
      </span>
      {place.mayUnfile ? (
        <button
          type="button"
          onClick={onUnfile}
          className="shrink-0 text-[13px] text-muted-foreground transition-colors hover:text-status-overdue"
        >
          Unfile from {placeName(place)}
        </button>
      ) : null}
    </li>
  );
}

/**
 * The record's details, in place.
 *
 * Metadata only: renaming it here renames the binder's record, never the
 * document in Drive. The address is checked by the same rule the server uses,
 * and the server's refusal, field by field, is what the form shows.
 */
function EditDetails({
  record,
  onDone,
}: {
  record: DocumentRecord;
  onDone: (saved: boolean) => void;
}) {
  const { document } = record;
  const [title, setTitle] = useState(document.title);
  const [kind, setKind] = useState(document.kind);
  const [url, setUrl] = useState(document.url ?? "");
  const [description, setDescription] = useState(document.description ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      unwrap(
        await withTimeout(
          updateDocument({
            data: {
              id: document.id,
              patch: {
                title,
                kind,
                description,
                /* Sent only when changed: a new address is a document that
                   lives somewhere else, and the record is re-read from it. */
                ...(url.trim() !== (document.url ?? "") ? { url } : {}),
              },
            },
          }),
        ),
      );
      onDone(true);
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const movingDriveFile = !!record.driveFileId && url.trim() !== (document.url ?? "");

  return (
    <Section title="Edit details">
      <form onSubmit={(e) => void submit(e)} className="space-y-3 px-4 py-3">
        <Field label="Title" htmlFor="doc-title" error={errors["title"]}>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </Field>
        <Field label="Kind" htmlFor="doc-kind" error={errors["kind"]}>
          <Input
            id="doc-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            maxLength={60}
            required
          />
        </Field>
        <Field label="Web address" htmlFor="doc-url" error={errors["url"]}>
          <Input
            id="doc-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          {movingDriveFile ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              A new address points this record at a different document. What Drive says about the
              old file will no longer be shown here.
            </p>
          ) : null}
        </Field>
        <Field label="Description" htmlFor="doc-description" error={errors["description"]}>
          <Textarea
            id="doc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </Field>
        <p className="text-[12px] text-muted-foreground">
          This changes the binder&apos;s record only. The document itself is not renamed or moved.
        </p>
        {failure ? (
          <p role="alert" className="text-[13px] text-status-overdue">
            {failure}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save details
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1 block text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-status-overdue">
          {error}
        </p>
      ) : null}
    </div>
  );
}
