# Google Workspace

Oikonomia connects to Google Workspace — Gmail, Drive and Calendar — through
**one service account with domain-wide delegation**. Leaders connect nothing.
It works only for a church on **Google Workspace**; a free Gmail account cannot
delegate.

## How it acts

Oikonomia never acts as itself. Each call names a person in the church's
domain:

| Acting as            | For                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| The church mailbox   | System email; the church Drive folder; publishing the church calendar |
| The signed-in leader | Their own Drive files; reading their own calendar for their week      |

Because it acts as the leader, **Google's own sharing decides what they can
open**. Oikonomia grants nothing Google would not.

It refuses to act as any address outside the configured domain, and a public
demonstration (`OIKONOMIA_DEMO_MODE=true`) never reaches Google at all.

No token is stored. Access tokens are minted from the key when needed and kept
in memory until shortly before they expire.

## Setting it up

1. **Google Cloud project.** In the church's own Google Cloud console, create
   (or choose) a project and enable the **Gmail API**, **Google Drive API** and
   **Google Calendar API**.
2. **Service account.** Create a service account in that project. Create a
   **JSON key** for it and store the file on the server, readable only by the
   Oikonomia process. Note the service account's **Client ID** (numeric).
3. **Domain-wide delegation.** In the Workspace **Admin console → Security →
   Access and data control → API controls → Manage domain-wide delegation**,
   add the Client ID with exactly these scopes:

   ```
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/drive
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.readonly
   ```

4. **Church mailbox.** Choose the Workspace user Oikonomia sends mail as and
   keeps church files and the church calendar under — for example
   `office@yourchurch.org`.
5. **Environment.**

   | Variable                       | Required | Meaning                                                             |
   | ------------------------------ | -------- | ------------------------------------------------------------------- |
   | `OIKONOMIA_GOOGLE_SA_KEY_FILE` | yes\*    | Path to the service account JSON key                                |
   | `OIKONOMIA_GOOGLE_SA_KEY`      | yes\*    | The JSON key itself, instead of a file                              |
   | `OIKONOMIA_GOOGLE_DOMAIN`      | yes      | The Workspace domain, e.g. `yourchurch.org`                         |
   | `OIKONOMIA_GOOGLE_APP_USER`    | yes      | The church mailbox, in that domain                                  |
   | `OIKONOMIA_GOOGLE_DRIVE_ROOT`  | no       | The church Drive folder (or shared drive) id ministry folders go in |
   | `OIKONOMIA_GOOGLE_CALENDAR_ID` | no       | The Google calendar church events are published to                  |

   \* One of the two.

6. **Check.** Restart Oikonomia, open **Administration → Google Workspace** and
   choose **Check with Google**. Each scope should say _allowed_; a refused one
   is missing from the delegation in step 3.

Leaders' **person records must carry their Workspace email address** for Drive
and their calendar to work as them.

## Calendar

Oikonomia stays the source of truth for church events. Google Calendar gets a
**published copy** of the church calendar, and each leader gets a **read-only
overlay** of their own calendar on their week. There is no two-way sync.

### Publishing (`src/server/google/calendar.ts`)

On only when `OIKONOMIA_GOOGLE_CALENDAR_ID` is set. As the church mailbox
(`calendar.events`), into that calendar:

- **What.** Every schedule entry, and every LifeGroup gathering that is not
  cancelled. A gathering's location is its venue's name, never an address.
- **Shape.** All-day (a date, exclusive end) when the entry is all day or has
  no start time; otherwise local `dateTime` plus the site timezone
  (`site.json` → `timezone`), an hour long if it has no end. Rhythms become an
  `RRULE` — `DAILY`, `WEEKLY;BYDAY`, fortnightly as `WEEKLY;INTERVAL=2;BYDAY`,
  `MONTHLY`, `YEARLY` — starting on the first date the schedule's own rule
  lands on, with `UNTIL` from the series end (a date, or the last start in UTC
  when timed). Dates removed from a series ("this occurrence" deleted or
  lifted out as its own entry) become `EXDATE`s. The description carries the
  note, the ministry, the meeting link and a link back (`OIKONOMIA_URL`).
- **Recognisable.** Every event carries
  `extendedProperties.private.oikonomiaSource` (`schedule-entry` | `gathering`)
  and `oikonomiaId`.
- **When.** The calendar and LifeGroup services are given a publisher at the
  API composition edge (`calendarPublisherFor`, `calendar-publishing.ts`) and
  tell it after each successful write: create, update at any scope, delete,
  duplicate; gathering create, edit, join/leave, cancel (removes the event) and
  restore. Publishing runs after the response is decided and never fails or
  delays the write. Attempts for one record are serialised, so a quick
  correction cannot race into a second event.
- **Bookkeeping.** `calendar_publication` (migration 045): source type and id →
  Google event id, calendar id, last synced, last attempt, last error. An update
  uses the recorded event id (and inserts again if the event was deleted in
  Google); a failure is recorded, not thrown.
- **Publish all.** **Administration → Google Workspace → Publish all events**
  (`publishAllCalendarEvents`, administrators only, refused in a demonstration)
  publishes or updates every record through the recorded ids — running it twice
  adds nothing — and removes events for records that no longer exist. The card
  shows how many events are current, when the last one was published, and the
  latest failure.

Records written outside the services (an import) reach Google on the next
**Publish all events**. Editing a published event in Google is overwritten by
the next publish of that record.

### Overlay (`readOverlay`)

`fetchGoogleCalendarOverlay` reads the **viewer's own** primary calendar as
them (`calendar.readonly`) for the range a screen shows (a week, or a month
grid; at most 45 days): `singleEvents=true`, `orderBy=startTime`, bounds at
midnight in the site timezone. It returns only title, date, start/end or
all-day, location and the Google link, and keeps nothing. Events marked as
published by Oikonomia are dropped so nothing appears twice.

The address is the viewer's person record (or, failing that, their account). If
it is not in the Workspace domain (`mayActAs`) nothing is asked of Google and
the reply says `no-workspace-email`; if Google refuses, `google-refused`. The
week shows that once and is otherwise unaffected. Weekly Agenda (Agenda and
Calendar views) and the Monthly Calendar day panel draw these read-only, in a
dashed box labelled _From your Google Calendar_, with a show/hide toggle kept
in `localStorage`. They are never planning items and never counted on Home or
My Progress.

## Security notes

- The key can act as any user in the domain for the listed scopes. Treat it
  like the database: readable only by the Oikonomia process, never committed,
  rotated if exposed (delete the key in Google Cloud and create a new one).
- Keep the scopes to the four above. Oikonomia asks for nothing else.
- Every feature is also refused by Oikonomia's own authorization: a leader can
  only reach Drive or a calendar as themselves.
