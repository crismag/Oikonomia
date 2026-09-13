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
| `OIKONOMIA_ARTIFACTS`                                     | Where exports and backups are written                          | `artifacts/` beside the database                                                |
| `PORT` / `NITRO_PORT`                                     | Listen port                                                    | 3000                                                                            |
| `HOST` / `NITRO_HOST`                                     | Listen interface                                               | Every interface                                                                 |
| `OIKONOMIA_SMTP_HOST`, `OIKONOMIA_MAIL_FROM`              | Magic links, password resets, invitations                      | Those controls are removed and the screen says why                              |
| `OIKONOMIA_SMTP_PORT` / `_SECURE` / `_USER` / `_PASSWORD` | SMTP details                                                   | 587, STARTTLS, no credentials                                                   |
| `GOOGLE_CLIENT_ID` / `_SECRET`                            | Google sign-in                                                 | The screen does not offer Google                                                |
| `OIKONOMIA_BACKUP_DIR`                                    | A second backup destination                                    | Every backup is on this machine, and the panel says so                          |
| `OIKONOMIA_BACKUP_OFFSITE`                                | Declares that directory leaves this machine                    | Treated as a second local copy                                                  |
| `OIKONOMIA_MAINTENANCE_TOKEN`                             | Scheduled maintenance                                          | **The endpoint is off, not open**                                               |
| `OIKONOMIA_ALERT_TO`                                      | Email on a failed scheduled task                               | Only cron's exit code reports it                                                |

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
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

**What the CSP does and does not do**, stated precisely because overstating it
is a reason not to look at the real defences: the framework streams an inline
script whose contents differ per request, so it cannot be allowed by hash and
needs `'unsafe-inline'`. That keyword also permits inline event handlers, so
the policy would **not** stop injected script from running. What it stops is
the half that makes such a bug worth exploiting — `connect-src 'self'` refuses
the exfiltration, `script-src 'self'` refuses a larger payload from elsewhere,
and `frame-ancestors 'none'` refuses framing. Moving to a nonce would remove
the caveat.

No policy is sent in development: Vite needs `eval` and a websocket, and a
policy loosened until it permits those is not the policy production runs.

## Backups

```bash
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/maintenance/run?task=backup
```

SQLite's own online backup into a scratch file, read back and stored through
the artifact provider. Copying the database file directly would capture it
mid-transaction, and a torn backup is one nobody discovers is useless until
they need it.

With `OIKONOMIA_BACKUP_DIR` set, every backup is written to **both**
destinations — after the local copy rather than instead of it. If the second
write fails, the backup that already succeeded is still a backup and the job
records that the copy did not happen. A failure to duplicate is not a failure
to back up.

**`OIKONOMIA_BACKUP_OFFSITE` is your assertion, not a measurement.** From
inside the process, a volume mounted from another building and a folder on the
same disk look identical, so only the literal word `true` counts and the
interface attributes the claim to you. What Oikonomia _can_ check, it does:
whether the directory is on a different filesystem device to the database, and
it warns when it is not.

### A limit worth knowing

A backup runs **synchronously** — the process serving requests is the process
taking it. On a local disk that is a few seconds. A destination that neither
succeeds nor fails is different: a hung network mount is the real-world case,
so a local path _synced_ elsewhere is safer than a network path written to
directly. A destination that merely refuses is well behaved: a read-only
directory returns a 500 naming the reason and leaves the server responsive.

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

   If they differ, stop.

4. **Copy it into place** as `oikonomia.db` — copy, so the backup is still a
   backup afterwards.

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
