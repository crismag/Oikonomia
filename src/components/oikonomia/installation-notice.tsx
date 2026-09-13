import { Lock } from "lucide-react";

import { useAuth } from "@/components/oikonomia/auth-provider";
import type { InstallationRestriction } from "@/domain/installation";
import { cn } from "@/lib/utils";

/**
 * Saying, beside a control, that this installation has switched it off.
 *
 * The control stays on screen so a visitor can see that Oikonomia does this;
 * it is disabled, and this line says why, so nobody fills in a form the server
 * will refuse. Missing a control here costs nothing in safety — the server
 * refuses it anyway — only in clarity.
 */

/** Whether this installation's policy switches the given group of operations off. */
export function useInstallationRestricted(restriction: InstallationRestriction): boolean {
  const { installation } = useAuth();
  return installation.restricted.includes(restriction);
}

const WHAT: Record<InstallationRestriction, string> = {
  authentication: "Signing in with credentials is",
  sessions: "Signing other devices out is",
  identity: "Adding people and editing who they are — name, email, access role — is",
  configuration: "Changing configuration is",
  data: "Backups, exports, retention and package checks are",
};

export function InstallationNotice({
  restriction,
  className,
}: {
  restriction: InstallationRestriction;
  className?: string;
}) {
  const { installation } = useAuth();
  if (!installation.restricted.includes(restriction)) return null;

  const where = installation.demo ? "the public demo" : "this installation";
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2 border-b border-status-waiting/25 bg-status-waiting-soft px-4 py-2.5 text-[12px] leading-relaxed text-status-waiting",
        className,
      )}
    >
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {WHAT[restriction]} turned off in {where}, for everyone. You can look around; the controls
        here are disabled.
      </span>
    </p>
  );
}
