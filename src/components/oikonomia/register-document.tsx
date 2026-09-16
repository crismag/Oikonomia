import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/oikonomia/combobox";
import { useRegistry, type RegistryInput } from "@/components/oikonomia/documents-provider";
import { errorMessage, fieldErrors } from "@/lib/calendar-client";
import { useOrganization } from "./organization-provider";
import { originForUrl, originLabel } from "@/domain/registry";

/**
 * Telling the binder about a resource.
 *
 * What a leader is doing here is **registering**, not uploading. The document
 * stays where it is; the binder records that it exists, what it is called and
 * where it takes part, so that somebody looking for it in six months finds it
 * from the ministry rather than from a memory of which Drive folder it was in.
 *
 * The form says so in as many words, because "Add document" beside a web
 * address would read like the file was being taken into the binder.
 *
 * Uploading a file is deliberately not offered. The binder cannot store one
 * yet, and a control that looked like it could would be a promise the system
 * does not keep.
 */

const kinds = [
  "Document",
  "Spreadsheet",
  "Plan",
  "Report",
  "Checklist",
  "Schedule",
  "Announcement",
  "Link",
];

export function RegisterDocument({
  onDone,
  ministryId: fileUnder,
  from = "link",
}: {
  onDone: () => void;
  /** Opened from a ministry: filed there unless the leader changes it. */
  ministryId?: string;
  /**
   * Where the leader said it lives. Only the wording changes — a Drive
   * document is registered by its address like any other, and nothing here
   * connects to Drive.
   */
  from?: "link" | "drive";
}) {
  const { ministries } = useOrganization();
  const registry = useRegistry();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState(from === "drive" ? "Document" : "Link");
  const [description, setDescription] = useState("");
  const [ministryId, setMinistryId] = useState<string | undefined>(fileUnder);
  const [touched, setTouched] = useState(false);

  const problems = fieldErrors(registry.saveError);
  const missing = !title.trim() || !url.trim();

  const save = async () => {
    setTouched(true);
    if (missing) return;

    const input: RegistryInput = {
      title: title.trim(),
      url: url.trim(),
      kind,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(ministryId ? { associations: [{ entityType: "ministry", entityId: ministryId }] } : {}),
    };

    try {
      await registry.register(input);
      onDone();
    } catch {
      /* Kept on screen with what they typed. The message is rendered below. */
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface px-5 py-5">
      <div>
        <h2 className="text-[15px] font-medium">
          {from === "drive" ? "Add a document from Drive" : "Register a document"}
        </h2>
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          The binder records what the document is and where it lives. The document itself stays
          where it is — nothing is copied here, and whoever keeps it still decides who may open it.
        </p>
        {from === "drive" ? (
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Oikonomia does not connect to Google Drive. Copy the document&apos;s link from Drive and
            paste it below; Drive&apos;s own sharing still decides who can open it.
          </p>
        ) : null}
      </div>

      <Field
        label="What is it called?"
        error={
          touched && !title.trim() ? "Give it a name you would look for it by." : problems["title"]
        }
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="September planning sheet"
          className="w-full rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      <Field
        label="Where is it?"
        error={
          touched && !url.trim()
            ? "The binder needs the address to find it again."
            : problems["url"]
        }
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={from === "drive" ? "https://drive.google.com/…" : "https://…"}
          className="w-full rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-[14px] outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
        {/* Read off the address and nothing more: the binder has not opened it,
            checked it exists, or connected to anything. */}
        {url.trim() ? (
          <span className="mt-1 block text-[12px] text-muted-foreground">
            Filed as {originLabel[originForUrl(url.trim())]}. Opening it will go there.
          </span>
        ) : null}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What kind of thing is it?">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-[14px] outline-none focus:border-border-strong"
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Which ministry does it belong to?">
          <Combobox
            label=""
            value={ministries.find((m) => m.id === ministryId)?.name ?? ""}
            placeholder="No particular ministry"
            width="w-full"
            suggestions={ministries.map((m) => ({ id: m.id, label: m.name }))}
            onChange={(text, id) => setMinistryId(id ?? (text ? ministryId : undefined))}
          />
        </Field>
      </div>

      <Field label="Anything worth saying about it?">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What it is for, or what someone would need to know before opening it."
          className="w-full resize-y rounded-md border border-border bg-surface-muted px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      {registry.saveError ? (
        <p role="alert" className="text-[13px] text-status-overdue">
          {errorMessage(registry.saveError)}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void save()}
          disabled={registry.saving}
          busy={registry.saving}
        >
          Register document
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined | false;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-status-overdue">{error}</span> : null}
    </label>
  );
}
