import { useCallback, useRef, useState } from "react";

/**
 * Focus restoration for state-controlled overlays.
 *
 * Radix restores focus to a `SheetTrigger`, but much of Oikonomia opens sheets
 * from state — a calendar entry, a row, a menu item — where the thing that
 * opened the overlay is not the thing that renders it. Radix has no trigger to
 * return to, so focus lands on the page wrapper and a keyboard user is dumped
 * at the top of the document.
 *
 * This remembers what had focus when the overlay opened and puts it back,
 * whichever way the overlay closed: Escape, the close button, the overlay
 * click, or a save that closes it.
 *
 * ```tsx
 * const detail = useOverlay<ScheduleOccurrence>();
 * <button onClick={() => detail.open(occurrence)}>…</button>
 * <Sheet open={detail.isOpen} onOpenChange={detail.onOpenChange}>
 * ```
 */
export interface Overlay<T> {
  /** What the overlay is showing. `null` when closed. */
  value: T | null;
  isOpen: boolean;
  open: (value: T) => void;
  close: () => void;
  /** Pass straight to a Radix `onOpenChange`. */
  onOpenChange: (open: boolean) => void;
}

export function useOverlay<T>(): Overlay<T> {
  const [value, setValue] = useState<T | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((next: T) => {
    /*
     * Captured before the overlay mounts, because mounting moves focus and by
     * then the original element is no longer `document.activeElement`.
     */
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
    setValue(next);
  }, []);

  const close = useCallback(() => {
    setValue(null);
    const target = opener.current;
    opener.current = null;
    if (!target) return;
    /*
     * After the overlay has unmounted and Radix has finished its own focus
     * handling, or the two fight and Radix wins.
     */
    requestAnimationFrame(() => {
      if (target.isConnected) target.focus();
    });
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close();
    },
    [close],
  );

  return { value, isOpen: value !== null, open, close, onOpenChange };
}
