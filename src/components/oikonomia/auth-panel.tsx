import { ShieldAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The frame every authentication screen is drawn in.
 *
 * One panel, shared by sign-in, the email states, the reset states and the
 * account-status pages — so they cannot drift into looking like separate
 * products. The entrance should feel like the building.
 *
 * Deliberately narrow and centred, with no illustration and no marketing: a
 * decorative half-page is a nuisance on a phone and says nothing about what
 * Oikonomia is. Calm, organized, private.
 */
export function AuthPanel({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mb-6 text-center">
        <span className="mx-auto grid size-9 place-items-center rounded-md bg-primary font-display text-[17px] text-primary-foreground">
          O
        </span>
        <p className="mt-2 font-display text-[15px]">Oikonomia</p>
      </div>

      <div className="rounded-lg border border-border bg-surface px-5 py-6">
        <header className="mb-5 text-center">
          {Icon ? <Icon className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden /> : null}
          <h1 className="font-display text-[22px] leading-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>

        <div className="space-y-4">{children}</div>
      </div>
    </main>
  );
}

/**
 * A labelled field.
 *
 * The label is a real `<label>` tied to the control by id, because a placeholder
 * is not a label: it disappears the moment somebody types and was never read to
 * a screen reader in the first place.
 */
export function AuthField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Said once, plainly, where nobody can miss it.
 *
 * A sign-in form that looks real and checks nothing is the most misleading
 * thing this codebase could ship, so it says what it is. This notice is
 * rendered from `adapter.isMock` and disappears on its own the day a real
 * authentication backend replaces the mock — there is nothing to remember to
 * take out.
 */
export function MockNotice() {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-status-waiting/35 bg-status-waiting-soft px-3 py-2.5 text-[12px] leading-relaxed text-status-waiting"
    >
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium">Demonstration only.</strong> Nothing on this page verifies
        anything — no password is checked and no session is created. Any details will sign you in.
      </span>
    </p>
  );
}
