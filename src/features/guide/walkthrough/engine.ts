/**
 * Walkthrough progress, as pure state transitions.
 *
 * Walkthroughs are data; this only knows where the reader is in one. The panel
 * renders the step and asks the host to navigate when the step has a
 * destination.
 */

export interface WalkthroughProgress {
  id: string;
  /** Zero-based. */
  step: number;
  total: number;
  completed: boolean;
}

export type WalkthroughMove = "next" | "back" | "restart";

export function startWalkthrough(id: string, total: number): WalkthroughProgress {
  return { id, step: 0, total: Math.max(total, 0), completed: total === 0 };
}

export function moveWalkthrough(
  progress: WalkthroughProgress,
  move: WalkthroughMove,
): WalkthroughProgress {
  switch (move) {
    case "restart":
      return startWalkthrough(progress.id, progress.total);
    case "back":
      return { ...progress, step: Math.max(progress.step - 1, 0), completed: false };
    case "next":
      if (progress.step >= progress.total - 1) return { ...progress, completed: true };
      return { ...progress, step: progress.step + 1 };
  }
}

/** "2 of 5", for sighted readers and screen readers alike. */
export const stepLabel = (progress: WalkthroughProgress) =>
  `Step ${Math.min(progress.step + 1, progress.total)} of ${progress.total}`;
