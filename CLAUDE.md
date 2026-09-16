# Claude context — Oikonomia product coherence

Use this file to continue **fixes and enhancements** after the product-coherence
pass. It is agent working context, not product documentation. The user-facing
truth lives in `docs/user-guide/` and `docs/architecture/`. If this file and
the code disagree, the code is right.

**Do not add this kind of material under `docs/`.** That tree describes the
current product only.

## Where you are

| | |
| --- | --- |
| Repo | `github.com/crismag/Oikonomia` |
| Branch | `cursor/product-coherence-e241` (from `main`) |
| PR | https://github.com/crismag/Oikonomia/pull/1 |
| Head (at writing) | `d97f4f7` — *Say when a year has no goals yet, not that filters hid them* |
| Prior commit | `be8a715` — *Close the leadership loop from Home through the week* |
| Demo | https://oikosdemo.crishub.com/ — real app, real permissions, invented data. Was rate-limited (HTTP 429) during the audit; do not treat a 429 as a product bug. |

Owner: Cris (Software engineer). Prefer complete user journeys over isolated polish.

## What Oikonomia is

A **leadership binder** for church leaders. Not a membership CRM, not Sunday
service planning, not a ticket queue, not a file store.

Organising question: **what needs my attention?**

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
   recipient an audience. Undiscoverable reports look like they never existed.
3. **Signing in proves identity only.** Capabilities come from confirmed
   assignments and the church’s own roles, never from a hardcoded role name.
   Do not branch UI or server on `"admin"` / `"bishop"` as strings — see
   `src/domain/types.ts` and `roles-are-not-permissions` tests.
4. **Demo mode.** Email, Google sign-in, inviting/changing people, config,
   backups, exports, retention are off or read-only. Check
   `src/server/installation/operations.ts` (`demo: "allowed"` vs not). Do not
   “enable” these in the UI when the server will refuse.
5. **Documents are links, not uploads.** The binder records where a document
   lives. Do not add file storage.
6. **Status is computed.** Nothing lets a leader paint an obligation green.
   Done means done (attendance without a gathering report is still in progress).
7. **exactOptionalPropertyTypes is on.** Do not pass `prop={maybeUndefined}`;
   spread `{...(value ? { prop: value } : {})}`.
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

Commands: `npx tsc --noEmit`, `npx eslint .` (errors fail; refresh warnings are
allowed), `npx vitest run`, `npm run build`, `npm run smoke`.

Node 22. `.npmrc` has `ignore-scripts=true` (better-sqlite3 prebuilds).

A few `scripts/ops` and `import-data-play` tests fail locally with
`ERR_UNKNOWN_FILE_EXTENSION` for `.ts` under Node. That is an environment
issue, not a product bug. Do not “fix” it unless you are asked to make those
scripts runnable without tsx.

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

### Planning / week

- `planningHref` + `PlanningSource.relatedId` in `src/domain/planning.ts`.
- Meeting tasks on Weekly Agenda navigate to `/meeting-notes?note=<meetingId>`.
- Weekly Agenda search param `open` opens that projected item once loaded
  (`src/routes/weekly-agenda.tsx`).

### Inbox

- Shared `escalationHref` in `src/domain/escalation.ts` (meeting notes include
  `?note=`).
- Actions: **Put on my week** creates an agenda item via `useSchedule().addAgenda`
  (needed-by date, or today) and moves to `in-progress` if still `requested`.
  (`src/components/oikonomia/escalation-row.tsx`)

### Person

- Readable leadership reports they authored (`useReports().visible` filtered
  by `authorId` — do not widen this).
- Gatherings they lead.
- People who report to them, by name.
  (`src/routes/people.$personId.tsx`)

### Navigation (`src/components/oikonomia/nav.ts`)

Current shape:

| Group | Items |
| --- | --- |
| Home | Home, My Progress |
| My Work | Weekly Agenda, Monthly Calendar, Meeting Notes, Reach-Out, Leadership Reports, **Goals** |
| Shared | LifeGroup, Ministry |
| Library (was More) | Documents & Forms, Resource Search |
| Oversight (under Leadership context) | Leadership Inbox, Team Overview, **Reports to you** |
| Organization | People, Attendance, Leadership journal, Administration |

Sidebar skips a group heading when it would duplicate the context label
(`src/components/oikonomia/app-sidebar.tsx`).

### Other

- Goals empty year: “No goals set for this year yet” vs filter miss
  (`src/routes/goals.index.tsx`).
- Onboarding tour copy updated (`src/domain/onboarding.ts`) — includes Goals
  and “put on your week”.
- User guide updated to match: `docs/user-guide/README.md`, `your-binder.md`,
  `leadership.md`, `organisation.md`.

### Helpers to reuse

| Helper | File | Use |
| --- | --- | --- |
| `planningHref` | `src/domain/planning.ts` | Any projected week/month item → route |
| `escalationHref` | `src/domain/escalation.ts` | Any inbox/ask → source record |
| `gatheringHeadline` | `src/domain/lifegroup.ts` | Gathering title when date is shown beside it |
| `ObjectRow.action` | `src/components/oikonomia/workspace-card.tsx` | Named next step on a Home row |
| `HomeOrientation` | `src/components/oikonomia/home-orientation.tsx` | First-visit Home legend |

