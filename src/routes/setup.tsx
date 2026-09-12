import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Building2 } from "lucide-react";

import { AuthField, AuthPanel } from "@/components/oikonomia/auth-panel";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { claimFirstAccount } from "@/lib/auth-api";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up Oikonomia" }] }),
  component: SetupPage,
});

/**
 * The first person.
 *
 * A new installation of Oikonomia contains nothing: no campuses, no
 * ministries, no people. That is not a broken state to paper over with sample
 * data — it is what a binder looks like before anybody has written in it. But
 * it does leave one problem worth solving properly: with nobody in the
 * directory, nobody can sign in, and with nobody signed in, nobody can add the
 * first person.
 *
 * So this page exists, and it is open **only while the directory is empty**.
 * The account it creates is an administrator, because somebody has to be able
 * to add everyone else. The moment it succeeds the door closes: the service
 * refuses a second use, whoever asks.
 */
function SetupPage() {
  const organization = useOrganization();

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameId = useId();
  const roleId = useId();
  const emailId = useId();
  const passwordId = useId();

  if (organization.status === "ready" && !organization.setupRequired) {
    return (
      <AuthPanel
        title="Oikonomia is already set up"
        description="Somebody has already been added to this installation, so setup is closed."
        icon={Building2}
      >
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => window.location.assign("/login")}
        >
          Go to sign in
        </Button>
      </AuthPanel>
    );
  }

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      unwrap(
        (await withTimeout(
          claimFirstAccount({
            data: {
              name: name.trim(),
              ...(role.trim() ? { role: role.trim() } : {}),
              email: email.trim(),
              password,
            },
          }),
        )) as never,
      );
      /* The server has already issued a session, so this arrives signed in. */
      window.location.assign("/");
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <AuthPanel
      title="Set up Oikonomia"
      description="Nobody has been added yet. Start by entering yourself; you will be able to add everyone else."
      icon={Building2}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <AuthField id={nameId} label="Your name">
          <input
            id={nameId}
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
          />
        </AuthField>

        <AuthField
          id={roleId}
          label="What you are called here"
          hint="Optional — “Bishop”, “Ministry head”, “LifeGroup leader”. It describes you; it grants nothing."
        >
          <input
            id={roleId}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
          />
        </AuthField>

        <AuthField
          id={emailId}
          label="Your email address"
          hint="How you sign in, and where a sign-in link would go."
        >
          <input
            id={emailId}
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
          />
        </AuthField>

        <AuthField
          id={passwordId}
          label="A password"
          hint="At least 12 characters. A passphrase of a few words is easier to remember and harder to guess."
        >
          <input
            id={passwordId}
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
          />
        </AuthField>

        {failure ? (
          <p role="alert" className="text-[13px] text-status-overdue">
            {failure}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={busy || !name.trim() || !email.trim() || password.length < 12}
          busy={busy}
        >
          Create my account
        </Button>
      </form>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        This account is an administrator: it can add campuses, ministries and people. Everyone else
        is invited from inside Oikonomia — this page works only while nobody exists.
      </p>
    </AuthPanel>
  );
}
