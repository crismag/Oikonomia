import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

const STORAGE_KEY = "oikonomia.home-orientation.dismissed";

/**
 * A first visit's map of Home, not a tour of the product.
 *
 * Welcome already walks somebody through who they are. Demo visitors, and
 * anyone who skipped that, still land here with a full binder and no legend.
 * This says what the page is *for* — the four questions it answers — and how
 * to see the longer walkthrough again. It is dismissed once, on purpose:
 * teaching the same paragraph every morning would be noise.
 */
export function HomeOrientation() {
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* Private mode: dismissing for this visit is enough. */
    }
  };

  if (hidden !== false) return null;

  return (
    <aside
      aria-label="How Home works"
      className="mb-5 rounded-2xl border border-border bg-surface shadow-card px-5 py-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium">What this home is for</h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            What needs you, what is happening this week, and what other leaders have actually asked
            of you. Open anything here to continue it where it lives — nothing is edited on this
            page.
          </p>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">Oikonomia</span> is the New Testament word for
            stewardship — looking after a household that has been entrusted to you.
          </p>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">My Binder</span>, in the sidebar, is your own work. If
            you lead others, <span className="text-foreground">Leadership</span> is where you see
            how they are doing.
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            The longer walkthrough is in the account menu, under{" "}
            <Link
              to="/welcome"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Setup &amp; walkthrough
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss how Home works"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
