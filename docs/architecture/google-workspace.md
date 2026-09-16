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

## Security notes

- The key can act as any user in the domain for the listed scopes. Treat it
  like the database: readable only by the Oikonomia process, never committed,
  rotated if exposed (delete the key in Google Cloud and create a new one).
- Keep the scopes to the four above. Oikonomia asks for nothing else.
- Every feature is also refused by Oikonomia's own authorization: a leader can
  only reach Drive or a calendar as themselves.
