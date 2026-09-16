import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FileText, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PersonName } from "./person";
import { useMeetings } from "./meeting-provider";
import { useReports } from "./report-provider";
import { useViewer } from "@/domain/session";
import { isRestricted } from "@/domain/leadership-report";
import { errorMessage } from "@/lib/calendar-client";
import type { MeetingNote } from "@/domain/types";

/**
 * Writing a Leadership Report from a meeting.
 *
 * Some of what comes out of a meeting has to reach people who were not in the
 * room, in a form they read as a report. This starts one — the same record the
 * binder keeps everywhere else — remembering that it came from this meeting.
 *
 * Nothing is copied from the note. The meeting is context: the report names it
 * and opens it, and it grants nothing. The report starts as its author's
 * private draft; who reads it is the author's decision, made on the report.
 * The server refuses a meeting the author may not read.
 */
export function WriteReportFromMeeting({ note }: { note: MeetingNote }) {
  const reports = useReports();
  const meetings = useMeetings();
  const { person } = useViewer();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setFailure(null);
    try {
      /* The title is prefilled from the meeting, so an edit still waiting to
         be written should land before the report is named after it. */
      await meetings.flush();
      const id = await reports.createReport({
        authorId: person.id,
        reportType: "Meeting report",
        contentSource: "native",
        title: note.title.trim(),
        contextType: "meeting-note",
        contextId: note.id,
      });
      void navigate({
        to: "/leadership-reports/$reportId",
        params: { reportId: id },
        search: { edit: true },
      });
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void start()}
        disabled={busy}
        busy={busy}
      >
        <FileText className="size-3.5" aria-hidden />
        Write a report from this meeting
      </Button>
      {failure ? (
        <p role="alert" className="basis-full text-right text-[12px] text-status-overdue">
          {failure}
        </p>
      ) : null}
    </>
  );
}

/**
 * Reports already written from this meeting, that this viewer may discover.
 *
 * The list is the server's discoverable set, so a report somebody else kept
 * private is not here to be counted. Nothing renders when there are none.
 */
export function ReportsFromMeeting({ noteId }: { noteId: string }) {
  const { visible } = useReports();
  const written = visible.filter(
    (report) => report.contextType === "meeting-note" && report.contextId === noteId,
  );
  if (written.length === 0) return null;

  return (
    <section data-print="hide" className="rounded-md border border-border">
      <h2 className="border-b border-border px-3 py-2 text-[13px] font-medium text-muted-foreground">
        Reports from this meeting
      </h2>
      <ul className="divide-y divide-border">
        {written.map((report) => (
          <li key={report.id}>
            <Link
              to="/leadership-reports/$reportId"
              params={{ reportId: report.id }}
              search={{}}
              className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted"
            >
              {isRestricted(report) ? (
                <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {report.title || "Untitled report"}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                <PersonName personId={report.authorId} />
                {report.status === "draft" ? " · Draft" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
