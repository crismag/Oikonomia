import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Mail, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/oikonomia/auth-provider";
import { useOrganization } from "@/components/oikonomia/organization-provider";
import { ErrorState, ListSkeleton } from "@/components/oikonomia/async-state";
import { useSession } from "@/domain/session";
import { AuthPanel, AuthField } from "@/components/oikonomia/auth-panel";
import { AuthError } from "@/lib/auth-adapter";
import { DemoEntryPanel } from "@/components/oikonomia/demo-entry";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { fetchDemoEntry } from "@/lib/demo-api";
import {
  landingFor,
  linkProblemMessage,
  magicLinkSent,
  passwordResetSent,
  signInFailure,
  statusExplanation,
  type LinkProblem,
} from "@/domain/auth";

/** Which panel is on screen. One route, because it is one conversation. */
type Step =
  | "sign-in"
  | "magic-link"
  | "magic-sent"
  | "forgot"
  | "forgot-sent"
  | "reset"
  | "reset-done"
  | "no-access"
  | "suspended"
  | LinkProblem;

const STEPS: Step[] = [
  "sign-in",
  "magic-link",
  "magic-sent",
  "forgot",
  "forgot-sent",
  "reset",
  "reset-done",
  "no-access",
  "suspended",
  "expired",
  "used",
  "invalid",
];

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { step?: Step; next?: string; reset?: string } => {
    const step = STEPS.includes(search["step"] as Step) ? (search["step"] as Step) : undefined;
    /* A reset or invitation link arrives as `?reset=<token>`. Its presence is
       what puts the screen on the "choose a password" step, so somebody
       following one from their inbox lands where they expect. */
    const reset = typeof search["reset"] === "string" ? search["reset"] : undefined;
    return {
      ...((step ?? reset) ? { step: step ?? "reset" } : {}),
      ...(typeof search["next"] === "string" ? { next: search["next"] } : {}),
      ...(reset ? { reset } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Sign in — Oikonomia" }] }),
  component: LoginPage,
});

/**
 * A public demonstration has an entrance instead of a sign-in form.
 *
 * Asked of the server on every visit: whether this installation is a
 * demonstration is the installation's to say, never the browser's. Until it has
 * answered, nothing is shown — a sign-in form that flashes up and is replaced
 * would invite somebody to type a password into a demonstration. If the answer
 * cannot be had, the ordinary sign-in is shown; on a demonstration every one of
 * its operations is refused by the server anyway.
 */
function LoginPage() {
  const demo = useQuery({
    queryKey: ["demo-entry"],
    queryFn: async () => unwrap(await withTimeout(fetchDemoEntry({ data: undefined }))),
    staleTime: 0,
    retry: false,
  });

  if (demo.isPending) {
    return <main className="min-h-screen" aria-busy="true" />;
  }
  if (demo.data?.demo) return <DemoEntryPanel entry={demo.data} />;
  return <OrdinarySignIn />;
}

function OrdinarySignIn() {
  const { step = "sign-in", next, reset: resetToken } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const auth = useAuth();

  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const go = (to: Step) => navigate({ search: (prev) => ({ ...prev, step: to }) });
  const enter = () => window.location.assign(landingFor(next));

  const identityId = useId();
  const passwordId = useId();
  const emailId = useId();
  const errorId = useId();

  const attempt = async (work: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      then?.();
    } catch (error) {
      /* The message comes from the domain, which decides what a failure is
         allowed to say. The underlying error never reaches the screen. */
      setFailure(error instanceof AuthError ? error.message : signInFailure("network"));
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------- link problems */

  if (step === "expired" || step === "used" || step === "invalid") {
    const { title, body } = linkProblemMessage[step];
    return (
      <AuthPanel title={title} description={body} icon={ShieldAlert}>
        <Button type="button" variant="primary" onClick={() => go("magic-link")} className="w-full">
          Request a new link
        </Button>
        <BackToSignIn onClick={() => go("sign-in")} />
      </AuthPanel>
    );
  }

  /* ------------------------------------------------------ account states */

  if (step === "no-access" || step === "suspended") {
    const key = step === "no-access" ? "authenticated_no_access" : "suspended";
    const { title, body } = statusExplanation[key];
    return (
      <AuthPanel title={title} description={body}>
        <p className="text-[13px] text-muted-foreground">
          Contact your church administrator, who can invite you or restore your access.
        </p>
        <BackToSignIn onClick={() => go("sign-in")} />
      </AuthPanel>
    );
  }

  /* ----------------------------------------------------------- magic link */

  if (step === "magic-sent" || step === "forgot-sent") {
    const message =
      step === "magic-sent"
        ? magicLinkSent(email || "that address")
        : passwordResetSent(email || "that address");
    return (
      <AuthPanel title="Check your email" description={message} icon={Mail}>
        {/* Deliberately conditional: saying "we have sent you a link" would
            confirm the address is registered. */}
        <p className="text-[13px] text-muted-foreground">The link is only good for a short time.</p>
        <BackToSignIn onClick={() => go("sign-in")} />
      </AuthPanel>
    );
  }

  if (step === "magic-link" || step === "forgot") {
    const isReset = step === "forgot";
    return (
      <AuthPanel
        title={isReset ? "Reset your password" : "Sign in by email"}
        description={
          isReset
            ? "We will email you a link to set a new password."
            : "We will email you a secure link that signs you into Oikonomia."
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(
              () =>
                isReset
                  ? auth.adapter.requestPasswordReset(email)
                  : auth.adapter.requestMagicLink(email),
              () => go(isReset ? "forgot-sent" : "magic-sent"),
            );
          }}
        >
          <AuthField id={emailId} label="Email address">
            <input
              id={emailId}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
            />
          </AuthField>
          <Button type="submit" variant="primary" disabled={busy} busy={busy} className="w-full">
            {isReset ? "Email me a reset link" : "Email me a sign-in link"}
          </Button>
        </form>
        <BackToSignIn onClick={() => go("sign-in")} />
      </AuthPanel>
    );
  }

  /* --------------------------------------------------------- new password */

  if (step === "reset-done") {
    return (
      <AuthPanel title="Password updated" description="You can sign in with your new password.">
        <Button type="button" variant="primary" onClick={() => go("sign-in")} className="w-full">
          Sign in
        </Button>
      </AuthPanel>
    );
  }

  if (step === "reset") {
    /* Without a token there is nothing to set a password against. Saying so
       beats a form that collects one and then cannot use it. */
    if (!resetToken) {
      return (
        <AuthPanel
          title="That link is not complete"
          description="Open the link from your email, or ask for a new one."
        >
          <Button type="button" variant="primary" onClick={() => go("forgot")} className="w-full">
            Request a new link
          </Button>
          <BackToSignIn onClick={() => go("sign-in")} />
        </AuthPanel>
      );
    }

    return (
      <AuthPanel title="Choose a new password" description="Long is better than complicated.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            /*
             * This used to navigate straight to "password saved" without
             * calling anything: a control that reported success and changed
             * nothing, so somebody who followed a reset link still could not
             * sign in.
             */
            void (async () => {
              setBusy(true);
              setFailure(null);
              try {
                const result = await auth.adapter.resetPassword(resetToken, password);
                /* A spent or expired link is not a network problem, and
                   `attempt` would report it as one. It gets the words written
                   for it. */
                if (result === true) go("reset-done");
                else setFailure(linkProblemMessage[result].body);
              } catch {
                setFailure(signInFailure("network"));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <AuthField id={passwordId} label="New password" hint="At least 12 characters.">
            <PasswordInput
              id={passwordId}
              value={password}
              onChange={setPassword}
              reveal={reveal}
              onReveal={setReveal}
              autoComplete="new-password"
              minLength={12}
            />
          </AuthField>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            Save new password
          </Button>
        </form>
        <BackToSignIn onClick={() => go("sign-in")} />
      </AuthPanel>
    );
  }

  /* ------------------------------------------------------------- sign in */

  return (
    <AuthPanel title="Welcome back" description="Sign in to continue to Oikonomia.">
      {/* Offered only where it can work. A button that redirects to a Google
          project this installation does not have is a control that looks
          operational and is not. */}
      {auth.methods.google ? (
        <>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => void attempt(() => auth.adapter.signInWithGoogle(), enter)}
          >
            <GoogleMark />
            Continue with Google
          </Button>

          <Divider />
        </>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(() => auth.adapter.signInWithPassword(identity, password), enter);
        }}
      >
        <AuthField id={identityId} label="Email or username">
          <input
            id={identityId}
            required
            autoComplete="username"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            aria-invalid={failure ? true : undefined}
            aria-describedby={failure ? errorId : undefined}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
          />
        </AuthField>

        <AuthField id={passwordId} label="Password">
          <PasswordInput
            id={passwordId}
            value={password}
            onChange={setPassword}
            reveal={reveal}
            onReveal={setReveal}
            autoComplete="current-password"
            describedBy={failure ? errorId : undefined}
            invalid={!!failure}
          />
        </AuthField>

        {/*
         * Announced when it appears, tied to both fields, and never says which
         * half was wrong — the difference between "no such account" and "wrong
         * password" is what somebody enumerating accounts is looking for.
         */}
        {failure ? (
          <p id={errorId} role="alert" className="text-[13px] text-status-overdue">
            {failure}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={busy} busy={busy} className="w-full">
          Sign in
        </Button>
      </form>

      {/* Both of these end in an email. Where no provider is configured the
          link goes to the server log and nobody receives anything, so rather
          than offering a button that quietly fails, the screen says what is
          true and who can help. */}
      {auth.methods.emailDelivery ? (
        <>
          <button
            type="button"
            onClick={() => go("forgot")}
            className="text-[13px] text-primary underline-offset-2 hover:underline"
          >
            Forgot password?
          </button>

          <Divider />

          <Button type="button" variant="ghost" className="w-full" onClick={() => go("magic-link")}>
            <Mail className="size-3.5" aria-hidden />
            Email me a sign-in link
          </Button>
        </>
      ) : (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          This installation cannot send email, so sign-in links and password resets are unavailable.
          Your church administrator can set a new password for you.
        </p>
      )}

      <p className="pt-1 text-center text-[13px] text-muted-foreground">
        Need access? Oikonomia is by invitation — contact your church administrator.
      </p>
    </AuthPanel>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  reveal,
  onReveal,
  autoComplete,
  minLength,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  reveal: boolean;
  onReveal: (reveal: boolean) => void;
  autoComplete: string;
  minLength?: number;
  describedBy?: string | undefined;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        /* Pasting is how a password manager works, so nothing blocks it. */
        type={reveal ? "text" : "password"}
        required
        autoComplete={autoComplete}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-md border border-border bg-surface py-2 pl-3 pr-10 text-[15px] outline-none focus:border-border-strong"
      />
      <button
        type="button"
        onClick={() => onReveal(!reveal)}
        aria-pressed={reveal}
        aria-label={reveal ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {reveal ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[12px] text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function BackToSignIn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Back to sign in
    </button>
  );
}

/** Google's mark, drawn rather than fetched — nothing external on this page. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path
        fill="#EA4335"
        d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z"
      />
    </svg>
  );
}

export { Link };
