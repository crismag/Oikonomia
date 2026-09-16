import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLeadershipInbox } from "./escalation-provider";
import { useSchedule } from "./schedule-provider";
import { errorMessage } from "@/lib/calendar-client";
import { isOnTheWeek, weekDateFor } from "@/domain/escalation";
import type { EscalationView } from "@/lib/escalation-api";

/**
 * "Put on my week" for an action somebody asked of this leader.
 *
 * One control wherever the ask is met — the inbox row and the record it came
 * from — so the two cannot drift on which day it lands or what counts as
 * already filed. It creates an ordinary agenda item and nothing else; once
 * filed it becomes a link to that day.
 */
export function PutOnWeekButton({
  item,
  today,
  onFailure,
}: {
  item: EscalationView;
  today: string;
  /** Receives the error message, or null when a new attempt starts. */
  onFailure: (message: string | null) => void;
}) {
  const inbox = useLeadershipInbox();
  const schedule = useSchedule();
  const [filed, setFiled] = useState(false);

  const date = weekDateFor(item, today);

  if (filed || isOnTheWeek(item, schedule.agenda)) {
    return (
      <Link
        to="/weekly-agenda"
        search={{ date }}
        className="inline-flex min-h-6 items-center px-2.5 py-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
      >
        On your week
      </Link>
    );
  }

  const putOnWeek = async () => {
    onFailure(null);
    try {
      await schedule.addAgenda({ text: item.request, date });
      setFiled(true);
      /* Dating the work is taking it on; an ask already moving stays where it is. */
      if (item.status === "requested") await inbox.move(item.id, "in-progress");
    } catch (error) {
      onFailure(errorMessage(error));
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={schedule.saving}
      onClick={() => void putOnWeek()}
    >
      Put on my week
    </Button>
  );
}
