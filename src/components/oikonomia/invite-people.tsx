import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { InstallationNotice, useInstallationRestricted } from "./installation-notice";
import { Section } from "./section";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { inviteManyToOikonomia, type InvitationResult } from "@/lib/auth-api";
import { addressesIn } from "@/domain/invitation";

const OUTCOME: Record<InvitationResult["outcome"], string> = {
  sent: "Invitation sent",
  registered: "Account created — no email sent",
  "already-has-access": "Already signs in",
  invalid: "Not an email address",
  conflict: "Held by another record — check People",
};

/**
 * Invite a leadership team in one go.
 *
 * An administrator lists the addresses; each person gets an account and an
 * emailed link that sets a password and leads into Welcome, where somebody
 * the directory did not know yet says what they are called. Nothing is
 * granted but a way in — where they serve is still claimed and confirmed.
 *
 * Without email this registers the accounts and says plainly that nothing was
 * sent, rather than implying invitations went out.
 */
export function InvitePeople() {
  const queryClient = useQueryClient();
  const { methods } = useAuth();
  const restricted = useInstallationRestricted("authentication");
  const [text, setText] = useState("");
  const addresses = addressesIn(text);

  const invite = useMutation({
    mutationFn: async () =>
      unwrap(await withTimeout(inviteManyToOikonomia({ data: { emails: addresses } }))),
    onSuccess: (results) => {
      /* Keep what failed in the box, so it can be corrected and sent again. */
      setText(
        results
          .filter((r) => r.outcome === "invalid" || r.outcome === "conflict")
          .map((r) => r.email)
          .join("\n"),
      );
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });

  const results = invite.data ?? [];

  return (
    <Section id="invite" title="Invite people">
      <InstallationNotice restriction="authentication" />
      <div className="space-y-3 px-4 py-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {methods.emailDelivery
            ? "List their email addresses. Each person gets an account and an email with a link to set a password; the link lasts 7 days. Someone new to the directory is added and gives their name when they first sign in."
            : "List their email addresses. This installation cannot send email, so each person gets an account and nothing is sent — set their passwords with npm run auth:set-password."}{" "}
          An invitation gives a way in and nothing else: where they serve is still confirmed here.
        </p>
        <label htmlFor="invite-addresses" className="block text-[13px] font-medium">
          Email addresses
        </label>
        <textarea
          id="invite-addresses"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={restricted}
          placeholder={"one@example.org\ntwo@example.org"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-border-strong"
        />
        <p className="text-[12px] text-muted-foreground">
          One per line, or separated by commas.{" "}
          {addresses.length > 0
            ? `${addresses.length} ${addresses.length === 1 ? "address" : "addresses"}.`
            : null}
        </p>

        {invite.isError ? (
          <p role="alert" className="text-[13px] text-status-overdue">
            {errorMessage(invite.error)}
          </p>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          disabled={restricted || invite.isPending || addresses.length === 0}
          busy={invite.isPending}
          onClick={() => invite.mutate()}
        >
          <Mail className="size-3.5" aria-hidden />
          {methods.emailDelivery ? "Send invitations" : "Create accounts"}
        </Button>

        {results.length > 0 ? (
          <ul aria-live="polite" className="divide-y divide-border rounded-md border border-border">
            {results.map((result) => (
              <li
                key={result.email}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 truncate">{result.email}</span>
                <span
                  className={
                    result.outcome === "invalid" || result.outcome === "conflict"
                      ? "text-status-overdue"
                      : "text-muted-foreground"
                  }
                >
                  {OUTCOME[result.outcome]}
                  {result.created ? " · added to People" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}
