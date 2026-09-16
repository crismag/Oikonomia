import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, HardDrive, Mail, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstallationNotice, useInstallationRestricted } from "./installation-notice";
import { Section } from "./section";
import { errorMessage, unwrap, withTimeout } from "@/lib/calendar-client";
import { checkWorkspaceConnection, fetchWorkspaceStatus } from "@/lib/workspace-api";
import { fetchCalendarPublishing, publishAllCalendarEvents } from "@/lib/google-calendar-api";
import { formatDistanceToNow } from "date-fns";

const scopeLabel: Record<string, string> = {
  gmailSend: "Send mail as the church mailbox",
  drive: "Google Drive",
  calendarEvents: "Publish to Google Calendar",
  calendarRead: "Read leaders' calendars",
};

/**
 * Google Workspace, as an administrator sees it.
 *
 * Set up in the server's environment, not here — the service account key is a
 * credential and does not belong in a form. This says what is on, and asks
 * Google whether it agrees.
 */
export function WorkspaceAdmin() {
  const restricted = useInstallationRestricted("integrations");
  const status = useQuery({
    queryKey: ["workspace-status"],
    queryFn: async () => unwrap(await withTimeout(fetchWorkspaceStatus({ data: undefined }))),
  });
  const check = useMutation({
    mutationFn: async () =>
      unwrap(await withTimeout(checkWorkspaceConnection({ data: undefined }), 30_000)),
  });

  const data = status.data;
  const features = data
    ? [
        {
          icon: Mail,
          label: "Mail",
          on: data.mail,
          detail: data.mail ? `Sent as ${data.appUser}` : "Not set up",
        },
        {
          icon: HardDrive,
          label: "Drive",
          on: data.drive,
          detail: data.drive ? "Leaders' own Drive, as themselves" : "Not set up",
        },
        {
          icon: CalendarDays,
          label: "Calendar",
          on: data.calendarPublish || data.calendarOverlay,
          detail: data.calendarPublish
            ? "Church events published; leaders see their own calendar"
            : data.calendarOverlay
              ? "Leaders see their own calendar; no church calendar is set"
              : "Not set up",
        },
      ]
    : [];

  return (
    <Section id="google-workspace" title="Google Workspace">
      <InstallationNotice restriction="integrations" />
      <div className="space-y-4 px-4 py-4">
        {status.isPending ? (
          <p className="text-[13px] text-muted-foreground">Checking…</p>
        ) : !data ? (
          <p className="text-[13px] text-muted-foreground">The status could not be read.</p>
        ) : !data.configured ? (
          <div className="text-[13px] leading-relaxed text-muted-foreground">
            <p>
              Not connected. Oikonomia uses a Google Workspace service account with domain-wide
              delegation, set in the server&apos;s environment.
            </p>
            {data.problem ? (
              <p role="alert" className="mt-2 text-status-overdue">
                {data.problem}
              </p>
            ) : null}
            <p className="mt-2">
              The steps are in <code>docs/architecture/google-workspace.md</code>.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground">
              Connected to <span className="font-medium text-foreground">{data.domain}</span>.
              Oikonomia acts as the church mailbox for church things and as each leader for their
              own — Google&apos;s sharing still decides what anyone can open.
            </p>
            <ul className="grid gap-2 sm:grid-cols-3">
              {features.map(({ icon: Icon, label, on, detail }) => (
                <li key={label} className="rounded-xl border border-border px-3 py-2.5">
                  <p className="flex items-center gap-2 text-[14px] font-medium">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {label}
                    <span
                      className={
                        on
                          ? "ml-auto rounded-full bg-status-done-soft px-2 text-[11px] text-status-done"
                          : "ml-auto rounded-full bg-muted px-2 text-[11px] text-muted-foreground"
                      }
                    >
                      {on ? "On" : "Off"}
                    </span>
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{detail}</p>
                </li>
              ))}
            </ul>

            {data.calendarPublish ? <CalendarPublishing restricted={restricted} /> : null}

            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={restricted || check.isPending}
                busy={check.isPending}
                onClick={() => check.mutate()}
              >
                Check with Google
              </Button>
              {check.isError ? (
                <p role="alert" className="mt-2 text-[13px] text-status-overdue">
                  {errorMessage(check.error)}
                </p>
              ) : null}
              {check.data ? (
                <ul className="mt-3 space-y-1 text-[13px]">
                  {check.data.map((result) => (
                    <li key={result.scope} className="flex items-center gap-2">
                      {result.ok ? (
                        <Check className="size-3.5 text-status-done" aria-hidden />
                      ) : (
                        <X className="size-3.5 text-status-overdue" aria-hidden />
                      )}
                      {scopeLabel[result.scope] ?? result.scope}
                      <span className="text-muted-foreground">
                        {result.ok ? "allowed" : "refused — add this scope to the delegation"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

/**
 * The church calendar, as publishing has left it.
 *
 * Publishing runs on its own after every change; this is where an
 * administrator sees whether Google has kept up, and brings everything already
 * in Oikonomia across — the first time, or after a failure.
 */
function CalendarPublishing({ restricted }: { restricted: boolean }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["calendar-publishing"],
    queryFn: async () => unwrap(await withTimeout(fetchCalendarPublishing({ data: undefined }))),
  });
  const publish = useMutation({
    /* A church's whole calendar, one event at a time: longer than a click. */
    mutationFn: async () =>
      unwrap(await withTimeout(publishAllCalendarEvents({ data: undefined }), 180_000)),
    onSuccess: (view) => queryClient.setQueryData(["calendar-publishing"], view),
  });

  const view = publish.data ?? status.data;

  return (
    <div className="rounded-xl border border-border px-3 py-3">
      <p className="flex items-center gap-2 text-[14px] font-medium">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        Church calendar
      </p>
      {status.isPending ? (
        <p className="mt-1 text-[13px] text-muted-foreground">Reading…</p>
      ) : !view ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          What has been published could not be read.
        </p>
      ) : (
        <div className="mt-1 space-y-1 text-[13px] text-muted-foreground">
          <p>
            Publishing to <span className="text-foreground">{view.calendarId}</span>.{" "}
            {view.published === 1 ? "1 event is" : `${view.published} events are`} up to date
            {view.lastSyncedAt
              ? `; last published ${formatDistanceToNow(new Date(view.lastSyncedAt), { addSuffix: true })}.`
              : "; nothing has been published yet."}
          </p>
          {view.failing > 0 && view.lastError ? (
            <p role="alert" className="text-status-overdue">
              {view.failing === 1 ? "1 event" : `${view.failing} events`} could not be published.
              Latest: {view.lastError.message}
            </p>
          ) : null}
          {publish.data?.lastRun ? (
            <p>
              Published {publish.data.lastRun.published}, removed {publish.data.lastRun.removed}
              {publish.data.lastRun.failed > 0 ? `, ${publish.data.lastRun.failed} failed` : ""}.
            </p>
          ) : null}
        </div>
      )}
      <div className="mt-2">
        <Button
          type="button"
          variant="secondary"
          disabled={restricted || publish.isPending || !view}
          busy={publish.isPending}
          onClick={() => publish.mutate()}
        >
          Publish all events
        </Button>
        {publish.isError ? (
          <p role="alert" className="mt-2 text-[13px] text-status-overdue">
            {errorMessage(publish.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
