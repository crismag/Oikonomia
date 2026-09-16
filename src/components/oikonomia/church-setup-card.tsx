import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";

import { fetchChurchSetup } from "@/lib/organization-api";
import { unwrap, withTimeout } from "@/lib/calendar-client";
import { cn } from "@/lib/utils";
import {
  churchSetupComplete,
  churchSetupSteps,
  type ChurchSetupProgress,
} from "@/domain/church-setup";
import { useViewer } from "@/domain/session";

/**
 * The next thing to set up, for whoever administers a church that is not set
 * up yet.
 *
 * Above the leadership cycle rather than instead of it: the cycle is still
 * true of the administrator, and hiding it would be the page deciding what is
 * real. Every step is computed from the installation, links to the part of
 * Administration where it is done, and the card is gone once nothing is left.
 */
export function ChurchSetupCard() {
  const { persona } = useViewer();
  const administers = persona.capabilities.includes("administration");

  const query = useQuery<ChurchSetupProgress>({
    queryKey: ["church-setup"],
    queryFn: async () => unwrap(await withTimeout(fetchChurchSetup({ data: {} }))),
    enabled: administers,
    retry: 1,
    networkMode: "always",
  });

  if (!administers || !query.data) return null;

  const steps = churchSetupSteps(query.data);
  if (churchSetupComplete(steps)) return null;

  const next = steps.find((step) => !step.done);
  const done = steps.filter((step) => step.done).length;

  return (
    <section
      aria-label="Set up your church"
      className="mb-5 rounded-2xl border border-border bg-surface shadow-card px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-medium">Set up your church</h2>
        <p className="text-[12px] tabular-nums text-muted-foreground">
          {done} of {steps.length} done
        </p>
      </div>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
        Nothing arrives with Oikonomia. Until the church is entered, the rest of this page is about
        you alone.
      </p>

      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => {
          const current = step === next;
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums",
                  step.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : current
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground",
                )}
              >
                {step.done ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[14px]",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.title}
                  <span className="sr-only">{step.done ? " — done" : " — not done"}</span>
                </span>
                {current ? (
                  <>
                    <span className="block text-[12px] leading-relaxed text-muted-foreground">
                      {step.detail}
                    </span>
                    <Link
                      to="/administration"
                      hash={step.section}
                      className="mt-1 inline-flex text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Go to Administration
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
