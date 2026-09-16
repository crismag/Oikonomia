import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Laptop, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/oikonomia/page";
import {
  InstallationNotice,
  useInstallationRestricted,
} from "@/components/oikonomia/installation-notice";
import { Section } from "@/components/oikonomia/section";
import { useAuth } from "@/components/oikonomia/auth-provider";
import { AuthField } from "@/components/oikonomia/auth-panel";
import { notify } from "@/config/messages/handlers";
import { errorMessage, unwrap } from "@/lib/calendar-client";
import {
  changePassword,
  fetchAccountOverview,
  signOutOtherSessions,
  signOutSession,
  type AccountSessionView,
} from "@/lib/auth-api";
import { authMethodLabel } from "@/domain/auth";

export const Route = createFileRoute("/account-security")({
  head: () => ({ meta: [{ title: "Account & security — Oikonomia" }] }),
  component: AccountSecurityPage,
});

/**
 * How this account is signed into, and where it is signed in.
 *
 * Sign-in methods are several ways of proving **one** identity, not several
 * accounts — so they are listed as properties of this account rather than as
 * separate logins.
 *
 * Nothing here shows a token, a hash, a session id or a provider secret. A
 * security page that displays the secrets it is protecting is not a security
 * page.
 *
 * ## What this page used to be
 *
 * A mock. It stated that the password was "Not set" and Google "Not connected"
 * without consulting anything, said other devices would appear "once sessions
 * are real", and carried a permanently disabled "Sign out of all other
 * devices". Sessions were real by then, and the repository could already end
 * them. Somebody who had just signed in with a password was told they had none.
 */
