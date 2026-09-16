import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { GuideSuggestion, WalkthroughStep } from "../core/types";
import { stepLabel } from "../walkthrough/engine";
import { useGuide } from "./guide-provider";
import { GuideContent } from "./guide-content";

/**
 * One walkthrough, a step at a time.
 *
 * The steps are data; this renders the current one and offers to take the
 * reader where it happens. The Guide never does the step for them. Progress
 * lives in the provider, so opening a step's page — which closes the Guide on
 * a phone — does not lose the reader's place.
 */
export function GuideWalkthrough({
  item,
  steps,
  onTopic,
}: {
  item: GuideSuggestion;
  steps: WalkthroughStep[];
  onTopic: (id: string) => void;
}) {
  const guide = useGuide();
  const { host } = guide;
  const progress = guide.walkthrough(item.id, steps.length);
  const heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef(progress);
  latest.current = progress;

  useEffect(() => {
    if (latest.current.step === 0) {
      host.onEvent?.({ type: "guide_walkthrough_started", id: item.id });
    }
    return () => {
      const last = latest.current;
      if (!last.completed) {
        host.onEvent?.({ type: "guide_walkthrough_abandoned", id: item.id, step: last.step + 1 });
      }
    };
    /* Once per walkthrough shown. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const move = (direction: "next" | "back" | "restart") => {
    const next = guide.moveWalkthrough(item.id, steps.length, direction);
    if (next.completed && !progress.completed) {
      host.onEvent?.({ type: "guide_walkthrough_completed", id: item.id });
    }
    window.setTimeout(() => heading.current?.focus(), 0);
  };

  if (progress.completed) {
    return (
      <div className="space-y-3">
        <h3 ref={heading} tabIndex={-1} className="text-[14px] font-medium outline-none">
          Done — {item.title}
        </h3>
        <p className="text-[13px] text-muted-foreground">
          That is the whole walkthrough. You can go through it again, or go back to the help for
          this page.
        </p>
        <Button type="button" variant="secondary" onClick={() => move("restart")}>
          Start again
        </Button>
      </div>
    );
  }

  const step = steps[progress.step]!;
  const offersDestination = !!step.destination && host.canNavigate(step.destination);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground" aria-live="polite">
        {stepLabel(progress)}
      </p>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Walkthrough progress"
        aria-valuemin={1}
        aria-valuemax={progress.total}
        aria-valuenow={progress.step + 1}
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${((progress.step + 1) / progress.total) * 100}%` }}
        />
      </div>
      <h3 ref={heading} tabIndex={-1} className="text-[14px] font-medium outline-none">
        {step.title}
      </h3>
      <GuideContent
        blocks={step.body}
        onTopic={onTopic}
        onDestination={(id) => guide.navigate(id)}
        canNavigate={(id) => host.canNavigate(id)}
      />
      {offersDestination ? (
        <Button type="button" variant="secondary" onClick={() => guide.navigate(step.destination!)}>
          {host.destinationLabel(step.destination!) ?? "Open"}
        </Button>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          disabled={progress.step === 0}
          onClick={() => move("back")}
        >
          Back
        </Button>
        <Button type="button" variant="primary" onClick={() => move("next")}>
          {progress.step === progress.total - 1 ? "Finish" : "Next"}
        </Button>
      </div>
    </div>
  );
}
