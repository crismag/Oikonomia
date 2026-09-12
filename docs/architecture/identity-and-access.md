# Identity and access

## The distinction everything rests on

```text
AUTHENTICATION   who are you?
ACCOUNT          which Oikonomia account is that?
PERSON           which human being does that account belong to?
ASSIGNMENT       where do they serve, confirmed by whom?
AUTHORIZATION    what may they read or change?
```

**Signing in proves identity and nothing else.** It does not prove ministry
membership, group membership, a leadership position, reporting responsibility,
administrative scope, report visibility or confidential-record access. Those
are governed by confirmed assignments, and nothing in authentication writes
one.

## Where identity comes from

A request's identity comes from **a session the server issued, and from nothing
else**. Not a body field, not a query parameter, not a header the client chose,
not a person id in a cookie.

```text
session cookie  →  auth_session row  →  account  →  person
```

Every link is one the server wrote. `src/server/auth/principal.ts` is the only
place that chain is walked; `getCurrentUser` is the only name the rest of the
application knows it by.

A principal carries `accountId`, `personId`, `sessionId`, `sessionStartedAt` —
and **no privileges**. Capabilities are read from the person's record at the
moment they are needed, so a role changed a minute ago takes effect on the next
request and a session issued before the change carries nothing stale. A test
asserts the exact key set, so adding a field is a deliberate act.

### Four things, kept apart

| Thing          | What it is                                    | Table                |
| -------------- | --------------------------------------------- | -------------------- |
| **Person**     | The human being, and the church's record      | `person`             |
| **Account**    | Their way in to the application               | `account`            |
| **Credential** | One proof they can offer                      | `account_credential` |
| **Session**    | One period of being signed in, on one browser | `auth_session`       |

A credential is a row rather than columns on the account, because a password
and a Google link are different things with different lifetimes, and an account
may reasonably have both or neither.

## The ways in

All converge on one resolution layer, `auth-service.ts`. There is exactly one
answer to "which account is this?".

### Password

`scrypt` from Node's own crypto — `N=32768, r=8, p=1, keylen=64`, with
`maxmem` raised to 64 MB because the default is too small for those
parameters. Per-credential salt, and the parameters stored _with each hash_ so
the cost can be raised without invalidating what exists. The algorithm is a
stored field, so moving to another one later is a rehash on next login rather
than a migration.

A failed sign-in says one sentence whichever half was wrong, and a missing
account is verified against a decoy hash so it does not answer measurably
faster than a wrong password.

> **Why scrypt and not Argon2id.** Every Argon2 for Node is a native addon — a
> second compiled dependency a church carries per platform, for a deployment
> with no build pipeline. scrypt is memory-hard, in the same family, and needs
> nothing installed.

### Magic link and password reset

256 bits of randomness, stored hashed, **15 minutes**. Single use is decided by
the database — a conditional update — rather than a read followed by a write,
so two simultaneous requests with one link cannot both succeed.

Asking for a link always succeeds, whether or not the address belongs to
anybody. Telling the caller is how a login form becomes an address checker.

### Google

OAuth authorization-code flow. `state` is random per attempt, kept in a short
`HttpOnly` cookie, and checked on return — a callback with no state check is
login CSRF.

An ID token must prove its issuer, its audience, that it has not expired, that
it names a subject, and that the email is verified. Accounts are matched on
Google's **stable subject, never on the email**: an address can change hands,
and matching on one is how somebody inherits an account that was never theirs.

Google is offered only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`OIKONOMIA_URL` are all set. The screen does not draw a button that cannot
work.

## Sessions

An opaque random token in an `HttpOnly`, `SameSite=Lax` cookie, marked
`Secure` wherever the deployment is not plain local development. Only the
token's **hash** is stored, so somebody who reads the table cannot sign in with
what they find. Lifetime is **14 days**.

Five things are checked on **every** request: the session exists, it is not
revoked, it has not expired, the account is active, and the person is not
deactivated. Revocation is immediate rather than eventual.

Changing a password signs every session out, including the one changing it: if
the reason for changing it is that somebody else knew it, leaving their session
alive defeats the change. A leader can also end one named device, or every
device but the one they are using, from Account & security.

## Throttling

| Action                 | Allowed    | Window     | Block      |
| ---------------------- | ---------- | ---------- | ---------- |
| Password sign-in       | 5 failures | 15 minutes | 15 minutes |
| Magic-link request     | 3 requests | 15 minutes | 15 minutes |
| Password reset request | 3 requests | 15 minutes | 15 minutes |

Success clears the count. A subject already blocked has its block **extended**
rather than recomputed, so hammering a locked account keeps it locked.

**Every subject typed into the box is counted, whether or not an account has
it.** Counting only real addresses would make the throttle an existence oracle
— a quick refusal and a throttle would tell an enumerator which addresses are
real. That property is what makes the distinct "too many attempts" wording safe
to show, and a test asserts an invented address is throttled identically to a
real one.

**Not by IP address, deliberately.** Behind a reverse proxy the client's
address arrives in a header the client can write, and a limiter keyed on a
value the attacker chooses is one the attacker opts out of. Address-based
limiting belongs at the proxy, which knows the real socket.

