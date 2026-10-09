# Oikonomia

**A shared leadership binder for church planning, coordination and reporting.**

Oikonomia brings the week ahead, meeting decisions, ministry work, LifeGroup
gatherings, outreach, goals and leadership reports into one workspace. It helps
leaders see **what needs my attention?**, continue the record behind it, and
carry the next step onto their week.

[Explore the demonstration](https://oikosdemo.crishub.com/) ·
[Product overview](docs/product-overview.md) ·
[User guide](docs/user-guide/README.md) ·
[Deployment guide](docs/architecture/deployment.md)

## What leaders can do

| Area | Capabilities |
| --- | --- |
| **Home & My Progress** | See attention items, asks, upcoming work and responsibility cycles; open the next action in its original record. |
| **Weekly Agenda & Monthly Calendar** | Plan in agenda, list and calendar views; combine personal commitments with church, ministry and LifeGroup events; print the week. |
| **Meeting Notes** | Write personal notes or structured minutes, record decisions, assign dated tasks, bring forward previous actions, and start a linked leadership report. |
| **LifeGroup** | Schedule gatherings, claim leadership, set venues, record attendance and visitors, contribute entries, and complete gathering reports. |
| **Ministry & People** | Coordinate ministry documents, goals and reports around shared person, campus, ministry and responsibility-group records. |
| **Reach-Out** | Keep shared outreach notes, continue another leader's account, discuss it, and track contributions. |
| **Leadership Reports** | Draft, share, publish and archive reports; choose audiences, record confidential reads, add follow-ups, and request attention, action or approval. |
| **Leadership Inbox & Team Overview** | Respond to explicit asks, follow requests made of others, and review reporting consistency and overdue obligations within your oversight scope. |
| **Goals & Leadership Journal** | Record personal, ministry and group goals with updates and evidence; keep private journal entries and explicitly shared material. |
| **Documents, Forms & Resource Search** | Register and file document links, write binder documents, build reusable forms, preserve completed form snapshots, and search resources. |
| **Guide & walkthroughs** | Find contextual help and step-by-step instructions from the application's curated knowledge. |
| **Administration** | Invite leaders, confirm service assignments, configure church vocabulary and site settings, manage data exports, backups and retention. |

## Built around real leadership work

A meeting task appears on the assignee's week and completing it updates the
meeting's own task. An ask opens the report or gathering it came from.
Published information becomes an obligation only when someone explicitly asks
for a response. Progress reflects recorded work rather than an invented score.

Access comes from confirmed assignments and explicit audiences. Claiming a
position grants no access until it is confirmed; administration does not grant
blanket readership of private leadership reports. Reach-Out is a shared
workspace for leaders, with different visibility from private reports and notes.
See [product scope and access](docs/product-overview.md#access-and-sharing).

## Connected when configured

- **Google Workspace:** browse and register Drive files, upload directly to
  ministry Drive folders, create Google Docs/Sheets/Slides, publish church events
  to Google Calendar, and display a leader's own calendar beside their week.
- **Email:** invitations, sign-in links, password resets, maintenance failure
  alerts, and opt-in notices for asks and meeting tasks through Workspace Gmail
  or SMTP.
- **Google sign-in:** optional OAuth sign-in for existing accounts.

These are implemented integrations enabled with the church's credentials and
configuration. External files remain in their original provider; Oikonomia
records links and metadata rather than hosting uploaded files. Setup is covered
in [Google Workspace](docs/architecture/google-workspace.md) and
[deployment](docs/architecture/deployment.md).

## Public demonstration

The [demonstration](https://oikosdemo.crishub.com/) runs the application with
invented church data and real authorization. Explore different demo identities
from the demo bar, or try onboarding as a temporary visitor.

**Some features are disabled or read-only in the demonstration for security
and to protect the shared environment.** Email delivery, Google Workspace
operations, account and person administration, configuration changes, backups,
exports and retention are restricted. Ordinary church work remains interactive
where the chosen identity is authorized. Demo edits and visitor accounts are
temporary and are removed when the demonstration refreshes.

See [the demo guide](docs/user-guide/demonstration.md) for what to explore.

## Run your own installation

Oikonomia is a self-hosted Node application with a persistent SQLite database.
It serves the frontend and backend from one process. Use Node **22** on a
platform supported by `better-sqlite3`'s native binary; other platforms need a
native build toolchain and adjusted installation settings.

```bash
npm ci
npm run build
OIKONOMIA_URL=https://your-host \
OIKONOMIA_DB=/var/lib/oikonomia/oikonomia.db \
PORT=8080 npm start
```

Keep the database and artifacts outside the application directory so they
survive redeployment. The built server reads process environment variables or a
private file named by `OIKONOMIA_ENV_FILE`; it does not automatically load the
working directory's `.env`.

The first person opening a fresh installation is sent to `/setup` to create
the initial administrator. Setup then closes; additional leaders are invited
inside the application. A church installation starts without demo records.

[Deployment and operations](docs/architecture/deployment.md) covers Hostinger,
reverse proxies, integration credentials, scheduled maintenance and restore
procedures. [`.env.example`](.env.example) documents environment settings;
Workspace-specific settings are in the
[Workspace setup guide](docs/architecture/google-workspace.md#setting-it-up).

## Technology and development

TanStack Start and Router · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui ·
SQLite (`better-sqlite3`) · Zod · Vitest

```bash
npm ci
npm run dev        # local development server
npm test           # automated tests
npx tsc --noEmit   # typecheck
npm run lint       # lint
npm run build      # production bundle
npm run smoke      # start and verify the built server
```

CI checks types, lint, tests, the production build, server smoke behaviour and
production dependency advisories. These checks are separate from configuring a
particular church's hosting and connected services.

## Documentation

- [Product overview](docs/product-overview.md): capabilities, workflows and scope.
- [User guide](docs/user-guide/README.md): how to use the binder and administer a church.
- [Demo guide](docs/user-guide/demonstration.md): identities, exploration and demo protections.
- [Architecture](docs/architecture/README.md): identity, authorization, data, configuration and integrations.
- [Deployment](docs/architecture/deployment.md): installation, hosting, maintenance and recovery.

Product documentation describes implemented behaviour. Development context and
future design proposals live separately in `CLAUDE.md` and `development/`.
