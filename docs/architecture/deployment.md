# Deployment and operations

## Building

```bash
npm ci
npm run build          # → .output/
npm start              # node .output/server.js
```

The target is a Nitro **`node-server`** bundle. SQLite on disk is the reason:
an edge runtime has no filesystem and could not open the database.

One process serves everything — there is no separate frontend to host:

```text
browser ──► node .output/server.js
              ├─ /assets/*, /favicon.ico …   static files from .output/public (immutable cache)
              ├─ /_serverFn/*                 server functions (every data call; CSRF-checked)
              ├─ /healthz, /maintenance/run   route handlers
              └─ every other path             server-rendered page, or a 404
                   └─ SQLite (OIKONOMIA_DB), migrated on first use
```

| Build output                  | What it is                                                              |
| ----------------------------- | ----------------------------------------------------------------------- |
| `.output/server.js`           | **The entry point.** CommonJS, so `node` and `require()` both start it  |
| `.output/server/index.mjs`    | The Nitro server bundle it loads                                        |
| `.output/server/node_modules` | Traced runtime dependencies, including `better-sqlite3`'s native binary |
| `.output/public/`             | Built client assets                                                     |

`vite build` produces the bundle; `scripts/write-server-entry.mjs` then writes
`server.js` beside it, because hosting panels commonly demand a `.js` entry and
Passenger-style process managers load the entry with `require()`. Nothing in
`.output/` needs TypeScript, Vite or dev dependencies at runtime. `.output/` is
emptied by every build, so **nothing persistent may live there** — or anywhere
in the application directory.

The server listens on `PORT` (or `NITRO_PORT`; 3000 if neither) on every
interface, unless `HOST`/`NITRO_HOST` names one. It reads the process
environment, plus the private file `OIKONOMIA_ENV_FILE` names — **a `.env` in
the working directory is not loaded by the built server.**

