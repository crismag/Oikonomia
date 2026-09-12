-- Slowing somebody down.
--
-- Every authentication refusal was recorded and then permitted again
-- immediately. A password could be guessed as fast as the network allowed,
-- and a magic-link form could be used to send mail at somebody repeatedly.
-- Recording an attack is not resisting one.
--
-- ## What is counted, and what is not
--
-- One row per **subject** — an email address somebody typed, whether or not
-- an account has it. Counting only addresses that exist would make the
-- throttle itself an existence oracle: a request that is refused quickly and
-- one that is throttled would tell an enumerator which addresses are real.
-- Anything typed into the box gets a row.
--
-- Success clears the row. Somebody who mistypes their password four times and
-- then gets it right does not carry four failures into tomorrow.
--
-- ## Not by IP address
--
-- Deliberately. Behind a reverse proxy the client's address arrives in a
-- header the client can write, and a limiter keyed on a value the attacker
-- chooses is a limiter the attacker opts out of. Address-based limiting
-- belongs at the proxy, which knows the real socket. This table is about the
-- thing an attacker cannot vary while still attacking: the account they want.

CREATE TABLE auth_throttle (
  -- "<kind>:<lowercased subject>" — the kind keeps sign-in attempts from
  -- consuming the budget for password resets, which are different actions
  -- with different costs.
  key               TEXT PRIMARY KEY,

  -- When the current counting window opened. Windows are fixed rather than
  -- sliding: simpler to reason about, and the difference does not matter at
  -- the scale a church operates.
  window_started_at TEXT    NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,

  -- Set once the limit is reached. Null means counting, not blocked.
  blocked_until     TEXT,

  updated_at        TEXT    NOT NULL
);

-- Expired rows are swept rather than left to accumulate.
CREATE INDEX auth_throttle_updated ON auth_throttle (updated_at);
