# Overview

## What Oikonomia is

One workspace a church's leaders share. It holds the calendar and the week's
agenda, meeting notes and the tasks that come out of them, ministry work,
lifegroup gatherings and attendance, outreach reports, goals, leadership
reports, documents and forms, and the records of the people and ministries
they all refer to.

Its organising question is **"what needs my attention?"** — which is why a
report published to somebody is information to read rather than work to
process, and why anything that genuinely asks something of a leader says so
explicitly.

## The stack

|            |                                                                  |
| ---------- | ---------------------------------------------------------------- |
| Framework  | TanStack Start with file-based routing (TanStack Router)         |
| UI         | React 19, Tailwind v4, shadcn/ui, lucide-react                   |
| Validation | zod, at every boundary that accepts input                        |
| Dates      | date-fns                                                         |
| Server     | Node 22, built by Vite to a Nitro `node-server` bundle           |
| Database   | SQLite through `better-sqlite3`, WAL journaling, foreign keys on |
| Mail       | SMTP through nodemailer, when configured                         |
| Tests      | vitest — 1,434 across 62 files                                   |

**SQLite on disk is the reason the build targets a Node server** rather than an
edge runtime. A Workers-style build has no filesystem and could not open its
own database; `vite.config.ts` records that as a consequence of the persistence
choice rather than a hosting preference.

## How a request travels

```text
  route (src/routes/*.tsx)          what a leader sees
        │
        │  createServerFn — the only client→server transport
        ▼
  api module (src/lib/*-api.ts)     validates input, shapes the envelope
        │
        ▼
  service (src/server/services/)    the rules: who may, what follows
        │
        ▼
  repository (src/server/repositories/)   SQL, and nothing else
        │
        ▼
  SQLite
```

Each layer has one job, and the boundaries are not decorative:

- **Routes** render and collect. They never reach past the API module, and the
  redirect that sends an unauthenticated visitor to the sign-in screen is a
  convenience, not a security boundary — it says so in its own comment.
- **API modules** are where `createServerFn` lives. Every one parses its input
  with zod before anything else sees it, because a request need not have come
  from a screen.
- **Services** decide. Every authorization question is answered here, against
  the viewer the server resolved — never against anything the client sent.
- **Repositories** hold the SQL. Every statement is prepared with bound
  parameters; no query is built by string concatenation anywhere in the
  repository layer.
- **Domain** (`src/domain/`, 41 modules) holds the rules that are true
  regardless of storage or screen — what a status transition means, who an
  audience is, how a date is read. It imports neither React nor the database,
  which is why most of the test suite can exercise it directly.

## Where the parts live

```text
src/
  routes/            44 routes, file-based
  components/        UI; providers under components/oikonomia/
  domain/            rules independent of storage and screen
  config/            the configuration platform and message catalogue
  lib/               18 *-api.ts modules — the client→server boundary
  server/
    api/             the response envelope and ApiError
    auth/            principal, sessions, passwords, throttling, SMTP, Google
    data/            artifact storage, backup destinations, alerting
    db/              connection, migrations, record helpers
    repositories/    18 — SQL only
    services/        19 — the rules
    http/            security response headers
scripts/             operations tooling: set-password, smoke, maintenance
```

## What runs where

Everything that decides anything runs on the server. The browser renders,
collects input and calls server functions; it is never trusted with a
judgement. The clearest case is the editor for meeting notes and report
blocks: it sanitizes HTML as somebody types **and** the schema the server
parses every request with refuses markup outside the same allowlist, because
the browser is the half an attacker controls.

## Two conventions worth knowing before reading the code

**Ids are not labels.** A status, a role, a category is stored as a stable id
and displayed through the configuration layer. Renaming "Submitted" to "Sent
in" changes a label and no behaviour.

**Deactivate is not delete.** People, ministries, campuses and vocabulary
entries are made unavailable for new records while everything that already
refers to them keeps working. Records are not orphaned to tidy a list.
