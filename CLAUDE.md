# Claude context — Oikonomia product coherence

Use this file to continue **fixes and enhancements** after the product-coherence
pass. It is agent working context, not product documentation. The user-facing
truth lives in `docs/user-guide/` and `docs/architecture/`. If this file and
the code disagree, the code is right.

**Do not add this kind of material under `docs/`.** That tree describes the
current product only.

Owner: Cris (software engineer). Prefer complete user journeys over isolated
polish. Work on branch `cursor/product-coherence-e241`; PR is
https://github.com/crismag/Oikonomia/pull/1.

## Where you are

| | |
| --- | --- |
| Repo | `github.com/crismag/Oikonomia` |
| Branch | `cursor/product-coherence-e241` (from `main`) |
| PR | https://github.com/crismag/Oikonomia/pull/1 |
| Loop commit | `be8a715` — *Close the leadership loop from Home through the week* |
| Follow-up | `d97f4f7` — *Say when a year has no goals yet, not that filters hid them* |
| First handoff | `089c8ed` — initial Claude context; this file supersedes it |
| Demo | https://oikosdemo.crishub.com/ — real app, real permissions, invented data. Was rate-limited (HTTP 429) during the audit; do not treat a 429 as a product bug. |

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
5. **Documents are links, not uploads.** The binder records where a document
   lives. Do not add file storage.
6. **Status is computed.** Nothing lets a leader paint an obligation green.
   Done means done (attendance without a gathering report is still in progress).
7. **exactOptionalPropertyTypes is on.** Do not pass `prop={maybeUndefined}`;
   spread `{...(value ? { prop: value } : {})}`. Do not construct domain
   objects with `field: undefined` — omit the field.
8. **Routes are file-based TanStack Start** in `src/routes/`. No `src/pages/`.
   Meeting notes are `/meeting-notes?note=id`, not `/meeting-notes/:id`.

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
- Greeting uses full `PersonName` (Welcome still uses first token of
  `person.name`).

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

Dedup for “already on the week”: `schedule.agenda.some(entry => entry.text === item.request && !entry.completed)`.
There is **no** `relatedEscalationId` on agenda items. Do not add a schema
column unless Cris asks; matching by request text is the current contract.

### Person (`src/routes/people.$personId.tsx`)

Already connected, still filtered to what the viewer may discover:

- Readable **Leadership Reports** they authored (`useReports().visible` filtered
  by `authorId` — do not widen this).
- Gatherings they lead (`gatheringHeadline`) and recent attendance.
- People who report to them, by name.
- Work records involving them (`readable` from the work list).

- Reach-Out they wrote or contributed to, and meeting notes they wrote or
  took down (see P1 below — fetched by `personId`, not filtered client-side).

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
already exist. Pick **one** P1 journey and finish it end-to-end (empty states,
domain test, browser pass) before opening another.

### P0 — still real, not in this PR

- **Demo 429s** on oikosdemo.crishub.com. Ops / rate-limit config, not a UI
  feature. A church install does not hit this.
- **Invitations that actually arrive** in production (SMTP). Demo correctly
  switches mail off. A church must have it configured and tested.
- **First-church setup beyond `/setup`.** First admin exists. A guided
  “campus → ministries → invite three leaders” is still a gap. Empty Home
  still shows the leadership *cycle* obligations (Reach-Out report, monthly
  leadership report, lay out the month) even with no church data — that is
  existing dashboard behaviour (`dashboard-service.ts`), not a regression.
  Decide whether a brand-new admin should see the cycle or a “set up the
  church first” path. If cycle items on an empty church read as fake work,
  fix when an obligation has no underlying record yet — do not hide the card.

### P1 — done (follow-up commits `3711e57`…`6526e2f`)

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

- Reach-Out's page description and the Home legend (My Binder / Leadership)
  now explain themselves in one sentence each. "Oikonomia" itself is still
  unexplained; same rule if you touch it — a sentence, not a tour.
- Home greeting uses full name (`PersonName`); Welcome uses
  `context.person.name.split(" ")[0]` (`welcome.tsx`). Decide one. First name
  is warmer for Welcome; keep full name on Home if you split the difference —
  then say so in copy, do not leave it accidental.
- Goals empty state on ministry vs `/goals` — already close; keep wording
  consistent if you touch either.
- Mobile: drawer exists; toolbars overflow on some workspaces (meeting
  editor). Fix when you are on that screen, not as a sweep.
- “What you are carrying” on a brand-new admin still shows 3 cycle items.
  If that reads as fake work, the fix is in
  `src/server/services/dashboard-service.ts`.

### P3 — do not build yet (product decisions required)

| Hold | Prerequisite |
| --- | --- |
| Merge **Leadership Reports** with **Reports to you** | Explicit decision: what *is* a ministry report? They are different records. |
| Email reminders / notifications | Loop must stay honest; do not notify people into a queue. In-app overdue is enough first. |
| Calendar sync (Google) | Real OAuth, not a fake “connected” badge. Demo must stay disconnected. |
| CSV import / member import | Church setup journey first, or you import into a shapeless org. |
| File uploads | Contradicts “documents are links”. |
| Replace “My Binder” | The metaphor *is* the product. It needed a sentence, not a rename. |
| Sunday service attendance, giving, volunteer rotas | Other products. |
| Custom workflow engine / enterprise RBAC UI | Roles are already church-defined capability bundles. |
| Reach-Out access model | Open decision in `reach-out-service.ts` / `modules/REACH-OUT.md`. Do not guess. |
| `relatedEscalationId` on agenda items | Would make Put on my week robust; it is also a schema change. Not required for P1. |

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

### TypeScript gotchas this pass already hit

- `ObjectRow.action={maybeUndefined}` fails `exactOptionalPropertyTypes` —
  spread the prop.
- Test fixtures: construct `Gathering` without `venueId: undefined`.
- Sidebar: a ternary that returns a heading must have `: null` (Prettier
  SyntaxError otherwise).

## Suggested first tasks for the next session

1. The P0 first-church question needs Cris's decision before code: should a
   brand-new admin with no church data see the leadership cycle on Home, or a
   "set up the church first" path?
2. P2 Welcome vs Home name also wants a decision, not a guess.
3. Do not open a second PR for glossary, notifications, or merging report
   types unless Cris asks.

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
