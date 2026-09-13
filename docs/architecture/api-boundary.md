# The API boundary

## Server functions, not HTTP routes

Every client→server call is a TanStack `createServerFn`. There is no REST
surface to version, no hand-written fetch wrapper, and no second place where a
URL and a handler can drift apart. The 18 modules live in `src/lib/*-api.ts`.

Three conventions hold across all of them.

**They live in `lib/`, not `server/`.** A server function is imported by the
component that calls it, so it has to be reachable from client code. What it
_does_ is server-only, which is why the third convention exists.

**The database layer is imported lazily, inside each handler.**

```ts
export const fetchSession = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(() =>
    withAuth(async ({ db, request }) => {
      const { viewerFor } = await import("@/server/auth/principal");
      …
    }),
  );
```

A top-level `import` of the database from a module the client also imports
would pull `better-sqlite3` — a native addon — into the browser bundle. The
dynamic import keeps it on the server where it belongs.

**Everything is validated before anything sees it.** A request need not have
come from a screen, so each function parses its input with zod first. The
editor's HTML sanitizing is the clearest case: the browser sanitizes as
somebody types, and the schema the server parses with refuses markup outside
the same allowlist, because the browser is the half an attacker controls.

## The envelope

One shape for every answer:

```jsonc
{ "data": { … } }

{ "error": { "code": "validation",
             "message": "That title is too long.",
             "fields": { "title": "Give it a title." } } }
```

`unwrap()` on the client turns an `error` into a thrown `CalendarError`
carrying the code, so a caller can distinguish a conflict from a refusal
without parsing prose.

## Errors

| Code                       | Status | Means                                                                |
| -------------------------- | ------ | -------------------------------------------------------------------- |
| `validation`               | 422    | Understood and wrong. `fields` says how                              |
| `not-found`                | 404    | No such record — **or none this viewer may know exists**             |
| `forbidden`                | 403    | The record exists, the viewer may know that, and may not do this     |
| `conflict`                 | 409    | The request conflicts with the record's current state                |
| `unauthenticated`          | 401    | Nobody is signed in, or the person no longer exists                  |
| `disabled-by-installation` | 403    | This installation does not allow it at all — administrators included |
| `internal`                 | 500    | Something the caller could not have prevented                        |

The line between `not-found` and `forbidden` is a security decision, not a
taxonomy. A confidential report the viewer is not an audience for returns
**not-found**, because `forbidden` would confirm that a report about somebody
exists. `forbidden` is for cases where the viewer may already know the record
exists — a ministry they can see but not administer.

`ApiError` is thrown by services and caught once at the request boundary.
Anything else that escapes becomes a generic 500: an unplanned exception's text
is for the log, not for a leader.

## What the client is told when something fails

Never the underlying failure. The sign-in screen is the sharpest example — one
sentence whichever half was wrong — but the rule is general: the message shown
comes from the domain's own catalogue, and the server's specific refusal is
surfaced only where it tells somebody what to do next ("at least one role has
to be able to administer Oikonomia").

## Installation policy

What an installation allows **at all**, whoever is asking — decided by its
environment, never by the database, a setting or a role. Today one policy
exists: `OIKONOMIA_DEMO_MODE=true` (strictly `true` or `false`; any other value
stops the server serving, `/healthz` included).

```text
request → authentication → installation policy → authorization → service
```

Enforced centrally in `src/start.ts`: global function middleware in front of
every server function, request middleware in front of the route handlers that
act on their own (Google sign-in, `/maintenance/run`). It only subtracts:
services, repositories and domain code know nothing about it, and every
ownership and administration check still runs for what remains.

**Every server function is classified** in
`src/server/installation/operations.ts` by `filename#name` — `read`,
`allowed`, or `denied` with a reason. With Demo Mode on, denied operations and
any **unclassified POST** return `disabled-by-installation`; reads and allowed
writes run normally. `src/installation-policy-classified.test.ts` discovers
server functions, route handlers and maintenance tasks from source and fails
when one has no decision — so adding a mutation means deciding, in the same
change, whether a public demonstration may run it.

The browser is told the outcome, never the table: `fetchSession` carries
`installation: { demo, restricted }`, where `restricted` is the set of reasons
(`authentication`, `sessions`, `identity`, `configuration`, `data`) that deny
something. The UI uses it to draw the demo bar and to disable controls with a
note — nothing the browser holds can switch the policy on or off.

Maintenance tasks are decided one by one. In Demo Mode `backup`, `retention`
and `sweep` are denied and `demo-reset` is the one allowed — past the policy
only: it still needs the maintenance bearer token, and the reset itself refuses
anything but a marked demonstration database. Demo Mode also selects the
database: `OIKONOMIA_DEMO_DB`, never `OIKONOMIA_DB` (see
`docs/architecture/deployment.md`, _Demo Mode_).

## Cross-site protection

Server-function POSTs are refused unless the request carries what a real
same-origin browser request carries. A `curl` call reconstructed by hand
against a live installation returns **403** while the identical call from the
browser succeeds.

Combined with `SameSite=Lax` on the session cookie and `form-action 'self'` in
the Content-Security-Policy, a cross-site POST to a server function does not
run.

## Two routes that are not pages

| Route                     | Method | Answers                                                 |
| ------------------------- | ------ | ------------------------------------------------------- |
| `/healthz`                | GET    | `{"ok":true,"migrations":35,"schemaVersion":35}`        |
| `/maintenance/run?task=…` | POST   | `backup`, `retention` or `sweep`, behind a bearer token |

`/healthz` exists because **no ordinary route touches persistence** — every one
returns the application shell and the data arrives afterwards from the browser.
A 200 from `/people` says nothing about whether the database opened, which is
precisely how the missing-migrations failure hid. It reports whether the
database opened and how many migrations are applied, and nothing else: no
record counts, no configuration, and no stack trace on failure, because a
health check that returns one is a reconnaissance endpoint. It is
unauthenticated because a health check that needs a session cannot tell you the
session store is broken.

Both redirect to the application if opened in a browser.
