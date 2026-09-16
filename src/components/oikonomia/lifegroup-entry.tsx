import { useState } from "react";
import { Lock, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/oikonomia/combobox";
import { PersonName } from "@/components/oikonomia/person";
import { errorMessage, fieldErrors } from "@/lib/calendar-client";
import { useLifegroup } from "@/components/oikonomia/lifegroup-provider";
import { cn } from "@/lib/utils";
import { useOrganization } from "./organization-provider";
import {
  DEFAULT_VISIBILITY,
  entryCategories,
  entryCategoryLabel,
  namedReaders,
  namesItsReaders,
  readableEntries,
  visibilityLabel,
  visibilityOf,
  withheldCount,
} from "@/domain/lifegroup";
import { format } from "date-fns";
import { config } from "@/config";
import type { EntryVisibility, LifegroupEntry, LifegroupEntryCategory } from "@/domain/types";

/**
 * A recorded entry.
 *
 * The category is a quiet label, not a badge: a page of entries where every
 * line shouts its classification reads as a tracker. An uncategorized entry
 * renders identically minus the label, because it is just as valid.
 */

const categoryTone: Partial<Record<LifegroupEntryCategory, string>> = {
  prayer: "text-status-approval",
  concern: "text-status-overdue",
  "follow-up": "text-status-waiting",
  visitor: "text-status-info",
  decision: "text-status-done",
};

type ReadContext = { isLeader: boolean; isAssignedLeader: boolean };

export function EntryItem({
  entry,
  onRemove,
  showAuthor = true,
}: {
  entry: LifegroupEntry;
  onRemove?: (() => void) | undefined;
  showAuthor?: boolean;
}) {
  const { personById } = useOrganization();
  const author = personById(entry.authorId);
  const time = entry.createdAt.includes("T") ? format(new Date(entry.createdAt), "h:mm a") : "";
  const visibility = visibilityOf(entry);

  return (
    <li className="group/entry flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {entry.category ? (
            <p
              className={cn(
                "text-[12px] font-medium",
                categoryTone[entry.category] ?? "text-muted-foreground",
              )}
            >
              {entryCategoryLabel[entry.category]}
            </p>
          ) : null}

          {/* Stated only when it is narrower than the ordinary case. */}
          {visibility !== DEFAULT_VISIBILITY ? (
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              {visibilityLabel[visibility]}
              {/* Who it is shared with is only this entry's readers' business,
                  and every reader of it is one of them. */}
              {namesItsReaders(visibility) && entry.viewerIds?.length ? (
                <span>
                  {" · "}
                  {entry.viewerIds.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <PersonName personId={id} />
                    </span>
                  ))}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <p className="text-[14px] leading-relaxed">{entry.body}</p>

        {showAuthor ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {author?.name ?? "Unknown"}
            {time ? ` · ${time}` : ""}
            {entry.completed ? " · done" : ""}
          </p>
        ) : null}
      </div>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove entry"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/entry:opacity-100"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The entries for one gathering that this viewer may read.
 *
 * Filtering happens in the domain, before anything renders, so a restricted
 * line cannot leak through a preview, a count or a printed page. What the
 * viewer cannot see is acknowledged as a number — silence would misrepresent
 * the gathering.
 */
export function LifegroupEntryList({
  gatheringId,
  viewerId,
  context,
}: {
  gatheringId: string;
  viewerId: string;
  context: ReadContext;
}) {
  const store = useLifegroup();
  const visible = readableEntries(store.entries, gatheringId, viewerId, context);
  const hidden = withheldCount(store.entries, gatheringId, viewerId, context);

  if (visible.length === 0 && hidden === 0) {
    return (
      <p className="px-4 py-3 text-[13px] text-muted-foreground">
        Nothing written down yet. Anything worth remembering goes here.
      </p>
    );
  }

  return (
    <div className="px-4">
      <ul className="divide-y divide-border">
        {visible.map((entry) => (
          <EntryItem
            key={entry.id}
            entry={entry}
            /* Only whoever wrote it, which is the server's rule too. Leading the
               gathering does not make somebody else's words yours to remove. */
            onRemove={entry.authorId === viewerId ? () => store.removeEntry(entry.id) : undefined}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="flex items-center gap-1.5 border-t border-border py-2.5 text-[12px] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {hidden} {hidden === 1 ? "entry is" : "entries are"} held to a smaller audience.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The audience choices this church offers, asked at render.
 *
 * A static list of four was a second copy of something the registry owns, so
 * an added choice appeared on the administration screen and nowhere a leader
 * could pick it.
 */
const visibilityOptions = (): EntryVisibility[] =>
  config.options("lifegroup.entryVisibility").map((option) => option.id);

/**
 * Writing an entry.
 *
 * One box and a button. Category and audience are offered underneath and both
 * default to something sensible, so recording a line is faster than deciding
 * how to file it.
 */
export function NewEntry({ gatheringId, authorId }: { gatheringId: string; authorId: string }) {
  const store = useLifegroup();
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<LifegroupEntryCategory | null>(null);
  const [visibility, setVisibility] = useState<EntryVisibility>(DEFAULT_VISIBILITY);
  const [readers, setReaders] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const { activePeople } = useOrganization();

  const naming = namesItsReaders(visibility);
  const chosen = namedReaders(readers, authorId);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    /* Said here rather than after a round trip; the server refuses it too. */
    if (naming && chosen.length === 0) {
      setFailure("Name at least one person who may read this.");
      return;
    }
    setFailure(null);
    try {
      await store.addEntry({
        gatheringId,
        authorId,
        body: text,
        ...(category ? { category } : {}),
        ...(visibility !== DEFAULT_VISIBILITY ? { visibility } : {}),
        ...(naming ? { viewerIds: chosen } : {}),
      });
      setBody("");
      setCategory(null);
      setVisibility(DEFAULT_VISIBILITY);
      setReaders([]);
    } catch (error) {
      /* What was written stays in the box, so nothing is lost to a refusal. */
      setFailure(Object.values(fieldErrors(error))[0] ?? errorMessage(error));
    }
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-start gap-2">
        <Plus className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={body ? 3 : 1}
          placeholder="Add an entry"
          className="min-h-9 w-full resize-y bg-transparent py-1 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </div>

      {body.trim() ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-6">
          <div className="flex flex-wrap gap-1">
            {entryCategories.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(category === option ? null : option)}
                aria-pressed={category === option}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] transition-colors",
                  category === option
                    ? "bg-area-soft font-medium text-area-ink"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {entryCategoryLabel[option]}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="sr-only">Who can read this entry</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as EntryVisibility)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] outline-none"
            >
              {visibilityOptions().map((option) => (
                <option key={option} value={option}>
                  {visibilityLabel[option]}
                </option>
              ))}
            </select>
          </label>

          <Button type="button" onClick={() => void submit()} variant="primary">
            Add
          </Button>

          {naming ? (
            <div className="w-full">
              <p className="mb-1 text-[12px] text-muted-foreground">Who may read this</p>
              {chosen.length > 0 ? (
                <ul className="mb-1.5 flex flex-wrap gap-1.5">
                  {chosen.map((id) => (
                    <li
                      key={id}
                      className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1 text-[13px]"
                    >
                      <PersonName personId={id} />
                      <button
                        type="button"
                        onClick={() => setReaders((current) => current.filter((x) => x !== id))}
                        aria-label="Remove this reader"
                        className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Combobox
                key={pickerKey}
                label="Add a reader"
                value=""
                placeholder="Add someone from People…"
                width="w-full"
                suggestions={activePeople
                  .filter((p) => p.id !== authorId && !chosen.includes(p.id))
                  .map((p) => ({ id: p.id, label: p.name, ...(p.role ? { hint: p.role } : {}) }))}
                onChange={(_text, id) => {
                  /* Only somebody in People can be a reader; a typed name is nobody. */
                  if (id) {
                    setReaders((current) => [...current, id]);
                    setFailure(null);
                  }
                  setPickerKey((key) => key + 1);
                }}
              />
            </div>
          ) : null}

          {failure ? (
            <p role="alert" className="w-full text-[12px] text-status-overdue">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
