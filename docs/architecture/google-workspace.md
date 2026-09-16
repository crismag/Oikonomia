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

## Mail

When Workspace is configured, **all system mail goes through Gmail** as the
church mailbox (`src/server/google/gmail.ts`), using only the `gmail.send`
scope: invitations, sign-in links, password resets, data alerts and email
notices. Messages appear in that mailbox's Sent folder.

`delivery()` (`src/server/auth/delivery.ts`) chooses, in order:

1. **Demo Mode** — suppressed; nothing is sent or logged about the message.
2. **Gmail** — when Workspace is configured.
3. **SMTP** — when `OIKONOMIA_SMTP_HOST` and `OIKONOMIA_MAIL_FROM` are set.
4. **Console** — development only; nothing reaches anybody.

A broken Workspace configuration (an unreadable key, say) is logged and mail
falls back to SMTP or the console, so sign-in is not taken down with it.
Gmail and SMTP both count as able to deliver, so the sign-in screen offers
email links and **Account & security** says email notices can be sent.

The message is built by Oikonomia as plain UTF-8 text. Line breaks in a
subject are flattened and an address containing one is refused, so nothing
supplied by a leader can add a header.

### Email notices

A leader can choose, on **Account & security**, to be emailed when someone
asks something of them or gives them a meeting task — the two kinds the bell
counts. Both are off by default (`notice_email_preference`, migration 043).
The escalation and meeting services send at write time through a
`NoticeMailer` (`src/server/notices/notice-mailer.ts`), which emails only
people who opted in, never the person who acted, never a person without an
address or who has left, and never fails or delays the write.

An ask made of a position emails the people `resolveRecipients` names for
the person asking (their reporting leader, their ministries' heads, their
campus's or the church's leadership body). The email carries what was asked,
by whom, the date and a link — never a record's content, and never the title
of a meeting note the recipient may not read. `OIKONOMIA_URL` must be set for
links; without it in production nothing is sent.

## Drive

Files live in Drive. The binder keeps a registry record per file — the Drive
file id (`document.drive_file_id`), its `webViewLink` as the document's
address, its name and MIME type — and never the file's content. Uploads pass
through the server on their way to Drive and are not written anywhere.

| Operation                                                         | Acts as            | Oikonomia's own rule                                             |
| ----------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| Browse or search (ministry folder, My Drive, Shared with me)      | The leader         | Signed in                                                        |
| Choose a file to register                                         | The leader         | The same as registering a link (signed in); Drive is asked first |
| Upload (≤ 25 MB) or start a Doc/Sheet/Slides in a ministry folder | The leader         | Contributes to that ministry (`canContribute`)                   |
| Make a ministry's folder                                          | The church mailbox | Only when an upload or new file needs it                         |
| Live details for listed documents                                 | The leader         | Only documents the viewer may already discover                   |

- **Ministry folders** are created, named after the ministry, inside
  `OIKONOMIA_GOOGLE_DRIVE_ROOT`, the first time someone uploads or creates a
  file for that ministry, and recorded in `ministry_drive_folder` (migration
  `044`) so they are made once. Browsing never creates one. Without a Drive
  root there are no ministry folders: the Drive browser says so and offers only
  choosing from My Drive and Shared with me.
- **Sharing.** Because uploads and new files are made as the leader, the
  leaders who will add files need write access to the Drive root — the usual
  arrangement is a **shared drive** whose members are the church's leaders
  (Content manager), with the church mailbox as a Manager so it can make the
  ministry folders. Oikonomia does not change Drive sharing.
- **A Drive file is one record.** Choosing a file already registered files the
  existing record in the new ministry rather than creating a second.
- **Details on lists** (owner, last modified) are fetched per request as the
  viewer. A file Drive will not show them has no details and still opens its
  address, where Drive decides. Documents registered earlier by pasting a Drive
  or Docs address are read for a file id too.
- **Icons** are drawn by Oikonomia from the MIME type. Drive's `iconLink`
  images are served from Google's hosts, which the content security policy does
  not load.
- **Where Drive is not configured** (or in Demo Mode) the browser is not shown;
  **Add from Drive** falls back to pasting a link and says Drive is not
  connected on this installation. Every Drive write is refused in a
  demonstration (`operations.ts`, `integrations`).
- **Upload size.** Server functions read the multipart request into memory, so
  25 MB is enforced in the browser, in the service before the bytes are read,
  and in the Drive module. A reverse proxy's own body limit must allow it.

Code: `src/server/google/drive.ts` (requests), `src/server/services/drive-service.ts`
(rules), `src/lib/drive-api.ts` (server functions),
`src/components/oikonomia/drive-browser.tsx` and `drive-details.tsx` (screens).

## Security notes

- The key can act as any user in the domain for the listed scopes. Treat it
  like the database: readable only by the Oikonomia process, never committed,
  rotated if exposed (delete the key in Google Cloud and create a new one).
- Keep the scopes to the four above. Oikonomia asks for nothing else.
- Every feature is also refused by Oikonomia's own authorization: a leader can
  only reach Drive or a calendar as themselves.
