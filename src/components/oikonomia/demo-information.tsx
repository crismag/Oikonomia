import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { config } from "@/config";
import { intlClockOptions } from "@/domain/dates";
import type { DemoIdentityOption } from "@/lib/demo-api";

/**
 * What a visitor should know about the demonstration they are in.
 *
 * Only what is true of Oikonomia as it is: it says what is shared, what is
 * switched off and when the data returns to where it started — and nothing
 * about features that do not exist. It is not the help panel; it is about this
 * demonstration, not about how to use the product.
 */
export function DemoInformation({
  open,
  onOpenChange,
  viewer,
  refresh,
  remaining,
  identities,
  visitorsWelcome,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: { name: string; role: string } | null;
  refresh: { at: string; timeZone: string } | null;
  remaining: string | null;
  identities: DemoIdentityOption[];
  visitorsWelcome: boolean;
}) {
  const support = config.site.supportContact;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About this demo</DialogTitle>
          <DialogDescription>
            A shared, interactive demonstration of Oikonomia — the real application, with real
            permissions, running on invented data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-[13px] leading-relaxed">
          <Part title="Demo content disclaimer">
            <p>
              This demonstration contains curated and fictionalized content created solely to
              showcase the features and workflows of the application. It is not intended to
              represent a complete or historically accurate account of biblical events,
              conversations, timelines, or personal records.
            </p>
            <p className="mt-2">
              Biblical characters, relationships, circumstances, and events may be used as the
              foundation for the demonstration. Where possible, these are inspired by or consistent
              with their recorded experiences in Scripture. However, the reports, schedules, meeting
              notes, reflections, conversations, ministry records, and other application entries may
              be imagined, adapted, expanded, or placed into a modern context to demonstrate how the
              application can be used.
            </p>
            <p className="mt-2">
              For example, a biblical event may provide the basis for a leadership concern, personal
              reflection, ministry report, or mentoring conversation even though no such document or
              conversation is recorded in Scripture.
            </p>
            <p className="mt-2">
              These creative additions should therefore not be treated as biblical quotations,
              historical facts, theological claims, or additions to the biblical record.
            </p>
            <p className="mt-2">
              The purpose of this content is to provide realistic, engaging sample data for
              demonstrating the application&rsquo;s planning, reporting, collaboration, and
              leadership-management features while drawing meaningful inspiration from biblical
              people and their experiences.
            </p>
          </Part>

          <Part title="Exploring as">
            {viewer ? (
              <p>
                <span className="font-medium">{viewer.name}</span>
                <span className="text-muted-foreground"> — {viewer.role}</span>. What you can see
                and do is what this person could, with the same permissions. Switch people from the
                bar at the top of the page.
              </p>
            ) : (
              <p>Nobody yet. Choose someone on the sign-in page, or try it as yourself.</p>
            )}
          </Part>

          <Part title="Next refresh">
            {refresh ? (
              <p>
                <span className="font-medium">{at(refresh.at, refresh.timeZone)}</span>
                {remaining ? (
                  <span className="text-muted-foreground"> — in {remaining}</span>
                ) : null}
                . The demo returns to its original data every day at midnight, 6 am, noon and 6 pm (
                {refresh.timeZone}).
              </p>
            ) : (
              <p>The demo returns to its original data every six hours.</p>
            )}
          </Part>

          <Part title="Shared with other visitors">
            <p>
              Everyone exploring the demo uses the same data. Other visitors may be using the same
              people and changing the same records while you look — a change you did not make is
              probably someone else&rsquo;s, not a fault.
            </p>
            {identities.some((identity) => identity.active > 0) ? (
              <>
                <ul className="mt-2 space-y-0.5">
                  {identities
                    .filter((identity) => identity.active > 0)
                    .map((identity) => (
                      <li key={identity.id} className="flex justify-between gap-3">
                        <span>{identity.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {identity.active} active
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Sessions used in the last few minutes, yours included — a person open in two
                  browsers counts twice.
                </p>
              </>
            ) : null}
          </Part>

          <Part title="What changes, and what disappears">
            <p>
              What you do here is saved for real, until the next refresh. Then everything returns to
              how it started
              {visitorsWelcome
                ? ", and a temporary profile made with “Try it as yourself” is removed with everything created under it."
                : "."}
            </p>
          </Part>

          <Part title="Switched off in the demo">
            <ul className="list-disc space-y-1 pl-5">
              <li>Email is not sent, so sign-in links, password resets and invitations are off.</li>
              <li>Google sign-in and other outside services are not connected.</li>
              <li>
                Signing in with a password, signing other devices out, and adding people or changing
                who they are &mdash; name, email, access role &mdash; are off.
              </li>
              <li>Configuration, backups, exports and retention can be seen but not changed.</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              Oikonomia links to documents where they are kept rather than storing uploaded files,
              so there is nothing to upload here or in a church&rsquo;s own installation.
            </p>
          </Part>

          {support ? (
            <Part title="Found a problem?">
              <p>{support}</p>
            </Part>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** "Sunday 13 September, 12:00 PM EDT" on the church's clock. */
function at(iso: string, timeZone: string): string {
  const clock = intlClockOptions();
  return new Intl.DateTimeFormat(undefined, {
    ...clock,
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