Tests: `src/domain/planning.test.ts`, `src/domain/escalation.test.ts`,
`src/domain/lifegroup.test.ts`.

## Remaining work (prioritized)

Do not start a speculative wishlist. Prefer connecting capabilities that
already exist.

### P0 — still real, not in this PR

- **Demo 429s** on oikosdemo.crishub.com. Ops / rate-limit config, not a UI
  feature. A church install does not hit this.
- **Invitations that actually arrive** in production (SMTP). Demo correctly
  switches mail off. A church must have it configured and tested.
- **First-church setup beyond `/setup`.** First admin exists. A guided
  “campus → ministries → invite three leaders” is still a gap. Empty Home
  still shows the leadership *cycle* obligations (Reach-Out report, monthly
  leadership report, lay out the month) even with no church data — that is
  existing dashboard behaviour, not a regression. Decide whether a brand-new
  admin should see the cycle or a “set up the church first” path.

### P1 — core workflow, next journeys

These close more of the same loop:

1. **Leadership report → week** from the report page itself (inbox already
   can). If the viewer is the recipient of an action, offer Put on my week
   there too — reuse agenda create, do not invent a second task type.
2. **Meeting notes task UX discoverability.** Creating a task from a
   follow-up already lands on the assignee’s week. Confirm the editor makes
   that obvious; fix copy/empty states if a leader still would not find it.
3. **Person → Reach-Out / meetings they wrote**, still filtered to what the
   viewer may discover. Same pattern as leadership reports. Do not list
   confidential material.
4. **Monthly Calendar** should use `planningHref` the same way Home does, if
   clicks still dump to a generic month.
5. **Inbox “Take it on” without putting it on the week** is still valid
   (status-only). Do not auto-create agenda items. The explicit button is
   the design.

### P2 — usability

- **Reach-Out, My Binder, Oikonomia** still unexplained on first use. A
  one-line legend next to the unusual word beats a glossary page. Do not add
  a coach-mark product tour.
- Home greeting uses full name (`PersonName`); Welcome uses first name.
  Decide one.
- Goals empty state on ministry pages vs `/goals` — keep wording consistent.
- Mobile: drawer exists; toolbars overflow on some workspaces. Fix when you
  are on that screen, not as a sweep.
- “What you are carrying” on a brand-new admin still shows 3 cycle items.
  If that reads as fake work, the fix is in `src/server/services/dashboard-service.ts`
  (when an obligation has no underlying record yet), not in hiding the card.

### P3 — do not build yet (product decisions required)

| Hold | Prerequisite |
| --- | --- |
| Merge **Leadership Reports** (`LeadershipReport`) with **Reports to you** (`work` kind `report`) | Explicit decision: what *is* a ministry report? They are different records. Rename was the safe move. |
| Email reminders / notifications | Loop must stay honest; do not notify people into a queue. In-app overdue is enough first. |
| Calendar sync (Google) | Real OAuth, not a fake “connected” badge. Demo must stay disconnected. |
| CSV import / member import | Church setup journey first, or you import into a shapeless org. |
| File uploads | Contradicts “documents are links”. |
| Replace “My Binder” | The metaphor *is* the product. It needed a sentence (done), not a rename. |
| Sunday service attendance, giving, volunteer rotas | Other products. |
| Custom workflow engine / enterprise RBAC UI | Roles are already church-defined capability bundles. |

## How to work in this codebase

Voice of the UI: calm, specific, no fake engagement. Empty success (“nothing
is waiting on you”) is correct. Comments in this repo explain *why*; match
that density on load-bearing code, not on every line.

When adding a link between modules:

- Point at the **authoritative record**, never a copy.
- Reuse `planningHref` / `escalationHref` rather than a third path table.
- If the viewer may not discover the record, the link must not exist (same
  as a missing record).

When changing navigation: `src/components/oikonomia/nav.ts` says not to add
or reorder Binder sections without product approval. Goals was added because
Home already sent people there (a page with no door). Do not add Forms or
Checklists as peer sidebar items — they live inside Documents & Forms /
their section.

Update `docs/user-guide/` when user-visible names or journeys change. Do not
leave the guide describing “More” or a Goals-less My Work.

## Suggested first tasks for the next session

1. Re-read Home, Weekly Agenda `openItem`, inbox `putOnWeek`, person detail.
   Click the loop on the demo if 429s have cooled: Home attention → record →
   inbox action → Put on my week → Weekly Agenda → person.
2. Pick **one** P1 journey (report page → week, or person → reachable
   reports/meetings) and finish it end-to-end, including empty states and a
   domain test.
3. Do not open a second PR for glossary, notifications, or merging report
   types unless Cris asks.

## Verification bar

After changes: no dead ends, no unfinished-looking pages, no console errors
on the journey you touched, empty states still meaningful, authorization
still refuses, demo restrictions still refuse. `tsc`, eslint errors, vitest
on what you touched, and a browser pass on that journey.

The success test is still:

**What is happening? Who needs attention? What should I do next? What have we
agreed to do? Are our people and ministries progressing?**