Token redemption is not throttled: a link is 256 bits of randomness, not a
subject somebody chose, and guessing one is not something rate limiting makes
harder. What is limited is _asking_ for links, which is the part that costs
somebody an inbox.

## Account lifecycle

| Situation                      | What happens                                            |
| ------------------------------ | ------------------------------------------------------- |
| Person exists, account active  | Signs in normally                                       |
| Person exists, no account      | An administrator invites them. There is no self-service |
| Account invited, no credential | Cannot sign in until the invitation link sets one       |
| Unknown identity authenticates | **Refused.** Invitation-only; no account is created     |
| Account suspended              | Refused, in the same words as a wrong password          |
| Person deactivated             | Refused, and any live session stops working             |
| No confirmed assignments       | Signs in fine and sees very little. That is valid       |

### The first person

A new installation has nobody, so nobody can authorize anything. `/setup`
creates the first person, their account and their password in one step, and is
refused the moment anybody exists. It is the only place an account is created
with a credential in one action, and the only place that is safe — there is
provably nobody to ask.

### Everybody else

An administrator opens the person's record, saves an email address, and presses
**Invite to Oikonomia**. That creates the account and emails a link which sets
a password. The link is never returned to the browser: a set-a-password token
on an administrator's screen is a credential in a place credentials do not
belong.

Setting a first password and replacing a forgotten one are the same act, so
both use a `password-reset` token, and an **invited** account is accepted where
an active one would be. Suspended accounts and deactivated people are still
refused.

Where no mail provider is configured the account is still created, and an
administrator sets the password with:

```bash
npm run auth:set-password -- somebody@example.org "a long passphrase"
```

That tool needs a shell and the database file, is not reachable over HTTP, and
there is no endpoint that does the same without an authenticated administrator.

## Authorization

Two independent mechanisms, and confusing them is the usual mistake.

### Capabilities — what somebody may administer

A closed set of three, defined in `src/domain/capabilities.ts`:

| Capability                 | What it grants                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `campus-oversight`         | Sees one campus's leadership work by name; may put somebody else's name against a gathering. Does **not** open confidential reports |
| `cross-ministry-oversight` | Sees across ministries                                                                                                              |
| `administration`           | Administers the installation                                                                                                        |

**Roles are configuration; capabilities are code.** An administrator can create
a role, rename it, and choose which of these three capabilities it bundles.
They cannot invent a fourth, because a capability is a thing the code checks.
Configuration chooses among behaviours that exist; it never adds one, and it
never widens access.

### Assignments — where somebody serves

```ts
assignmentStatuses = ["confirmed", "pending", "correction-requested", "ended"];
isServing = (status) => status === "confirmed";
```

**Only `confirmed` counts as serving.** A person can claim an assignment; the
claim is recorded as `pending` and grants nothing — no membership, no export
scope, no readership — until an administrator confirms it, and it cannot be
confirmed by the person who made it. `ended` is history, kept rather than
deleted.

The repository filters enforce this in SQL, not only in the service:

```sql
SELECT ministry_id, person_id FROM ministry_member
 WHERE person_id IN (…) AND shared = 0 AND status = 'confirmed'
```

### Record-level access

`src/domain/access.ts` decides who may open a record and how much of it. It is
called by `goals-service`, `work-service` and `document-service` before they
return anything, and by `leadership-report.ts` for report discovery.

Four rules it exists to hold:

- **Attention never grants access.** Being asked to look at something is not
  permission to read it.
- **Administration is not omniscience.** Administering the installation does
  not make somebody an audience for what is in it.
- **Rank never overrides a classification ceiling.** Seniority is not a key.
- **Default deny.**

Order matters: exclusion before every grant, ownership before sharing, and a
section-level ceiling last — so a reviewer sees a record while sections held to
a stricter audience stay closed.

### What the browser's copy of the rules is for

The same rules are evaluated in the browser, over records the viewer already
has. That is **not** the enforcement. It is so the interface can decline to
draw a control that would be refused. A hidden button is a courtesy, never a
rule.

## What a refusal is allowed to say

A report the viewer may not read and a report that does not exist are
**indistinguishable**. Saying "forbidden" would confirm that a report about
somebody exists. Knowing an identifier is never permission to use it.

`src/server/auth/authorization-boundary.test.ts` exercises this through real
sessions rather than constructed viewers: the author gets their private report;
another leader, the bishop and the administrator are all refused identically.

## What is not built

- **Read auditing for confidential records.** Data operations are audited;
  ordinary reads are not.
- **A separate confidential storage model.** Classification is enforced on
  access, not by storing differently.
- **Alerting on repeated sign-in failures.** They are recorded in `auth_event`
  and read only if somebody looks.

## Audit

`auth.login.success`, `auth.login.failed`, `auth.logout`, `auth.throttled`,
`auth.magic_link.requested/used/refused`,
`auth.password_reset.requested/completed/refused`, `auth.password.changed`,
`auth.identity.linked`, `auth.account.invited/activated/suspended`,
`auth.session.revoked`, `auth.session.revoked_all`.

Never a password, a hash, a raw token, an OAuth token or a session secret. An
audit trail that records the secret it was watching has become the
vulnerability it exists to detect. Events are pruned beyond a year by the sweep
maintenance task.
