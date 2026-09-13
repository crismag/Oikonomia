/**
 * What an installation's own policy has switched off — the vocabulary both
 * sides share.
 *
 * The server decides (`src/server/installation/policy.ts`) and enforces. The
 * browser is told, so a screen can say "not in this installation" beside a
 * control instead of letting somebody fill in a form the server will refuse.
 * A screen that forgets to ask changes nothing: the server still refuses.
 */

/** The groups of operations an installation policy can remove. */
export type InstallationRestriction =
  "authentication" | "sessions" | "identity" | "configuration" | "data";

export interface InstallationView {
  /** A public demonstration. */
  demo: boolean;
  /** What is switched off here, for everyone. Empty on an ordinary installation. */
  restricted: InstallationRestriction[];
}

export const ORDINARY_INSTALLATION: InstallationView = { demo: false, restricted: [] };
