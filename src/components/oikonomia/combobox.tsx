import { useId, useRef, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Free text with structured suggestions.
 *
 * The text is always the leader's to write. Suggestions are offered because
 * most entries are one of a few known things, and choosing one keeps the
 * structured relationship — but typing something the application has never
 * heard of is a first-class outcome, not a fallback.
 *
 * The church's world is larger than what this application models. Anywhere a
 * fixed list would have to be extended by a developer, use this instead.
 */

export interface Suggestion {
  /** Stable id when the text corresponds to a record. Absent for free text. */
  id?: string;
  label: string;
  hint?: string;
  /** Shown above a run of suggestions, e.g. "Ministries". */
  group?: string;
}

export function Combobox({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
  className,
  width = "w-44",
}: {
  /** What is currently written. */
  value: string;
  /** `id` is present only when a suggestion carrying one was chosen. */
  onChange: (text: string, id?: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  label: string;
  className?: string;
  width?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const blurTimer = useRef<number | undefined>(undefined);

  const text = draft ?? value;

  /*
   * Filter on what the leader has *typed*, not on what is already there.
   * Opening a filled field should show the alternatives, not narrow to the
   * value it already holds — otherwise the only way to change it is to clear
   * it first.
   */
  const q = (draft ?? "").trim().toLowerCase();
  const matches = q ? suggestions.filter((s) => s.label.toLowerCase().includes(q)) : suggestions;

  const commit = (suggestion?: Suggestion) => {
    const typed = text.trim();

    /*
     * Text that names a suggestion *is* that suggestion.
     *
     * Without this, blurring the field after choosing from the list committed
     * the label as free text and dropped the id — so a leader who picked
     * "Baronia Residence" and then clicked into the next field was silently
     * left with a venue name attached to no venue, while the field still read
     * "Baronia Residence". Free entry still works: text matching nothing
     * commits with no id, as it should.
     */
    const resolved =
      suggestion ?? suggestions.find((s) => s.label.toLowerCase() === typed.toLowerCase());

    if (resolved) onChange(resolved.label, resolved.id);
    /* Free text: no id, because it corresponds to no record. */
    else onChange(typed, undefined);

    setDraft(null);
    setOpen(false);
  };

  let lastGroup: string | undefined;

  return (
    <div className={cn("relative", className)}>
      <input
        value={text}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          /* Let a click on a suggestion land before closing. */
          blurTimer.current = window.setTimeout(() => {
            commit();
          }, 140);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            window.clearTimeout(blurTimer.current);
            commit(open ? matches[active] : undefined);
          }
          if (e.key === "Escape") {
            setDraft(null);
            setOpen(false);
          }
        }}
        className={cn(
          "rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-ring",
          width,
        )}
      />

      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-md"
        >
          {matches.map((suggestion, i) => {
            const heading = suggestion.group && suggestion.group !== lastGroup;
            lastGroup = suggestion.group;
            return (
              <li key={`${suggestion.id ?? suggestion.label}-${i}`}>
                {heading ? (
                  <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground">
                    {suggestion.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    window.clearTimeout(blurTimer.current);
                    commit(suggestion);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors",
                    i === active ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {suggestion.label}
                    {suggestion.hint ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {suggestion.hint}
                      </span>
                    ) : null}
                  </span>
                  {suggestion.label === value ? (
                    <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