function AccountSecurityPage() {
  const { methods: installation } = useAuth();
  const sessionsRestricted = useInstallationRestricted("sessions");
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["account-overview"],
    queryFn: async () => unwrap(await fetchAccountOverview({ data: undefined })),
  });

  const endOne = useMutation({
    mutationFn: async (sessionId: string) => unwrap(await signOutSession({ data: { sessionId } })),
    onSuccess: () => {
      notify.success("That device was signed out.");
      void queryClient.invalidateQueries({ queryKey: ["account-overview"] });
    },
    onError: (error) =>
      notify.error("That device could not be signed out.", undefined, String(error)),
  });

  const signOutOthers = useMutation({
    mutationFn: async () => unwrap(await signOutOtherSessions({ data: undefined })),
    onSuccess: ({ ended }) => {
      notify.success(
        ended === 0
          ? "There were no other sessions to end."
          : ended === 1
            ? "One other session was signed out."
            : `${ended} other sessions were signed out.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["account-overview"] });
    },
    onError: (error) =>
      notify.error("Those sessions could not be ended.", undefined, String(error)),
  });

  const data = overview.data;
  const others = (data?.sessions ?? []).filter((s: AccountSessionView) => !s.current);

  return (
    <Page width="regular">
      <PageHeader
        title="Account & security"
        description="How you sign in to Oikonomia, and where you are signed in."
      />

      <div className="space-y-4">
        <Section
          title="Sign-in methods"
          meta={data ? String(data.methods.filter((m) => Boolean(m.since)).length) : undefined}
        >
          {overview.isPending ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">Checking your account…</p>
          ) : !data ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Your account details could not be read just now.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.methods.map(({ method, since }) => (
                <li key={method} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[14px]">
                      {authMethodLabel[method]}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                      {since
                        ? `Set ${formatDateTime(since)}`
                        : method === "google" && !data.googleConfigured
                          ? "Google sign-in is not configured on this installation"
                          : "Not set"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] text-muted-foreground">
                    {since ? "In use" : "Not set"}
                  </span>
                </li>
              ))}

              {/* A property of the installation, not of this account: there is
                  no credential to hold, and whether it works is whether mail
                  is configured. */}
              <li className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px]">
                    <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                    {authMethodLabel["magic-link"]}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {data.emailDeliveryConfigured
                      ? (data.email ?? "No email address on your record")
                      : "This installation cannot send email"}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {data.emailDeliveryConfigured ? "Available" : "Unavailable"}
                </span>
              </li>
            </ul>
          )}
        </Section>

        {data?.methods.some((m) => m.method === "password" && m.since) ? (
          <ChangePassword
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ["account-overview"] })}
          />
        ) : null}

        <Section
          title="Where you are signed in"
          meta={data ? String(data.sessions.length) : undefined}
        >
          <InstallationNotice restriction="sessions" />
          {overview.isPending ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">Checking your sessions…</p>
          ) : !data ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              Your sessions could not be read just now.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {data.sessions.map((session) => (
                  <li key={session.id} className="px-4 py-3">
                    <p className="flex items-center gap-2 text-[14px]">
                      <Laptop className="size-3.5 text-muted-foreground" aria-hidden />
                      {session.current ? "This device" : describeDevice(session.userAgent)}
                      {session.current ? (
                        <>
                          <Check className="size-3.5 text-status-done" aria-hidden />
                          <span className="sr-only">current session</span>
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Signed in {formatDateTime(session.createdAt)} · last used{" "}
                      {formatDateTime(session.lastSeenAt)}
                    </p>
                    {/* Not offered for the current session: ending it would
                        sign somebody out of the page they are using, which
                        reads as a bug whatever the intent. */}
                    {session.current ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-1.5"
                        disabled={endOne.isPending || sessionsRestricted}
                        onClick={() => endOne.mutate(session.id)}
                      >
                        Sign out this device
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="px-4 py-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={others.length === 0 || signOutOthers.isPending || sessionsRestricted}
                  busy={signOutOthers.isPending}
                  onClick={() => signOutOthers.mutate()}
                >
                  Sign out of all other devices
                </Button>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {others.length === 0
                    ? "This is the only device signed in to your account."
                    : "This device stays signed in. Every other session ends immediately."}
                </p>
              </div>
            </>
          )}
        </Section>

        {!installation.emailDelivery ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Sign-in links and password resets need a mail provider, which this installation does not
            have. Your church administrator can set a new password for you.
          </p>
        ) : null}
      </div>
    </Page>
  );
}

/**
 * Change your own password.
 *
 * Offered only to an account that has one: somebody who signs in with Google
 * or an emailed link has nothing to change here, and "Forgot password?" on the
 * sign-in screen is how a first one is set. The current password is asked for
 * because an unattended browser must not be enough to take the account; the
 * server checks it, and signs every other device out when the change is made.
 */
function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const restricted = useInstallationRestricted("authentication");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const currentId = useId();
  const nextId = useId();
  const repeatId = useId();

  const change = useMutation({
    mutationFn: async () => unwrap(await changePassword({ data: { current, next } })),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
      notify.success("Your password was changed. Every other device was signed out.");
      onChanged();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (next !== repeat) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate();
  };

  const field =
    "w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-border-strong";

  return (
    <Section title="Change password">
      <InstallationNotice restriction="authentication" />
      <form onSubmit={submit} className="space-y-3 px-4 py-3">
        <AuthField id={currentId} label="Current password">
          <input
            id={currentId}
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={restricted}
            className={field}
          />
        </AuthField>
        <AuthField id={nextId} label="New password" hint="At least 12 characters.">
          <input
            id={nextId}
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={restricted}
            className={field}
          />
        </AuthField>
        <AuthField id={repeatId} label="New password again">
          <input
            id={repeatId}
            type="password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            aria-invalid={mismatch ? true : undefined}
            disabled={restricted}
            className={field}
          />
        </AuthField>

        {mismatch ? (
          <p role="alert" className="text-[13px] text-status-overdue">
            The two new passwords are not the same.
          </p>
        ) : change.isError ? (
          <p role="alert" className="text-[13px] text-status-overdue">
            {errorMessage(change.error)}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="secondary"
          disabled={restricted || change.isPending}
          busy={change.isPending}
        >
          Change password
        </Button>
        <p className="text-[12px] text-muted-foreground">
          This device stays signed in. Every other device is signed out.
        </p>
      </form>
    </Section>
  );
}

/** A timestamp as a leader reads it. */
function formatDateTime(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, h:mm a");
}

/**
 * A browser and platform, from a user agent — and nothing more precise.
 *
 * The full string is a fingerprint and says nothing a leader needs. "A signed-in
 * device" is the honest answer when it cannot be read.
 */
function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return "A signed-in device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : undefined;

  const platform = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : undefined;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "A signed-in device";
}