`SIGTERM` stops it. Nothing runs in the background that a stop could interrupt
(see [Scheduling](#scheduling)); SQLite's write-ahead log makes an abrupt stop
safe for the database.

`better-sqlite3` is the one native dependency, and the reason password hashing
uses Node's own `scrypt` rather than adding a second compiled addon. It ships
prebuilt binaries (Linux glibc ≥ 2.34 and musl, macOS, Windows; x64 and arm64)
and loads them in preference to a local compile, so **nothing is compiled on
install**: `.npmrc` sets `ignore-scripts=true`, because npm otherwise runs
`node-gyp rebuild` for any package containing a `binding.gyp` — which needs
Python and a C++ toolchain, and fails on hosts without them. A platform outside
that list would have to remove the setting and compile.

`npm run build` caps the bundler at four threads (`RAYON_NUM_THREADS`, unless
already set). Rolldown otherwise starts one per CPU the machine reports, and on
shared hosting that is the host's CPU count, not the account's: Hostinger's
build machine reports 64, its account limits refuse the threads, and Rolldown
panics with `ThreadPoolBuildError … Resource temporarily unavailable` while
loading `vite.config.ts`. Set `RAYON_NUM_THREADS` higher where that is allowed.

Hosts that install development dependencies to build (Hostinger does) also
scan them, so a test-runner advisory shows up against the site even though
nothing in `.output/` contains it. Keep the audit clean anyway —
`npm audit` should report 0, not only `npm audit --omit=dev`.

Regenerating the lockfile after a dependency change can crash npm 10's peer
resolver (`Cannot read properties of null (reading 'edgesOut')`), as the Vitest 4
upgrade did. Generate it once with `npm install --legacy-peer-deps`; the
resulting lockfile installs normally with `npm ci` and `npm install`, and no
flag is needed afterwards.

### Prove the build before trusting it

```bash
npm run smoke
```

Starts `.output/server.js` — the file a host runs — against a database file
that does not exist yet and checks that it serves pages and built assets, sends
its security headers, opens the database, applies every migration, holds no
sample data, answers unknown paths with a 404, accepts server functions from
the configured `https` origin while reached over `http` (as behind a proxy),
refuses them from any other origin, stops on `SIGTERM`, refuses to open a
database when `OIKONOMIA_DB` is unset, and reads settings and secrets from
`OIKONOMIA_ENV_FILE` without logging them, with the environment taking
precedence and an unreadable file stopping the server. This exists because a build can
succeed while being unusable: migrations were once not carried into the bundle,
and every page of the deployed application said _"Oikonomia could not be
reached"_ while tests, typecheck, lint and the build were all green.

CI runs typecheck, lint, tests, the build, the smoke check, and a production
dependency audit.

## Configuration

`.env.example` lists every setting and holds no values.

| Variable                                                  | Switches on                                                    | Without it                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `OIKONOMIA_ENV_FILE`                                      | A private file the built server loads every other setting from | Settings come from the environment only                                         |
| `OIKONOMIA_URL`                                           | Link building, `Secure` cookies, HSTS, CSRF origin             | Local development assumed; **refuses in production**                            |
| `OIKONOMIA_DB`                                            | Database file — **outside the app directory**                  | `.data/oikonomia.db` in development; **refuses in production** (`/healthz` 503) |
| `OIKONOMIA_ARTIFACTS`                                     | Where exports and backups are written                          | `artifacts/` beside the database (`demo-artifacts/` in Demo Mode)               |
| `PORT` / `NITRO_PORT`                                     | Listen port                                                    | 3000                                                                            |
| `HOST` / `NITRO_HOST`                                     | Listen interface                                               | Every interface                                                                 |
| `OIKONOMIA_SMTP_HOST`, `OIKONOMIA_MAIL_FROM`              | Magic links, password resets, invitations                      | Those controls are removed and the screen says why                              |
| `OIKONOMIA_SMTP_PORT` / `_SECURE` / `_USER` / `_PASSWORD` | SMTP details                                                   | 587, STARTTLS, no credentials                                                   |
| `GOOGLE_CLIENT_ID` / `_SECRET`                            | Google sign-in                                                 | The screen does not offer Google                                                |
| `OIKONOMIA_BACKUP_DIR`                                    | A second backup destination                                    | Every backup is on this machine, and the panel says so                          |
| `OIKONOMIA_BACKUP_OFFSITE`                                | Declares that directory leaves this machine                    | Treated as a second local copy                                                  |
| `OIKONOMIA_BACKUP_KEY`                                    | Encrypts backup files — see [data](data.md#encrypted-backups)  | Backups are the plain SQLite file                                               |
| `OIKONOMIA_BACKUP_TIMEOUT_SECONDS`                        | How long a backup may run before it is stopped                 | 600                                                                             |
| `OIKONOMIA_MAINTENANCE_TOKEN`                             | Scheduled maintenance                                          | **The endpoint is off, not open**                                               |
| `OIKONOMIA_ALERT_TO`                                      | Email on a failed scheduled task                               | Only cron's exit code reports it                                                |
| `OIKONOMIA_DEMO_MODE`                                     | A public demonstration — see [Demo Mode](#demo-mode)           | An ordinary installation. Only `true`/`false`; anything else serves 503         |
| `OIKONOMIA_DEMO_DB`                                       | Demo Mode's own live database — never `OIKONOMIA_DB`           | Demo Mode **refuses to open any database** in production (`/healthz` 503)       |
| `OIKONOMIA_DEMO_BASELINE`                                 | The curated baseline a demonstration is reset to               | A demo reset refuses                                                            |
| `OIKONOMIA_REQUIRE_DEMO_MODE`                             | Pins a deployment to always be a demonstration — see below     | No such pin. Only `true`/`false`; anything else serves 503                      |
| `OIKONOMIA_DEMO_GOOGLE_TESTERS`                           | Addresses allowed to sign in with Google on a demonstration    | Demo Mode refuses Google sign-in entirely                                       |

**`OIKONOMIA_URL` is read from configuration, never from the request's `Host`
header.** A host header is something the client sends, and a sign-in link built
from one is a link an attacker can point at their own server. Unset in
production, link building refuses rather than guessing `localhost` — which
would otherwise mail sign-in links pointing at the recipient's own machine.

The server still **starts** without it and fails only where the value is
actually needed, so a misconfigured installation serves and complains at the
point where a silent guess would have mattered.

## Behind a reverse proxy

The ordinary shape: TLS terminated at the proxy, plain HTTP to the application.

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Host              $host;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
}
```

Set `OIKONOMIA_URL=https://your-host`. That turns on `Secure` on the session
cookie, `Strict-Transport-Security`, and `upgrade-insecure-requests` in the
Content-Security-Policy.

**No proxy headers are trusted, and none need to be.** Everything that depends
on the public scheme or host reads `OIKONOMIA_URL` instead: cookie flags, HSTS,
sign-in links, the Google callback, and the origin that server functions are
checked against. That last one matters behind TLS termination: the application
sees `http://`, the browser sends `Origin: https://…`, and a check against the
request's own URL would refuse every call from a browser that does not send
`Sec-Fetch-Site`.

## Hostinger (Node.js Web App)

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Framework preset | **Other.** Not Express/Fastify/Hono (they install without building) nor Vite (static only) |
| Node version     | 22.x (`engines` in `package.json`)                                                         |
| Package manager  | npm                                                                                        |
| Root directory   | repository root (`./`)                                                                     |
| Build command    | `npm run build`                                                                            |
| Output directory | empty if the form allows; otherwise `.output`                                              |
| Entry file       | `.output/server.js` (relative to the root directory)                                       |

Hostinger runs the entry through LiteSpeed's Passenger (`lsnode`), which may
start more than one process.

**Hostinger overwrites `hbuilds/` and `public_html` on every deployment.** The
database must be outside both, or the first redeploy deletes the church's
records.

### Private data: settings, secrets, database, backups

Everything the installation owns lives in one directory beside `public_html` —
never served by the web server, never replaced by a deploy:

```text
/home/<user>/domains/<domain>/private/          500  dr-x------
└── oikonomia/                                  500  dr-x------
    ├── .env                                    400  -r--------   settings and secrets
    └── data/                                   700  drwx------
        ├── oikonomia.db (+ -wal, -shm)         600  -rw-------
        └── artifacts/                          700  drwx------   exports and backups
```

These are the least that work. The application runs as the account itself, so
nobody else needs any access. `private/` and `oikonomia/` are only traversed
and read; the `.env` is only read; `data/` must be writable, because SQLite
creates its `-wal` and `-shm` files beside the database. `.output/server.js`
sets `umask 077`, so every file the application creates later — the log files
SQLite adds, each backup — is owner-only without anyone remembering to
`chmod` it.

hPanel holds a single variable:

```text
OIKONOMIA_ENV_FILE=/home/<user>/domains/<domain>/private/oikonomia/.env
```

and the file holds the rest, in `KEY=value` form:

```text
OIKONOMIA_URL=https://<domain>
OIKONOMIA_DB=/home/<user>/domains/<domain>/private/oikonomia/data/oikonomia.db
OIKONOMIA_MAINTENANCE_TOKEN=…
```

Backups follow the database into `data/artifacts/` unless `OIKONOMIA_ARTIFACTS`
says otherwise.

> **`oikosdemo.crishub.com` is a Demo-only deployment.** It must always run
> with `OIKONOMIA_DEMO_MODE=true`, and its `.env` additionally sets
> `OIKONOMIA_REQUIRE_DEMO_MODE=true` — see "Pinning a deployment to always be a
> demonstration", above. If its Demo configuration is ever unavailable or
> invalid, the deployment must remain unavailable (503) rather than operate
> against the normal database. Its private file therefore holds:
>
> ```text
> OIKONOMIA_URL=https://oikosdemo.crishub.com
> OIKONOMIA_DEMO_MODE=true
> OIKONOMIA_REQUIRE_DEMO_MODE=true
> OIKONOMIA_DB=/home/<user>/domains/oikosdemo.crishub.com/private/oikonomia/data/oikonomia.db
> OIKONOMIA_DEMO_DB=/home/<user>/domains/oikosdemo.crishub.com/private/oikonomia/data/oikonomia-demo.db
> OIKONOMIA_DEMO_BASELINE=/home/<user>/domains/oikosdemo.crishub.com/private/oikonomia/data/oikonomia-demo-baseline.db
> OIKONOMIA_MAINTENANCE_TOKEN=…
> ```
>
> `OIKONOMIA_DB` names the file the same-file checks compare the other two
> against; Demo Mode never opens it for a request.

`.output/server.js` loads the file before anything else runs. A variable set in
the environment wins over the file, so hPanel can still override one value. A
file that is named but unreadable **stops the server** with the path in the
runtime log, and one readable by other users logs a warning. Changing the file
needs a restart, not a redeploy. `npm run auth:set-password` reads the same
variable.

To edit the `.env`, lift the protection for the edit and put it back:

```bash
cd ~/domains/<domain>/private
chmod u+w . oikonomia oikonomia/.env   # editors write a temporary file beside it
nano oikonomia/.env
chmod 400 oikonomia/.env && chmod 500 oikonomia .
```

Deleting the domain in hPanel deletes `private/` with it — database included.
An off-machine copy (`OIKONOMIA_BACKUP_DIR`) is what survives that.

Two processes starting together against an empty database can race to apply
the same migration; the loser fails that request and succeeds on the next.

Scheduled maintenance uses hPanel's cron jobs against the public address, since
the application's internal port is not fixed. The job reads the token from the
same file:

```cron
0 2 * * *  set -a; . /home/<user>/domains/<domain>/private/oikonomia/.env; set +a; curl -fsS -X POST -H "Authorization: Bearer $OIKONOMIA_MAINTENANCE_TOKEN" "$OIKONOMIA_URL/maintenance/run?task=backup"
```

Shell `.` and Node read the same simple `KEY=value` lines alike; keep values
free of `$` and backticks, which the shell would expand.

After deploying: `curl -fsS https://your-host/healthz` must answer
`{"ok":true,…}`, and the first visit must land on `/setup`.

> **Address-based rate limiting belongs here, at the proxy.** The application
> throttles by _subject_ — the address somebody typed — and deliberately not by
> IP, because behind a proxy the client's address arrives in a header the
> client can write. The proxy is the only participant that knows the real
> socket.

## Security headers

Sent on every response, including error pages, from `src/server.ts` — the one
place everything passes through:

`Content-Security-Policy`, `Strict-Transport-Security` (HTTPS only),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and
`X-Robots-Tag: noindex, nofollow` in [Demo Mode](#demo-mode) only.

Static files (`/assets/*`, `robots.txt`, `favicon.ico`) are served by Nitro
before `src/server.ts` runs, so they carry none of these. Everything a browser
renders or a crawler indexes — pages, error pages, `/healthz`, server-function
responses, refusals — does.

**What the CSP does and does not do**, stated precisely because overstating it
is a reason not to look at the real defences: `script-src` is `'self'` plus a
fresh random nonce per response (`'nonce-…'`), with no `'unsafe-inline'`. Every
inline script the page streams — the framework's dehydrated state, React's
streaming scripts, the appearance boot script — carries that nonce, so injected
markup cannot run: an inline event handler such as `onerror=` is refused, and so
is a `<script>` without the nonce. `style-src` still allows `'unsafe-inline'`,
because React renders `style` attributes; inline style cannot run script. Beyond
that, `connect-src 'self'` refuses exfiltration, `script-src 'self'` refuses a
payload from elsewhere, and `frame-ancestors 'none'` refuses framing.

A proxy that rewrites or caches HTML must not replay one response's page with
another response's header: the nonce in the page and in the header must match,
or the browser refuses the page's scripts and it does not start.

No policy is sent in development: Vite needs `eval` and a websocket, and a
policy loosened until it permits those is not the policy production runs.

## Demo Mode

`OIKONOMIA_DEMO_MODE=true` makes an installation a public demonstration: the
same build, with operations that belong to a real installation removed
(see `docs/architecture/api-boundary.md`, _Installation policy_). What it also
guarantees at the boundaries where things leave the server:

- **No email is sent.** Delivery itself is suppressed — ahead of any SMTP
  settings — and nothing about a message (recipient, body, link) is logged.
  SMTP credentials may be left out of a demonstration's environment entirely.
- **No Google sign-in.** Google counts as unconfigured even if credentials are
  present, so sign-in cannot start and no authorization code is ever exchanged
  with Google; `/auth/google/*` also answer `403`.
- **Not indexed.** Every application response carries
  `X-Robots-Tag: noindex, nofollow`. `robots.txt` is unchanged, because a
  church's own installation shares it.

**Verify the header survives the hosting edge after deploying.** Hostinger's
LiteSpeed has been seen replacing `Content-Security-Policy`, and a header the
application sends is not proof of one the public receives:

```bash
curl -sI https://your-host/ | grep -i '^x-robots-tag'
curl -sI https://your-host/login | grep -i '^x-robots-tag'
```

Both must print `x-robots-tag: noindex, nofollow`. If they print nothing, the
edge is removing it — report it rather than working around it in the
application.

### Its own database

A demonstration never opens the ordinary installation's database. Three files,
which must be three different files:

| File                     | Variable                  | Example                      |
| ------------------------ | ------------------------- | ---------------------------- |
| Ordinary live database   | `OIKONOMIA_DB`            | `oikonomia.db`               |
| Demonstration's database | `OIKONOMIA_DEMO_DB`       | `oikonomia-demo.db`          |
| Demonstration's baseline | `OIKONOMIA_DEMO_BASELINE` | `oikonomia-demo-baseline.db` |

- `OIKONOMIA_DEMO_MODE=true` opens `OIKONOMIA_DEMO_DB`, and only that. Unset,
  the server serves nothing (503, and the log says why) rather than fall back
  to `OIKONOMIA_DB`. In development it defaults to `.data/oikonomia-demo.db`.
- It also refuses to open `OIKONOMIA_DEMO_DB` when it is the same file as
  `OIKONOMIA_DB` or as the baseline — the same file meaning the same canonical
  path through symlinks, or the same inode (a hard link), not the same spelling.
- The demonstration's artifact directory defaults to `demo-artifacts/` beside
  its database, so a reset — which empties it — can never reach an ordinary
  installation's `artifacts/`.

Separate files keep a mistake from pointing a reset at a church's data. They do
not make it safe to swap files: see the reset below.

### Pinning a deployment to always be a demonstration

`OIKONOMIA_DEMO_MODE=true` is a switch a deployment turns on. Nothing stops
it being left off by mistake — a template missing a line, a `.env` copied from
the wrong deployment, a hosting panel's override cleared during a redeploy —
and for most deployments that is tolerable: they fall back to being an
ordinary installation, which is what they are meant to be sometimes anyway.

**`https://oikosdemo.crishub.com/` is not one of those.** It is specifically
and permanently the public Oikonomia demonstration, and must never run as an
ordinary installation — not even for one request, not even while its
configuration is being changed. `OIKONOMIA_REQUIRE_DEMO_MODE=true` is the pin
for that: set once, in the private environment file only an operator can
write. Never derived from the hostname, a `Host` header, a cookie or the
database — `assertDeploymentProfile` (`src/server/installation/policy.ts`)
reads only the process environment — it requires:

- `OIKONOMIA_DEMO_MODE=true`;
- `OIKONOMIA_DEMO_DB` set, and distinct from `OIKONOMIA_DB` and from the
  baseline (the same rule the database is opened under);
- `OIKONOMIA_DEMO_BASELINE` set.

Checked at the very top of `src/server.ts`, the same gate that already refuses
to serve an installation whose `OIKONOMIA_DEMO_MODE` cannot be read — before
`/healthz`, before every other response. **There is no fallback to
`OIKONOMIA_DB`**: a deployment pinned this way that is missing any of the
above serves nothing, 503, with the reason in the log, rather than quietly
becoming an ordinary installation.

`OIKONOMIA_DB` stays configured on such a deployment — set to the file the
same-file checks above compare `OIKONOMIA_DEMO_DB` and the baseline against —
but Demo Mode never opens it for a request. It exists in the environment as a
protected identity, not as a database this deployment ever serves from.

### Building a Demo baseline

The curated content itself — who the demonstration is, what it holds — is
produced separately and is not part of this repository. What this repository
provides is the path from "the current schema" to "a file `demo-provision.mjs`
will accept", so that work never starts from a copy of a real installation's
database.

```text
current schema/migrations
        │  scripts/ops/create-demo-baseline-builder.mjs
        ▼
clean, schema-only builder database
        │  npm run demo:content:import -- --source <Data Play repo> --to <builder>
        ▼
populated candidate
        │  scripts/ops/mark-demo-baseline.mjs --sanitize --to …
        ▼
oikonomia-demo-baseline.db, marked demo-baseline
        │  scripts/ops/demo-provision.mjs
        ▼
oikonomia-demo.db — the mutable live demonstration
```

**The builder.**

```bash
node scripts/ops/create-demo-baseline-builder.mjs --to oikonomia-demo-baseline-builder.db
```

Applies `src/server/db/migrations/*.sql` with `loadMigrations`/`migrate`
(`src/server/db/migrate.ts`) — the same functions the deployed server's
`bundled-migrations.ts` wraps for a Vite build, read here straight off disk, so
the schema is defined once. What comes out is the current schema version and
nothing else: no person, no account, no session, no credential, no
configuration override — only what a migration seeds on purpose
(`retention_policy`, migration 031). The script verifies this — `integrity_check`,
`foreign_key_check`, and that no other table holds a row — before it hands the
file back, and refuses to overwrite an existing one.

**Populating it.** The Data Play repository is the canonical, human-readable
source. Preflight the whole corpus without writing a file, then import it into
the empty builder:

```bash
npm run demo:content:import -- \
  --source /path/to/Oikonomia_demo_content_build \
  --dry-run

npm run demo:content:import -- \
  --source /path/to/Oikonomia_demo_content_build \
  --to oikonomia-demo-baseline-builder.db
```

The dry run migrates an in-memory database and performs the same repository
writes and verification as the real import. Treat any warning, skipped record,
unsafe HTML block, integrity failure or foreign-key problem as a failed build.
The importer refuses a builder that already contains people, resolves every
written person and ministry name against the corpus roster, completes
onboarding for imported accounts, and creates `demo_identity` rows from each
profile's `Demo persona` field. It writes through the application's
repositories; only imported historical timestamps are backdated directly.

The authoring repository remains read-only throughout. The builder and final
baseline are disposable generated artifacts and must never be committed.

**Finalizing.** `demo_identity` — who a visitor may explore as — is
infrastructure the application deliberately gives no admin screen ("who a
visitor can be is data, never code"; migration 035), so designating identities
and clearing what the population step left behind both happen here:

```bash
node scripts/ops/mark-demo-baseline.mjs \
  --candidate oikonomia-demo-baseline-builder.db \
  --sanitize \
  --to oikonomia-demo-baseline.db
```

The importer normally supplies the designated identities. `--designate` remains
available for a manually populated candidate and inserts `demo_identity` rows
for the given people, in the order given. `--sanitize` removes every session,
sign-in token, throttle row, temporary visitor, and credential — the runtime
residue of having actually used the application to build the content. Both act
on a disposable copy (`--to`); the populated candidate is only ever read.
(`--in-place` marks the candidate itself instead, for iterating on a working
file.)

Whether or not anything is being marked, the same command **validates**
everything `demo-provision.mjs` and a reset both require — built and run with
no `--designate`, `--sanitize`, `--to` or `--in-place`, it writes nothing:

```bash
node scripts/ops/mark-demo-baseline.mjs --candidate <candidate.db>
```

It checks, against a fresh reference schema it builds for the comparison: SQLite
integrity and foreign keys; that the schema — tables, columns, the applied
migrations — matches this build's exactly, catching drift as well as a table
feature a reset cannot reproduce (a trigger); that `demo_identity` designates
at least one person; that there is no session, sign-in token, throttle row,
temporary visitor, or credential; and that `demo_state` is not already marked
`demo-installation` (a live database is not a baseline). **A candidate that
already holds curated content but has not yet been sanitized or designated
must not be marked `demo-baseline`** — that marker is Slice 6's promise that a
reset may empty every other table and refill it from this file, and an
unsanitized copy would carry a real credential or a stale session into every
demonstration reset from then on. Run the validation above, unmarked, as the
last step before handing a candidate back.

### Entering a demonstration

`/login` offers a chooser instead of a sign-in form: the people the database
designates, and _Try it as yourself_ with only a name. Either opens an ordinary
session, so everything after the entrance is the real application.

- **Who is offered is data.** A person is offered when `demo_identity` has a
  `designated` row for them and they have an active account (migration 035).
  The demonstration's baseline database supplies these rows — and should give
  designated people a completed onboarding. Nothing in code names anybody.
- **Two gates.** Entering needs `OIKONOMIA_DEMO_MODE=true` **and** at least one
  designated row. A church's database with the flag set by mistake designates
  nobody, so nothing opens; a demonstration's database without the flag
  offers nothing. Only a designated identity's id is accepted — never a person,
  account or visitor id.
- **Visitors** get an ordinary person with the least-privileged role, no email,
  and an active account with no credential — reachable through this entrance
  only — marked `visitor`, and start in normal onboarding. At most **200** exist
  at once; a reset removes them. This is a ceiling, not abuse protection: the
  application cannot reliably tell one visitor from another.
- **Switching** from the chooser ends that browser's previous session first.
- **A browser that has never had a session is not asked first.** The same
  server call the shell uses to ask "who is this?" (`fetchSession`,
  `src/lib/organization-api.ts`) signs a cookie-less request straight into the
  first offered identity — `src/server/demo/auto-enter.ts`, the same entrance
  `enterDemoAs` uses, just taken on the visitor's behalf. Oikosdemo is always
  Demo Mode, and it is not the chooser's whole reason for existing, so a
  first-time visitor lands on Home rather than a page asking them to pick
  someone. The chooser is still there — at `/login`, and from the demo bar's
  switcher — for choosing anyone else, or _Try it as yourself_.
  **A cookie naming a session that has since ended is not re-entered this
  way**: only the absence of any session cookie triggers it, so a reset or a
  sign-out still lands a visitor back on the chooser with the "the demo was
  refreshed" notice rather than silently handing them a new identity.

### What a visitor sees

A thin bar above every page — sign-in included — says it is a demo, whose
eyes the visitor is looking through (with a menu to switch), and how long until
the next refresh. _About this demo_ explains what is shared, what is switched
off and what disappears. The bar can be collapsed; that choice is remembered in
the browser and changes nothing else.

- **The refresh time is the site's clock.** Refreshes fall at 00:00, 06:00,
  12:00 and 18:00 in `site.timezone` (Administration → Site settings), and the
  countdown is computed on the server from it. An unrecognised timezone counts
  as UTC rather than failing the page. The same function decides whether a scheduled reset is due, so the countdown
  and the reset cannot describe different schedules.
- **Switched-off controls stay visible.** Where a page offers something the
  installation refuses — people's identity, sessions, configuration, data
  management — its controls are disabled beside a short note saying why. The
  browser learns what is switched off from the session (`installation`), which
  the server derives from the same policy table it enforces; the disabled
  buttons are courtesy only, and the server refuses the operation regardless.
- **An ordinary installation draws none of it.** No bar, no notes, and the
  layout offset (`--demo-bar`) stays `0px`.
- **After a reset** every session has ended. The sign-in screen says _"The demo
  was refreshed. Choose a demo user to continue."_ when this browser last
  explored an earlier generation, and nothing when a session simply expired.
  The generation (`demo_state`, sent by `fetchDemoEntry`) is the only way the
  browser tells the two apart.
- **Kept current by polling, every 60 seconds.** The bar asks `fetchDemoEntry`
  again each minute while the page is open (paused in a background tab, asked
  again on return): the next refresh time, the generation, whether this browser
  is still signed in, and how many sessions are exploring as each offered
  person. No WebSocket, no server-sent events. The countdown ticks locally in
  between; the server's time is the one it counts to. An ordinary installation
  draws no bar and so polls nothing.
- **Presence counts sessions, not people.** A session is _active_ when it is not
  revoked, not expired, and was used in the last **5 minutes**
  (`auth_session.last_seen_at`). One person in two browsers is "2 active". The
  switcher and _About this demo_ show each offered person's count; the bar
  shows the total on wide screens only. Nothing about a session — its id, user
  agent, times — is sent, and nothing is inferred about who is behind it.
- **When the session ends under the page** — the poll says this browser is no
  longer signed in while the page still shows somebody — it goes to the sign-in
  screen once, which shows nobody and therefore never sends anyone back.
- **A warning about 10 minutes before a refresh**, as an ordinary toast, once
  per refresh per browser tab (remembered in `sessionStorage`), so the next
  refresh is warned about in its turn. Nothing is sent by email or stored
  server-side.

`last_seen_at` is written at most about once a minute per session: a request
refreshes it only when the stored time is more than 60 seconds old, decided
from the stored value so every server process agrees, and a request that finds
it fresh does not write at all. This holds on every installation, and changes
nothing about whether a session is valid or when it expires.

### Resetting a demonstration

> **Never replace the live SQLite database file while Oikonomia's server
> processes are running.** Not by copying over it, renaming onto it, or
> deleting it with its `-wal` and `-shm`.

Passenger runs several processes, each holding its own open handle on the
database. A file replaced underneath them is not a reset: processes that
already have it open keep reading and writing the old inode, the WAL and
shared-memory files no longer describe the database beside them, and the
result ranges from stale pages to corruption.

So a reset restores **inside** the live database
(`src/server/installation/demo-reset.ts`):

1. Every check below, before anything is changed.
2. The baseline is copied (`VACUUM INTO`, read-only) into the artifact
   directory, migrated to this build's schema, and verified. The baseline file
   itself is never written.
3. That copy is attached to the live connection, and one `BEGIN IMMEDIATE`
   transaction — which waits for, then excludes, every other writer — deletes
   the rows of every application table and copies the baseline's in, with
   foreign keys checked at commit. Tables come from `sqlite_master`, so a table a
   future migration adds is restored too; a trigger, virtual table or generated
   column (none exist) makes the reset refuse rather than guess.
4. Integrity and foreign-key checks run inside the transaction;
   `demo_state.generation` goes up by one and `last_reset_at` is set; COMMIT.
   Any failure rolls the whole thing back — nothing changes, the generation
   included.
5. After commit, `demo-artifacts/` is emptied. A file that cannot be removed is
   reported (HTTP 500, `databaseReset: true`) and does not undo the restore.

Every other process sees the restored rows on its next read, through the handle
it already has. The connection's busy timeout (better-sqlite3's default,
5 seconds) is how long the reset waits for another writer, and how long a
visitor's write waits for the reset; a restore of a demonstration-sized
database takes milliseconds.

**Left alone:** `schema_migrations` (checked to match the baseline's) and
`demo_state` (whose generation must survive the reset it counts). Sessions,
sign-in tokens, throttles, visitors and their data are ordinary tables and go
with everything else; nothing needs cleaning separately.

**A reset refuses — changing nothing — unless all of these hold.** There is no
flag, parameter or setting that skips one.

- `OIKONOMIA_DEMO_MODE=true`.
- The live database is not `OIKONOMIA_DB` and not in memory; the baseline is
  set, exists, is readable, and is neither the live nor the ordinary database.
- The artifact directory holds none of the three databases and is not the
  ordinary installation's.
- The live database's `demo_state` row is marked `demo-installation`. A
  church's database has no such row, so it fails here whatever its environment
  says.
- The baseline is a SQLite database marked `demo-baseline`; it migrates to this
  build's schema; it passes `integrity_check` and `foreign_key_check`; it
  designates at least one identity; it holds no sessions, sign-in tokens,
  throttles or visitors.
- Both schemas have the same migrations, tables and columns.

#### The baseline

An ordinary Oikonomia database holding the curated demonstration — designated
identities with active accounts and completed onboarding — plus the marker,
and nothing a visitor would create. Keep it in the rollback journal so reading
it creates no `-wal` beside it:

```sql
INSERT INTO demo_state (id, marker) VALUES (1, 'demo-baseline');
PRAGMA journal_mode = DELETE;
```

Keep it in `private/`, readable only by the application's account. It can be at
an older schema than the build; each reset migrates a copy.

#### Provisioning the live database, once

Before the demonstration first starts:

```bash
node scripts/ops/demo-provision.mjs \
  --baseline <private>/data/oikonomia-demo-baseline.db \
  --to       <private>/data/oikonomia-demo.db \
  --ordinary <private>/data/oikonomia.db
```

It only ever **creates** the file — an existing target, or one with a `-wal` or
`-shm`, is refused — and marks it `demo-installation` at generation 0. From
then on the file is reset in place, never provisioned again.

#### Running a reset

```bash
set -a; . <private>/.env; set +a
curl -fsS -X POST -H "Authorization: Bearer $OIKONOMIA_MAINTENANCE_TOKEN" \
  "$OIKONOMIA_URL/maintenance/run?task=demo-reset"
```

`demo-reset` is the only maintenance task a demonstration accepts, and it still
needs the bearer token: a session — an administrator's included — is not one.
An ordinary installation answers 409 `demo-mode-off` before opening its
database. Responses:

| Status | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| 200    | `{"ok":true,"generation":N,…}` — reset; or `"skipped":"not-due"` with `when=due`     |
| 401    | No or wrong token                                                                    |
| 409    | Refused by a check; `reason` names it. Nothing changed. Alerted                      |
| 500    | `databaseReset:false` — rolled back, nothing changed; `true` — reset, artifacts left |

#### On the schedule

The countdown promises 00:00, 06:00, 12:00 and 18:00 on the site's clock. A
cron entry in a fixed timezone cannot follow that through daylight-saving
changes, so the cron runs **hourly** and the server decides:

```cron
1 * * * *  set -a; . /home/<user>/domains/<domain>/private/oikonomia/.env; set +a; curl -fsS -X POST -H "Authorization: Bearer $OIKONOMIA_MAINTENANCE_TOKEN" "$OIKONOMIA_URL/maintenance/run?task=demo-reset&when=due"
```

With `when=due` a run resets only if one of those times — computed from
`site.timezone` by the same function as the countdown — has passed since
`last_reset_at`, and otherwise answers `skipped`. Minute `1` rather than `0`
keeps a slightly early cron clock from landing just before the hour. The
cron's own timezone does not matter; Hostinger's shell clock is UTC.
`when=due` can only skip a reset: it loosens no check.

**Check after enabling it** that hPanel runs the job: the first run past a
refresh time answers `"generation"` rather than `"skipped"`, and the header's
countdown restarts.

## Backups

```bash
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/maintenance/run?task=backup
```

SQLite's own online backup (`VACUUM INTO`) into a scratch file, stored in the
artifact directory. Copying the database file directly would capture it
mid-transaction, and a torn backup is one nobody discovers is useless until
they need it.

With `OIKONOMIA_BACKUP_DIR` set, every backup is written to **both**
destinations, under the same file name — after the local copy rather than
instead of it. If the second write fails, the backup that already succeeded is
still a backup and the job records that the copy did not happen. A failure to
duplicate is not a failure to back up — but a scheduled run where it happens
answers 500 with `"backupCompleted": true` and sends the failure alert, because
the copy meant to survive this machine is the one a failing mount quietly stops
making.

Every file is written under a `.partial` name and renamed only when whole, so
an interrupted copy is never at the name a job records.

With `OIKONOMIA_BACKUP_KEY` set, both copies are encrypted and end in
`.db.enc`. Key custody and rotation are in
[data.md](data.md#encrypted-backups); read that before setting it.

**`OIKONOMIA_BACKUP_OFFSITE` is your assertion, not a measurement.** From
inside the process, a volume mounted from another building and a folder on the
same disk look identical, so only the literal word `true` counts and the
interface attributes the claim to you. What Oikonomia _can_ check, it does:
whether the directory is on a different filesystem device to the database, and
it warns when it is not.

### A destination that stops answering

The copy is taken by a **child process** with its own read-only connection;
the server only waits for it. A destination that neither succeeds nor fails —
a hung network mount is the real-world case — keeps that child waiting, not
the process answering requests: `/healthz` and every page keep answering.

After `OIKONOMIA_BACKUP_TIMEOUT_SECONDS` (600 by default) the child is killed.
If the local copy had not finished, the job is **failed** with the reason, its
`.partial` files are removed, and a scheduled run answers 500 and sends the
failure alert. If only the second copy hung, the local backup stands and the
copy is reported as failed, as above.

A child process rather than a worker thread, deliberately: a thread blocked
inside a system call cannot be stopped, and a process holding one cannot exit.
One limit remains outside any program's reach — a process stuck in
uninterruptible I/O on a `hard` NFS mount is not reclaimed until the mount
answers, even after it is killed. The server stays responsive; the stuck
process is the operator's to see. A local path _synced_ elsewhere is still
safer than a network path written to directly. A destination that merely
refuses is well behaved: a read-only directory fails at once, naming the
reason.

## Scheduling

Nothing runs on its own. An in-process timer stops when the process stops and
says nothing when it does; the failure mode is a church that believes it has
nightly backups and has had none since a deploy in March.

```cron
0  2 * * *  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/maintenance/run?task=backup
30 3 * * 0  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/maintenance/run?task=retention
15 4 * * *  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/maintenance/run?task=sweep
```

`sweep` drops expired throttle rows and prunes `auth_event` beyond a year.

The token is compared in constant time, and **unset means the endpoint is off,
not open** — an unauthenticated way to make a server copy its whole database is
a denial-of-service control with a friendly name. Work is recorded as performed
by `system`, because a cron job is not an administrator with a login.

A failure returns non-zero, which is what `curl -fsS` turns into a failing cron
job, **and** emails `OIKONOMIA_ALERT_TO`. Failures only: an alert that arrives
nightly when everything worked is one somebody makes a filter for, and then the
one that matters is filtered too. Silence means the work is being done.

## Restoring

Restoring **into** production is deliberately not a button. A one-click control
that replaces every record in the church is a control nobody should have, and
doing it safely needs a write lock and a maintenance window a web request
cannot hold.

1. **Stop the application.** A restore under a live writer is a corruption.

2. **Keep what is there now — all three files.**

   ```bash
   cd /var/lib/oikonomia
   mkdir -p before-restore
   mv oikonomia.db oikonomia.db-wal oikonomia.db-shm before-restore/ 2>/dev/null
   ```

   > Write-ahead logging means recent transactions live in `oikonomia.db-wal`
   > until a checkpoint. Moving only `oikonomia.db` aside preserves a copy
   > missing everything recent — a drill found it to be 4 KB with no tables in
   > it — and leaving a stale `-wal` beside a restored database is worse,
   > because SQLite will try to apply one database's log to another.

3. **Check the artifact against the job record.**

   ```bash
   sha256sum /mnt/backup/oikonomia/<artifact>
   sqlite3 before-restore/oikonomia.db \
     "SELECT checksum, completed_at FROM data_job
       WHERE operation='backup' AND status='completed'
       ORDER BY completed_at DESC LIMIT 1;"
   ```

   If they differ, stop. The checksum is of the stored file, so for an
   encrypted backup compare it **before** decrypting.

4. **Copy it into place** as `oikonomia.db` — copy, so the backup is still a
   backup afterwards.

   An encrypted backup (`.db.enc`) is decrypted into place instead, with the
   key it was taken with. The script reads the key from the environment, never
   its arguments — load it from wherever you keep it rather than typing it
   into shell history — refuses to overwrite a file, and removes what it wrote
   if the key does not open the backup:

   ```bash
   set -a; . /path/to/the/file/holding/the/key; set +a
   node scripts/ops/decrypt-backup.mjs /mnt/backup/oikonomia/<artifact>.db.enc oikonomia.db
   ```

5. **Start, and ask whether it is well.**

   ```bash
   curl -fsS http://127.0.0.1:8080/healthz
   ```

   Migrations run on the first request; a backup from an older build is
   migrated forward. Never restore into an **older** build: migrations move
   forward only.

6. **Check.** Sign in, open Administration, confirm the people and ministries
   are the ones you expect. Expect to find nothing entered after the backup was
   taken — that is the recovery point working, not a failed restore.

This procedure has been performed against the production build, not only
written: an installation with two people and one ministry, a scheduled backup,
a further ministry added afterwards, the database replaced from the off-server
copy. Both people and the original ministry came back, the later ministry was
correctly absent, and the signed-in session survived because sessions live in
the database that was restored.

## First run

An empty installation sends the first visitor to `/setup`, which creates the
first person, their account and their password, and then refuses to run again.
Everybody else is invited from inside the application.
