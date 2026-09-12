-- Proving who somebody is.
--
-- Until now Oikonomia believed a cookie. `oikonomia_person` held a person id,
-- and every authorization decision in the product — report discovery, export
-- scoping, confirmed assignments, administration — was evaluated against a
-- claim nobody had checked. The rules were real. What they were enforced
-- against was not.
--
-- ## Four things, kept apart
--
--   Person       the human being, and the church's record of them
--   Account      their way in to the application
--   Credential   one proof they can offer — a password, a Google identity
--   Session      one period of being signed in, on one browser
--
-- Collapsing any pair is the usual mistake. In particular: **an account is not
-- a person**, and a verified Google email is not a membership. Signing in
-- proves identity and nothing else — where somebody serves and what they may
-- read stays with the confirmed assignments the organisation owns.
--
-- ## Nobody gains a login from this migration
--
-- An account row is created for every existing person so nothing is lost and
-- ids stay stable. Every one is created **without a credential**, which means
-- nobody can sign in with it until somebody sets one. A migration that quietly
-- issued passwords would be the security hole this work exists to close.

CREATE TABLE account (
  id          TEXT PRIMARY KEY,

  -- The church-domain person this account is for. One account per person:
  -- two ways in for the same human is a linking problem, not two accounts.
  person_id   TEXT NOT NULL UNIQUE REFERENCES person(id) ON DELETE CASCADE,

  -- Where a magic link would go, and what a Google identity is matched
  -- against. Nullable: a person may exist in the organisation long before
  -- anybody has an address for them.
  email       TEXT UNIQUE,
  -- Whether that address has been proven, by following a link to it or by a
  -- provider asserting it. Never assumed from typing it in.
  email_verified INTEGER NOT NULL DEFAULT 0,

  -- 'invited'   — exists, cannot sign in yet
  -- 'active'    — may sign in
  -- 'suspended' — may not, and is told so generically
  status      TEXT NOT NULL DEFAULT 'invited'
              CHECK (status IN ('invited', 'active', 'suspended')),

  created_at  TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX account_person ON account (person_id);

-- One proof an account can offer.
--
-- A row per provider rather than columns on the account, because they are
-- genuinely different things with different lifetimes: a password is rotated,
-- a Google link is established once and may be removed, and an account may
-- reasonably have both or neither.
CREATE TABLE account_credential (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,

  provider    TEXT NOT NULL CHECK (provider IN ('password', 'google')),

  -- Google's stable subject id. Never the email: an email can change hands,
  -- and matching on one is how the wrong person inherits an account.
  subject     TEXT,

  -- Password only. The hash, its salt, and the parameters used — kept per row
  -- so the cost can be raised later without invalidating what is stored.
  secret      TEXT,
  salt        TEXT,
  algorithm   TEXT,
  parameters  TEXT,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,

  -- One password per account, and one link per Google identity.
  UNIQUE (account_id, provider),
  UNIQUE (provider, subject)
);

-- One period of being signed in.
--
-- The row's id is the **hash** of the token in the cookie, never the token.
-- Somebody who reads this table cannot use what they find to sign in as
-- anybody, which is the same reason passwords are hashed.
CREATE TABLE auth_session (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,

  created_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- Absolute lifetime. A session is not extended indefinitely by being used.
  expires_at  TEXT NOT NULL,
  -- Set on sign-out, on password change, and on sign-out-everywhere. Checked
  -- on every request, so revocation is immediate rather than eventual.
  revoked_at  TEXT,

  -- For somebody reviewing their own sessions. Never used for authorization:
  -- a user agent is a string the client chooses.
  user_agent  TEXT
);

CREATE INDEX auth_session_account ON auth_session (account_id);
CREATE INDEX auth_session_expiry ON auth_session (expires_at);

-- A magic link, or a password reset.
--
-- Same shape because they are the same thing with different consequences: a
-- single-use secret, sent to a proven address, that expires soon. Stored
-- hashed for the same reason as a session.
CREATE TABLE auth_token (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,

  purpose     TEXT NOT NULL CHECK (purpose IN ('magic-link', 'password-reset')),

  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  -- Single use. Set the moment it is spent, so a replay finds it spent.
  used_at     TEXT
);

CREATE INDEX auth_token_account ON auth_token (account_id, purpose);

-- What happened, for somebody investigating later.
--
-- Never a password, a hash, a raw token, an OAuth token or a session secret.
-- An audit trail that records the secret it was watching has become the
-- vulnerability it exists to detect.
CREATE TABLE auth_event (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,

  account_id  TEXT REFERENCES account(id) ON DELETE SET NULL,
  -- Kept as text rather than a foreign key: a failed sign-in may name an
  -- account that does not exist, and that is worth recording.
  identifier  TEXT,

  action      TEXT NOT NULL,
  method      TEXT,
  result      TEXT NOT NULL DEFAULT 'ok',

  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX auth_event_at ON auth_event (at DESC);
CREATE INDEX auth_event_account ON auth_event (account_id);

-- Every existing person gets an account, and nobody gets a way in.
--
-- `invited` and no credential: the account exists so that ids are stable and
-- an administrator has something to attach a credential to. Signing in is
-- impossible until one is set, deliberately.
INSERT INTO account (id, person_id, email, email_verified, status, created_at)
SELECT
  'acc-' || person.id,
  person.id,
  person.email,
  0,
  'invited',
  datetime('now')
FROM person;
