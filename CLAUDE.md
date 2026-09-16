# Claude context — Oikonomia product coherence

Use this file to continue **fixes and enhancements** after the product-coherence
pass. It is agent working context, not product documentation. The user-facing
truth lives in `docs/user-guide/` and `docs/architecture/`. If this file and
the code disagree, the code is right.

**Do not add this kind of material under `docs/`.** That tree describes the
current product only.

Owner: Cris (software engineer). Prefer complete user journeys over isolated
polish. Start remaining work from current `main` (the loop squash is
`3075d93` / PR #1). This file travels with the follow-up journeys that
landed after that squash.

## Where you are

| | |
| --- | --- |
| Repo | `github.com/crismag/Oikonomia` |
| Loop on `main` | `3075d93` — *Close the leadership loop from Home through the week (#1)* |
| This file | Repo root, `CLAUDE.md` (not under `docs/`). |
| Demo | https://oikosdemo.crishub.com/ — real app, real permissions, invented data. |

Local: `npm run dev` (often `:8080`). First person on a fresh DB hits `/setup`.

## What Oikonomia is

A **leadership binder** for church leaders. Not a membership CRM, not Sunday
service planning, not a ticket queue, not a file store.

Organising question: **what needs my attention?**

Identity of the church, as the product models it:

```
Church → Campus → Ministry → Group (LifeGroup / gathering) → Person
```

Signing in proves identity only. Capabilities come from **confirmed
assignments**, never from a hardcoded role name.

The loop the product must reinforce:

```
Leader sees what needs them
  → opens the record that owns it
  → writes / decides / records
  → puts follow-up on the week (dated, assigned)
  → watches the cycle on My Progress
```

A published report is **information**. It becomes work only when the author
explicitly asks (attention / action / approval). Do not turn arrivals into a
queue.

Home orients (“what do I do in the next minute?”). My Progress measures the
cycle. Team Overview is oversight of others. Do not collapse those three.

## Non-negotiable constraints

Preserve these. Do not weaken backend authorization to make a frontend
workflow easier. Do not add mock functionality, placeholder pages, hardcoded
sample behaviour, or fake integrations. Anything presented as functional must
work.

1. **Confirmed assignments.** A person can claim where they serve; an
   administrator confirms. Claims grant nothing. You cannot confirm your own.
   Onboarding writes claims through the assignment service.
2. **Attention ≠ access.** Drawing attention to a record does not make the
   recipient an audience. Undiscoverable reports look like they never existed
   (`not-found`, never `forbidden` for personal notes).
3. **Signing in proves identity only.** Capabilities come from confirmed
   assignments and the church’s own roles, never from a hardcoded role name.
   Do not branch UI or server on `"admin"` / `"bishop"` as strings — see
   `src/domain/types.ts` and `roles-are-not-permissions` tests.
4. **Demo mode.** Email, Google sign-in, inviting/changing people, config,
   backups, exports, retention are off or read-only. Check
   `src/server/installation/operations.ts` (`demo: "allowed"` vs not). Do not
   “enable” these in the UI when the server will refuse. Adding a server
   function requires an entry in that table
   (`src/installation-policy-classified.test.ts` fails otherwise).
5. **Files live in Drive; Oikonomia never stores file bytes.** The binder
   records where a document lives (a link, plus Drive's file id for Drive
   documents). Uploads stream through to Google Drive and are not kept. Do not
   add file storage.
6. **Status is computed.** Nothing lets a leader paint an obligation green.
   Done means done (attendance without a gathering report is still in progress).
7. **exactOptionalPropertyTypes is on.** Do not pass `prop={maybeUndefined}`;
   spread `{...(value ? { prop: value } : {})}`. Do not construct domain
   objects with `field: undefined` — omit the field.
8. **Routes are file-based TanStack Start** in `src/routes/`. No `src/pages/`.
   Meeting notes are `/meeting-notes?note=id`, not `/meeting-notes/:id`.
9. **Rate limiting is by design**, to protect the server. HTTP 429 on the
   public demo (or anywhere else) is that protection working, not a product
   bug and not leftover ops work. Do not loosen throttle, proxy, or demo
   limits to make browsing or tests easier. Auth throttle lives in
   `src/server/auth/throttle.ts`; address-based limits belong at the proxy
   (`docs/architecture/deployment.md`). A church install is still subject
   to the same idea.

## Stack (short)

TanStack Start + Router, React 19, Tailwind v4, shadcn, SQLite via
`better-sqlite3`, zod at every write boundary, vitest.

```
route → src/lib/*-api.ts (createServerFn + zod)
     → src/server/services/ (authorization + rules)
     → src/server/repositories/ (SQL, bound parameters)
```

`src/domain/` has no React and no database. Prefer putting new path/href/label
logic there so it can be tested without a screen.

Voice of the UI: calm, specific, no fake engagement. Empty success (“nothing
is waiting on you”) is correct. Comments in this repo explain *why*; match
that density on load-bearing code, not on every line.

Commands: `npx tsc --noEmit`, `npx eslint .` (errors fail; refresh warnings are
allowed), `npx vitest run`, `npm run build`, `npm run smoke`.

Node 22. `.npmrc` has `ignore-scripts=true` (better-sqlite3 prebuilds).

A few `scripts/ops` and `import-data-play` tests fail locally with
`ERR_UNKNOWN_FILE_EXTENSION` for `.ts` under Node. That is an environment
issue, not a product bug. Do not “fix” it unless you are asked to make those
scripts runnable without tsx.

## Two report systems (do not merge)

| What leaders mean | Record | Route | Client | Server |
| --- | --- | --- | --- | --- |
| **Leadership Reports** | `LeadershipReport` | `/leadership-reports`, `/leadership-reports/$reportId` | `useReports()` in `report-provider.tsx` | `leadership-report-service.ts` |
| **Reports to you** | work kind `"report"` | `/reports`, `/work/$workId` | `useWorkList({ kind: "report" })` | work service |

They are different records. A rename was the safe move. Do not unify them
without an explicit product decision.

`/reports` (Reports to you) nevertheless **shows** Leadership Reports: the
viewer's own as a shortcut and those that reached them from others
(`reportsToYou` over `useReports().visible`), because a church that writes
only Leadership Reports saw an empty page. It links to the records; nothing is
copied or merged. Work reports are listed below when any exist.

**Reach-Out** is a third thing: shared pastoral outreach notes
(`/reach-out`, `/reach-out/$reportId`). `authorId` is provenance, not
ownership. **Sharing rules are an open product decision** — the service does
not filter by viewer (`reach-out-service.ts`). Do not invent a confidentiality
model on a person page. `policy` on the record is stored and read by nothing.

## What this pass already shipped

The goal was not more features. It was to make the loop walkable.

### Home (`src/routes/index.tsx`)

- Overdue work: primary CTA continues that obligation (`nextAction`).
  “Add to the week” is secondary when something needs you.
- Attention rows show the next action (`ObjectRow.action`).
- **Asked of you** is its own card; rows use `escalationHref` to open the
  source record, not `/inbox`.
- **This week** uses `planningHref` so each item opens that item.
- LifeGroup titles use `gatheringHeadline` (“Set the venue” / “Unclaimed
  gathering”), not “Venue not set”.
- Empty cards have next-step links.
- Dismissible first-visit legend: `src/components/oikonomia/home-orientation.tsx`
  (localStorage `oikonomia.home-orientation.dismissed`).
- Greeting uses the full name on Home (`PersonName`) and Welcome
  (`context.person.name`).

### Planning / week

- `planningHref` + `PlanningSource.relatedId` in `src/domain/planning.ts`.
- Meeting tasks on Weekly Agenda navigate to `/meeting-notes?note=<meetingId>`.
- Weekly Agenda search param `open` opens that projected item once loaded
  (`src/routes/weekly-agenda.tsx`, `openItem`).

`planningHref` today:

- `source.type === "meeting-task"` → `{ to: "/meeting-notes", search: { note: relatedId } }`
- everything else → `{ to: "/weekly-agenda", search: { date, open: item.id } }`

### Inbox

- Shared `escalationHref` in `src/domain/escalation.ts` (meeting notes include
  `?note=`).
- Actions: **Put on my week** creates an agenda item via `useSchedule().addAgenda`
  (needed-by date, or today) and moves to `in-progress` if still `requested`.
  **Take it on** is status-only (`requested` → `in-progress`) and must stay
  that way.
  (`src/components/oikonomia/escalation-row.tsx`)

“Already on the week” is `isOnTheWeek` (`src/domain/escalation.ts`): an agenda
item carries `escalationId` (migration 039) and is matched on it; only items
without one (older) fall back to matching the request text. The server accepts
an `escalationId` only for an ask made of the viewer (`not-found` otherwise).
The week's task panel links back to where the ask was made while it is open.

### Person (`src/routes/people.$personId.tsx`)

Already connected, still filtered to what the viewer may discover:

- Readable **Leadership Reports** they authored (`useReports().visible` filtered
  by `authorId` — do not widen this).
- Gatherings they lead (`gatheringHeadline`) and recent attendance.
- People who report to them, by name.
- Work records involving them (`readable` from the work list).
- Reach-Out they wrote or contributed to, and meeting notes they wrote or
  took down — fetched by `personId`, not filtered client-side from a search page.

### Navigation (`src/components/oikonomia/nav.ts`)

| Group | Items |
| --- | --- |
| Home | Home, My Progress |
| My Work | Weekly Agenda, Monthly Calendar, Meeting Notes, Reach-Out, Leadership Reports, **Goals** |
| Shared | LifeGroup, Ministry |
| Library (was More) | Documents & Forms, Resource Search |
| Oversight (under Leadership context) | Leadership Inbox, Team Overview, **Reports to you** |
| Organization | People, Attendance, Leadership journal, Administration |

Sidebar skips a group heading when it would duplicate the context label
(`src/components/oikonomia/app-sidebar.tsx`). Do not add or reorder Binder
sections without product approval. Do not add Forms or Checklists as peer
sidebar items.

### Other

- Goals empty year: “No goals set for this year yet” vs filter miss
  (`src/routes/goals.index.tsx`). Ministry page already says the same
  (`src/routes/ministries.$ministryId.tsx`).
- Onboarding tour copy updated (`src/domain/onboarding.ts`) — includes Goals
  and “put on your week”.
- User guide updated to match: `docs/user-guide/README.md`, `your-binder.md`,
  `leadership.md`, `organisation.md`.

### Helpers to reuse

| Helper | File | Use |
| --- | --- | --- |
| `planningHref` | `src/domain/planning.ts` | Any projected week/month item → route |
| `planningForDay` / `planningForDays` | same | Project entries + agenda + meeting tasks |
| `escalationHref` | `src/domain/escalation.ts` | Any inbox/ask → source record |
| `gatheringHeadline` | `src/domain/lifegroup.ts` | Gathering title when date is shown beside it |
| `ObjectRow.action` | `src/components/oikonomia/workspace-card.tsx` | Named next step on a Home row |
| `HomeOrientation` | `src/components/oikonomia/home-orientation.tsx` | First-visit Home legend |
| `useSchedule().addAgenda` | `schedule-provider.tsx` | Put something on the week |
| `useLeadershipInbox()` | `escalation-provider.tsx` | Asks directed at this viewer |
| `useReports().visible` | `report-provider.tsx` | Discoverable Leadership Reports |
| `useMyMeetingTasks()` | `meeting-provider.tsx` | Tasks assigned to this leader (week) |
| `contributorsOf` | `src/domain/reach-out.ts` | Who has worked on a Reach-Out report |
| `PutOnWeekButton`, `AskedOfYou` | `src/components/oikonomia/put-on-week.tsx` | Date an action ask; recipient card on a source record |
| `weekDateFor`, `isOnTheWeek`, `actionsAskedOn` | `src/domain/escalation.ts` | Which day, already filed?, this viewer's actions on a record |
| `tasksForDay` | `src/domain/planning.ts` | A day's agenda items + meeting tasks, same ids as the week |
| `meetingTaskWeek` | same | Whether a meeting task has reached a week, and what it lacks |

Tests: `src/domain/planning.test.ts`, `src/domain/escalation.test.ts`,
`src/domain/lifegroup.test.ts`.

## Remaining work (prioritized)

Do not start a speculative wishlist. Prefer connecting capabilities that
already exist.

### P0 — still real

- **Invitations that actually arrive** in production (SMTP). Demo correctly
  switches mail off. A church must have it configured and tested.
- **First-church setup** is done: an administrator's Home shows **Set up your
  church** (`church-setup-card.tsx`, `src/domain/church-setup.ts`), computed
  from `fetchChurchSetup` (administrator-only counts). The leadership cycle
  still shows beside it by design — the card says the rest of Home is about
  the administrator alone until the church is entered.

Rate limiting is **not** remaining work. It is how the server protects itself.

### P1 — done

All five journeys are shipped and browser-verified. What to know before
touching them:

1. **Report → week.** `AskedOfYou` (in `put-on-week.tsx`) is mounted on
   leadership reports, Reach-Out reports and work records, driven by
   `actionsAskedOn(inbox.mine, sourceType, sourceId)`. Inbox row and card share
   `PutOnWeekButton`. Take it on is still status-only.
2. **Meeting tasks.** Create task defaults `assigneeId` to the viewer and
   focuses the new row's date. Each row renders `meetingTaskWeek`. The "On your
   week" link is `?date=` only — **never `open=` for a meeting task**: the week
   opens a meeting task by navigating to its note, so `open=` bounces back.
3. **Person.** `fetchReachOut` / `fetchNotes` accept `personId` (contracts in
   `reach-out-contract.ts` / `meeting-contract.ts`, SQL in the repositories).
   Reach-Out matches author or `contributors` (via `json_each`); notes match
   `author_id` or `note_taker_id` and stay inside `readableBy`. The provider
   lists were deliberately not used: they are one page shaped by the last search.
4. **Month.** Day panel and phone list use `tasksForDay` + `planningHref`.
   Grid cells still show events only.
5. **Unreadable notes.** `fromMeetingTask` sets `relatedId` only when the
   viewer may read the note; `planningHref` then sends the task to its day on
   the week, and `weekly-agenda.tsx` `openItem` no longer falls back to the
   task's `meetingId`.

Also fixed: Reach-Out **Add report** used to 404 (the page threw not-found
before selecting the new report). `ReachOutStore.selectedId` exists for that.

### P2 — usability

- Reach-Out's page description and the Home legend (Oikonomia / My Binder /
  Leadership) now explain themselves in one sentence each.
- Greetings use the full name on both Home and Welcome.
- Goals empty state on ministry vs `/goals` — already close; keep wording
  consistent if you touch either.
- Mobile: checked at 390px (Home, week, month, meeting editor, reports,
  inbox, administration) — no horizontal overflow; the meeting toolbar wraps.
  Fix a new one when you are on that screen, not as a sweep.

### P3 — do not build yet (product decisions required)

| Hold | Prerequisite |
| --- | --- |
| Merge **Leadership Reports** with **Reports to you** | Explicit decision: what *is* a ministry report? They are different records. |
| Push, or email reminders beyond notices | In-app notices (`notices-bell.tsx`, `src/domain/notices.ts`): the bell counts only unseen asks and meeting tasks from someone else; past-due is listed, never counted; opening marks seen via `markSeen`. **Email notices exist** (Cris's decision) for those same two kinds only, opt-in — see *Email notices* below. Do not add push, email about past-due or reports, or count overdue on the bell without Cris. |
| Two-way calendar sync (Google) | **Built: publish + overlay** through Workspace delegation (`src/server/google/calendar.ts`, migration 045): church events and gatherings are published one way to `OIKONOMIA_GOOGLE_CALENDAR_ID`; a leader's own calendar is a read-only overlay on the week and month day panel, never counted. Oikonomia stays the source of truth. **Two-way sync is not built** and needs Cris's decision. Demo stays disconnected. |
| CSV import / member import | Church setup journey first, or you import into a shapeless org. |
| File storage in Oikonomia | Files live in Drive. Uploads exist only as a pass-through to Drive (`drive-service.ts`). |
| Replace “My Binder” | The metaphor *is* the product. It needed a sentence, not a rename. |
| Sunday service attendance, giving, volunteer rotas | Other products. |
| Custom workflow engine / enterprise RBAC UI | Roles are already church-defined capability bundles. |
| Reach-Out access model | Open decision in `reach-out-service.ts` / `modules/REACH-OUT.md`. Do not guess. |

## Goals are scoped (migration 038)

`Goal.scope` is `personal | ministry | other`, chosen at creation
(`createGoal` is a discriminated union in `goals-contract.ts`). Never infer
whose a goal is from `ownerId` / `ministryId`: a personal goal may carry a
`ministryId` as "relates to", and a ministry goal usually has an owner.

- Edit: personal → owner only; ministry → `canContribute` in that ministry;
  other → members of `groupId` (`authorize.ts`). Creation is checked with the
  same rule.
- Lists never pool goals across owners: `goalsForMyWork` (Goals tabs),
  `goalsByWhose` (Reports to you), `ministryGoals` /
  `personalGoalsRelatingTo` (ministry page). Home's goal obligation is goals
  the viewer owns.
- The Data Play importer sets scope from the file (`2026-goals.md` personal,
  `content/ministry-goals/` ministry) and skips sections without `Status`.
  The demo baseline must be re-imported for existing demo data to be right;
  the migration's backfill guesses (ministry if filed under one).

## Confidential reports and reviewers (Cris's decisions)

- **Confidential is the author's explicit mark** (`leadership_report.confidential`,
  migration 042) — never inferred from visibility. It changes handling, not
  access: every API reply passes through `forBrowser`, which strips content
  (`contentWithheld`) for anyone but the author; the page opens it with
  `fetchReport` (`useOpenedReport`), and `get` records
  `report.confidential.read` in `data_audit`. The author sees who opened it.
- **There is no reviewer/approver of a leadership report.** Reports go to their
  distribution (leader, head, group); the author tags attention/action/approval
  through escalations. Do not add an assigned-reviewer field.
- **Drafts are author-only.** `reportCapabilities` returns nothing to anyone
  but the author while the status's `visibleToAudience` is false, whatever the
  visibility. Sharing is the author's explicit move to Shared/Published.
  "Shared" visibility means explicitly shared by the author — leave it.
- **Events are shared on creation.** Calendar entries (ministry, LifeGroup,
  church) and LifeGroup gatherings are readable by everyone signed in; only
  entries written inside a gathering have their own visibility.
- **Document registration** does not check the ministry on the server, by
  decision: documents live anywhere and are linked by their leader.

## Drive-backed documents (Cris's decision)

Files always live in Google Drive; the registry keeps a record with
`document.drive_file_id` / `drive_mime_type` (migration 044) and shows live
metadata. `src/server/google/drive.ts` (requests), `drive-service.ts` (rules),
`drive-api.ts` (browse, register, upload via FormData, create Doc/Sheet/Slides,
details), `drive-browser.tsx` / `drive-details.tsx` (UI, only when
`methods.workspace.drive`; otherwise the paste-link form says Drive is not
connected on this installation).

- Everything acts **as the viewer** (`person.email`, must be in the domain);
  only the ministry folder is created as the church mailbox, under
  `driveRoot`, on first upload/create (`ministry_drive_folder`). Browsing never
  creates it. No `driveRoot` → no ministry folder features.
- Choosing a file follows the registration rule (signed in); upload/create
  require `canContribute`. One Drive file = one record (re-choosing associates).
- Drive icons are drawn locally: CSP `img-src` does not load Google's
  `iconLink`, and should not be loosened for it.

## Access and accounts (Cris's decisions)

- **Nobody grants themselves access.** `refuseSelfGrant` in
  `organization-service.ts` refuses an administrator confirming their own
  assignment, adding themselves to a ministry or group, or becoming a lead.
  Narrowing is allowed. The admin UI hides those choices for oneself.
- **Invitations are bulk, by address.** *Invite people*
  (`invite-people.tsx` → `inviteManyToOikonomia` → `auth.inviteByEmail`)
  creates a person per unknown address (name = the address) and an invited
  account; a 7-day single-use link (`INVITATION_LIFETIME_MS`) or "registered"
  when mail is off. Active accounts are left alone. Welcome asks the invitee's
  name once (`awaitsOwnName`, `giveOwnName`), refused afterwards.
- **Change password** is on Account & security (`changePassword`; keeps this
  session, ends the others).

## Email notices (opt-in)

System mail goes through `delivery()` (`src/server/auth/delivery.ts`): Demo
Mode suppressed → Gmail as the church mailbox when Google Workspace is
configured (`src/server/google/gmail.ts`) → SMTP → console. Gmail counts as
able to deliver, so `canDeliver()` / `methods.emailDelivery` are true with it.

A leader chooses on **Account & security** which notices are also emailed
(`notice_email_preference`, migration 043; `fetchEmailNotices` /
`setEmailNotice` in `notice-email-api.ts`, demo `allowed` because delivery is
suppressed there). Kinds today: `ask` and `meeting-task`, default off.

- Services send at write time through an injected `NoticeMailer`
  (`src/server/notices/notice-mailer.ts`): escalation `raise`; meeting
  `createTask`, and `updateTask` when the assignee changes. The mailer drops
  the actor, anyone not opted in, anyone without an address or inactive, and
  never throws or waits — a failed send is logged, the write stands.
- An ask to a position emails `resolveRecipients(role, requester)` — the
  holders *for that requester* — which is narrower than the inbox's
  `addressedTo` (any holder of that kind of position). Everyone emailed can
  also see it in the inbox.
- Content (`src/domain/email-notices.ts`): who, what was asked/assigned, date,
  link (`siteUrl()` + `escalationHref` or the note / week path). No record
  content; a meeting note the recipient may not read is neither named nor
  linked.
- **Adding a kind:** add it to `EMAIL_NOTICE_KINDS` and `emailNoticeKinds`
  (the switch appears on its own), compose it in `email-notices.ts`, call
  `mailer.notify({ kind, actorId, recipientIds, compose })` from the service
  that makes the write, pass `noticeMailerFor(db)` in that API file, and
  update `knowledge/oikonomia/account/email-notices.md` and
  `docs/user-guide/getting-in.md`. No migration: kinds are stored as text.

## Appearance and themes

Four themes (`src/domain/appearance.ts`: glass default, vineyard, daybreak,
quiet) × light/dark/system, kept per browser in localStorage and applied before
paint by `APPEARANCE_BOOT_SCRIPT` in `__root.tsx`. Every colour, face, radius
and shadow is a token in `src/styles.css`; add a theme by adding a
`[data-theme]` block and its `.dark[data-theme]` block with **every** token.

- **Use tokens, never raw colours.** Area colour: put `data-area="<area>"` on a
  container (`areaFor(pathname)` in `nav.ts`; `<main>` already has it), then
  `bg-area`, `bg-area-soft`, `bg-area-tint`, `text-area-ink`, and
  `text-on-area` on anything filled with `bg-area`.
- `PageHeader` is a hero board in the page's area colour; `Section` and
  `WorkspaceCard` are rounded surfaces with `shadow-card`.
- Colour is wayfinding only; it never carries meaning without words.

## The Guide (right-hand help panel)

For leaders and users first: help using the section they are on and finding
where to do their work; administration help is secondary. Deterministic, not AI. Core in `src/features/guide` (no imports from the rest
of the app); Oikonomia adapter, route table (`context.ts`) and semantic
destinations (`destinations.ts`) in `src/integrations/guide`; help in
`knowledge/oikonomia/**.md`. Developer docs: `development/guide/`.

- It navigates and never acts; destinations follow `navFor(persona)`. Do not
  add authorization or demo checks to it.
- **When a screen changes, update its knowledge file** as well as
  `docs/user-guide/`. `npx vitest run src/integrations/guide` validates the
  corpus (links, ids, destinations, capabilities).
- `GUIDE_ENABLED` turns it off.

## How to work in this codebase

When adding a link between modules:

- Point at the **authoritative record**, never a copy.
- Reuse `planningHref` / `escalationHref` rather than a third path table.
- If the viewer may not discover the record, the link must not exist (same
  as a missing record).

When changing navigation: `src/components/oikonomia/nav.ts` says not to add
or reorder Binder sections without product approval. Goals was added because
Home already sent people there (a page with no door).

Update `docs/user-guide/` when user-visible names or journeys change. Do not
leave the guide describing “More” or a Goals-less My Work.

### File map for the loop

| Concern | Files |
| --- | --- |
| Home dispatch | `src/routes/index.tsx` |
| Week | `src/routes/weekly-agenda.tsx` |
| Month | `src/routes/monthly-calendar.tsx` |
| Inbox | `src/routes/inbox.tsx`, `escalation-row.tsx` |
| Raise an ask | `escalation-control.tsx` |
| Person | `src/routes/people.$personId.tsx` |
| Leadership report | `src/routes/leadership-reports.$reportId.tsx` |
| Work-kind report | `src/routes/reports.tsx`, `work.$workId.tsx` |
| Meetings | `src/routes/meeting-notes.tsx`, `meeting-editor.tsx` |
| Obligations | `src/domain/obligations.ts`, `dashboard-service.ts` |
| Authz verbs | `src/domain/authorize.ts` (render); services enforce |
| Demo denials | `src/server/installation/operations.ts` |
| Invitations | `invite-people.tsx`, `auth-api.ts`, `auth-service.ts` |
| Help panel | `src/features/guide`, `src/integrations/guide`, `knowledge/oikonomia` |

### TypeScript gotchas this pass already hit

- `ObjectRow.action={maybeUndefined}` fails `exactOptionalPropertyTypes` —
  spread the prop.
- Test fixtures: construct `Gathering` without `venueId: undefined`.
- Sidebar: a ternary that returns a heading must have `: null` (Prettier
  SyntaxError otherwise).

## Suggested first tasks for the next session

1. Remaining P0 is operational: SMTP delivery for invitations on a real
   installation. Nothing in the app to build until that is tested.
2. Everything else open is P3 and needs Cris's decision first. Do not loosen
   rate limits, and do not open a PR for glossary, notifications, or merging
   report types unless Cris asks.
3. For browser verification with realistic data, build a scratch church from
   the Data Play corpus (`scripts/demo-content/import-data-play.mts`); never
   seed sample data into the application.

## Verification bar

After changes: no dead ends, no unfinished-looking pages, no console errors
on the journey you touched, empty states still meaningful, authorization
still refuses, demo restrictions still refuse. `tsc`, eslint errors, vitest
on what you touched, and a browser pass on that journey.

Check every surface that shares the state you changed (Home, week, inbox,
person, the source record). A change that works on one page and stranding
another is a regression.

The success test is still:

**What is happening? Who needs attention? What should I do next? What have we
agreed to do? Are our people and ministries progressing?**
