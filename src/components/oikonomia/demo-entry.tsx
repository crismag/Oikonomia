import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { AuthField, AuthPanel } from "@/components/oikonomia/auth-panel";
import { refreshedSince, rememberedGeneration } from "@/components/oikonomia/demo-awareness";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { createDemoVisitor, enterDemoAs, type DemoEntry } from "@/lib/demo-api";

/**
 * The sign-in screen of a public demonstration.
 *
 * There is nothing to sign in with. A visitor chooses one of the people the
 * demonstration's data offers, or tries Oikonomia as themselves with a name —
 * and from the next page on it is the real application, with that person's
 * real permissions, against real records other visitors can also see and change.
 *
 * Who is offered comes from the server, from the data. Nothing here knows any
 * name.
 */
export function DemoEntryPanel({ entry }: { entry: DemoEntry }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [name, setName] = useState("");
  const nameId = useId();
  const errorId = useId();
  const [refreshed, setRefreshed] = useState(false);

  /* Read after hydration: the server cannot know what this browser remembers. */
  useEffect(() => {
    setRefreshed(refreshedSince(rememberedGeneration(), entry.generation));
  }, [entry.generation]);

  /* A full load rather than a client navigation, so every provider starts from
     the new session rather than from what the sign-in screen had cached. */
  const arrive = () => window.location.assign("/");

  const attempt = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setFailure(null);
    try {
      await work();
      arrive();
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(null);
    }
  };

  const enter = (identityId: string) =>
    attempt(identityId, async () =>
      unwrap(await withTimeout(enterDemoAs({ data: { identityId } }))),
    );

  const visit = () =>
    attempt("visitor", async () =>
      unwrap(await withTimeout(createDemoVisitor({ data: { name } }))),
    );

  if (entry.identities.length === 0) {
    return (
      <AuthPanel
        title="Explore Oikonomia"
        description="This demonstration has no one to explore as yet. Please try again later."
      >
        <p className="text-center text-[13px] text-muted-foreground">
          Nothing here needs a password or an account.
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Explore Oikonomia"
      description="A shared demonstration. Choose someone to explore as — other visitors may be using the same people and changing the same records."
    >
      {refreshed ? (
        <p
          role="status"
          className="rounded-md border border-status-waiting/30 bg-status-waiting-soft px-3 py-2 text-center text-[13px]"
        >
          The demo was refreshed. Choose a demo user to continue.
        </p>
      ) : null}

      <ul className="space-y-2" aria-label="Explore as">
        {entry.identities.map((identity) => (
          <li key={identity.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void enter(identity.id)}
              className="flex w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60"
            >
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-medium"
              >
                {identity.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{identity.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {[identity.title, identity.role].filter(Boolean).join(" · ")}
                </span>
              </span>
              {busy === identity.id ? (
                <span className="text-[12px] text-muted-foreground">Opening…</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {entry.visitorsWelcome ? (
        <>
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[12px] text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void visit();
            }}
          >
            <AuthField
              id={nameId}
              label="Try it as yourself"
              hint="Just a name — no email or password. Your temporary profile, and anything you create with it, is removed when the demo refreshes."
            >
              <input
                id={nameId}
                required
                maxLength={60}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={failure ? true : undefined}
                aria-describedby={failure ? errorId : undefined}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-border-strong"
              />
            </AuthField>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={busy !== null || !name.trim()}
            >
              {busy === "visitor" ? "Setting you up…" : "Start"}
            </Button>
          </form>
        </>
      ) : null}

      {failure ? (
        <p id={errorId} role="alert" className="text-center text-[13px] text-status-overdue">
          {failure}
        </p>
      ) : null}
    </AuthPanel>
  );
}
