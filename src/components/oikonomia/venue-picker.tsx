import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Combobox } from "@/components/oikonomia/combobox";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { addVenue } from "@/lib/organization-api";
import { errorMessage, fieldErrors, unwrap, withTimeout } from "@/lib/calendar-client";
import { venueTypeLabel } from "@/domain/types";
import type { Venue } from "@/domain/types";

/**
 * Choosing where a gathering meets — or naming a place for the first time.
 *
 * A venue is operational, not administrative (`organization-service.ts`): a
 * leader arranging next Thursday at somebody's home should not have to ask an
 * administrator to name the home first. So a name that matches no venue is
 * offered as a new one, and only an explicit press creates it. Typing alone
 * never does — a half-typed name is not a place.
 */
export function VenuePicker({
  venueId,
  onChoose,
  label = "Venue",
  placeholder = "Where?",
  width = "w-full",
  disabled = false,
}: {
  venueId: string | undefined;
  /** Called with a venue id when one is chosen, or undefined when the field is cleared. */
  onChoose: (venueId: string | undefined) => void;
  label?: string;
  placeholder?: string;
  width?: string;
  disabled?: boolean;
}) {
  const { venues } = useOrganization();
  const queryClient = useQueryClient();
  const current = venues.find((venue) => venue.id === venueId);

  /* What the field shows once the leader has typed something of their own. */
  const [text, setText] = useState<string | null>(null);
  const [unknownName, setUnknownName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const create = async (name: string) => {
    setBusy(true);
    setFailure(null);
    try {
      const venue = unwrap(await withTimeout(addVenue({ data: { name } }))) as Venue;
      /* The directory is re-read before the choice lands, so the new venue has
         a name to show wherever the gathering is listed. */
      await queryClient.invalidateQueries({ queryKey: ["organization"] });
      setUnknownName(null);
      setText(null);
      onChoose(venue.id);
    } catch (error) {
      setFailure(Object.values(fieldErrors(error))[0] ?? errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0">
      <Combobox
        label={label}
        value={text ?? current?.name ?? ""}
        placeholder={placeholder}
        width={width}
        suggestions={venues.map((venue) => ({
          id: venue.id,
          label: venue.name,
          ...(venue.area ? { hint: venue.area } : {}),
          group: venueTypeLabel[venue.type],
        }))}
        onChange={(typed, id) => {
          setFailure(null);
          if (id) {
            setText(null);
            setUnknownName(null);
            if (id !== venueId) onChoose(id);
            return;
          }
          const name = typed.trim();
          setText(name);
          setUnknownName(name || null);
          if (!name) onChoose(undefined);
        }}
      />

      {unknownName && !disabled ? (
        <button
          type="button"
          disabled={busy}
          /* Keeps focus in the field: its blur would commit the typed name
             again after the venue exists, and offer to add it a second time. */
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void create(unknownName)}
          className="mt-1 inline-flex items-center gap-1 text-left text-[12px] text-primary underline-offset-2 hover:underline disabled:opacity-60"
        >
          <Plus className="size-3 shrink-0" aria-hidden />
          {busy ? "Adding…" : `Add “${unknownName}” as a new venue`}
        </button>
      ) : null}

      {failure ? (
        <p role="alert" className="mt-1 text-[12px] text-status-overdue">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
