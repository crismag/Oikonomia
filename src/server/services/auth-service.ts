import { text } from "@/config/messages";
import { ApiError } from "../api/response";
import { hashPassword, verifyPassword } from "../auth/secrets";
import { SESSION_LIFETIME_MS } from "../auth/principal";
import type { Throttle, ThrottleKind } from "../auth/throttle";
import type { Account, AccountRepository } from "../repositories/account-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";

/**
 * Proving who somebody is.
 *
 * ## One resolution layer, three ways in
 *
 * ```text
 *   Google  ┐
 *   Magic   ├──►  an authenticated identity  ──►  account  ──►  person
 *   Password┘
 * ```
 *
 * Each method proves something different, and they all converge here. There is
 * exactly one answer to "which account is this?", and everything downstream —
 * discovery, export scope, assignments, administration — reads the person that
 * account names.
 *
 * ## What signing in does not do
 *
 * It does not make anybody a member of anything. A verified Google email is an
 * email that has been verified; it is not a ministry, a group, a leadership
 * position or a capability. Those stay with the confirmed assignments the
 * organisation owns, and this service never writes one.
 *
 * ## Two policies that shape the code
 *
 * **Invitation, not self-registration.** Somebody unknown who authenticates
 * successfully is still nobody here: an account exists because an administrator
 * entered a person. Creating one on a successful Google sign-in would let
 * anybody with a Google account into a church's records.
 *
 * **Generic answers.** A failed sign-in says one sentence regardless of which
 * half was wrong, and asking for a magic link always succeeds. The difference
 * between "no such account" and "wrong password" is exactly what somebody
 * enumerating accounts is looking for.
 */

/** How long a magic link or a reset is good for. */
export const LINK_LIFETIME_MS = 15 * 60 * 1000;

/**
 * How long an invitation's link is good for.
 *
 * Longer than a reset, on purpose: somebody who asked for a reset is at the
 * screen waiting for it; somebody invited is not, and an invitation sent to a
 * whole leadership team on Monday is read through the week. It still works
 * once, and "Forgot password?" issues a fresh one after it lapses.
 */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The most addresses one invitation run takes. */
export const MAX_INVITATIONS = 200;

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What happened to one address in an invitation run. */
export type InvitationOutcome =
  | { email: string; outcome: "invited"; personId: string; accountId: string; created: boolean }
  | { email: string; outcome: "already-has-access" | "invalid" | "conflict" };

/** One sentence, whatever went wrong. */
const REFUSED = text("refusal.auth.refused");

/**
 * What a throttled caller is told.
 *
 * Distinguishable from `REFUSED`, and safe to be: every subject typed into
 * the box is counted whether or not an account has it, so being throttled
 * says nothing about whether the address is real.
 */
const THROTTLED = text("refusal.auth.throttled");

export interface SignedIn {
  /** The only copy of the session token. It goes in a cookie and nowhere else. */
  token: string;
  account: Account;
}

export function createAuthService(
  accounts: AccountRepository,
  organization: OrganizationRepository,
  /**
   * Optional so the many tests that predate throttling still read clearly.
   * A caller that passes nothing gets a service that counts nothing — which
   * is the old behaviour, and is why the composition edge always passes one.
   */
  throttle?: Throttle,
) {
  /**
   * Refuse early when somebody has already been told to wait.
   *
   * Before the credential is checked rather than after: verifying a password
   * for a subject we have decided not to answer is work an attacker gets for
   * free.
   */
  function guard(kind: ThrottleKind, subject: string): void {
    if (throttle?.blocked(kind, subject)) {
      accounts.record({
        identifier: subject,
        action: "auth.throttled",
        method: kind,
        result: "refused",
      });
      throw ApiError.unauthenticated(THROTTLED);
    }
  }
  /**
   * Turn a resolved account into a session.
   *
   * Called by every method once it has proven identity, so session policy —
   * lifetime, rotation, what is recorded — lives in one place rather than
   * three.
   */
  function beginSession(account: Account, method: string, userAgent?: string): SignedIn {
    /*
     * Any other session on this account is left alone: somebody signing in on
     * their phone should not sign themselves out on their laptop. Rotation
     * that matters — after a password change — is explicit and elsewhere.
     */
    const { token } = accounts.openSession({
      accountId: account.id,
      lifetimeMs: SESSION_LIFETIME_MS,
      ...(userAgent ? { userAgent } : {}),
    });

    accounts.update(account.id, { lastLoginAt: new Date().toISOString() });
    accounts.record({ accountId: account.id, action: "auth.login.success", method });

    return { token, account: accounts.find(account.id)! };
  }

  /**
   * Whether this account may sign in at all.
   *
   * Checked after the credential, so a suspended account and a wrong password
   * are indistinguishable from outside. Returning "your account is suspended"
   * to somebody who guessed the address confirms the address.
   */
  function usable(account: Account | undefined): account is Account {
    if (!account) return false;
    if (account.status !== "active") return false;

    const person = organization.findPerson(account.personId);
    return Boolean(person) && person!.active !== false;
  }

  /**
   * Whether this account may set a password from a link.
   *
   * Looser than `usable` in exactly one way: an **invited** account qualifies,
   * because setting a first password is the act that makes it active. The
   * stricter check made invitations self-defeating — an administrator could
   * invite somebody, the link would arrive, and the server would refuse it as
   * no longer valid because the account had never been active.
   *
   * Everything else still holds. A **suspended** account is refused, and so is
   * one whose person has been deactivated: neither should be recoverable by
   * following an old link.
   */
  function claimable(account: Account | undefined): account is Account {
    if (!account) return false;
    if (account.status !== "active" && account.status !== "invited") return false;

    const person = organization.findPerson(account.personId);
    return Boolean(person) && person!.active !== false;
  }

  return {
    /* --------------------------------------------------------- password */

    signInWithPassword(input: { email: string; password: string; userAgent?: string }): SignedIn {
      guard("password", input.email);

      const account = accounts.findByEmail(input.email);
      const credential = account ? accounts.credential(account.id, "password") : undefined;

      /*
       * The password is verified even when there is no account, against a
       * throwaway hash. Returning early would make a missing account faster
       * than a wrong password, and the difference is measurable.
       */
      const stored = credential ?? DECOY;
      const correct = verifyPassword(input.password, stored);

      if (!account || !credential || !correct || !usable(account)) {
        accounts.record({
          identifier: input.email,
          action: "auth.login.failed",
          method: "password",
          result: "refused",
        });
        throttle?.fail("password", input.email);
        throw ApiError.unauthenticated(REFUSED);
      }

      /* Getting it right forgets the near misses. Somebody who mistypes their
         passphrase four times and then succeeds does not start tomorrow one
         attempt from a lockout. */
      throttle?.clear("password", input.email);
      return beginSession(account, "password", input.userAgent);
    },

    /**
     * Set or change a password.
     *
     * Changing one **signs every other session out**. If the reason for
     * changing it is that somebody else knew it, leaving their session alive
     * defeats the change.
     */
    setPassword(accountId: string, password: string): void {
      if (password.length < 12) {
        throw ApiError.validation({
          password: text("refusal.auth.passwordTooShort"),
        });
      }

      accounts.setCredential({
        accountId,
        provider: "password",
        stored: hashPassword(password),
      });

      /* An account with a password can be signed in to; one without cannot. */
      const account = accounts.find(accountId);
      if (account?.status === "invited") accounts.update(accountId, { status: "active" });

      accounts.revokeAllSessions(accountId);
      accounts.record({ accountId, action: "auth.password.changed", method: "password" });
    },

    /* ------------------------------------------------------- magic link */

    /**
     * Ask for a link.
     *
     * **Always succeeds**, whether or not the address belongs to anybody. What
     * comes back is the token when there is one — for the delivery adapter to
     * send — and nothing when there is not. The caller cannot tell the
     * difference, and neither can somebody testing addresses.
     */
    requestMagicLink(email: string): { token?: string; account?: Account } {
      guard("magic-link", email);

      /* Counted on every request rather than on failure, because there is no
         failure here — this call always reports success — and the cost being
         limited is an email somebody did not ask for. */
      throttle?.fail("magic-link", email);

      const account = accounts.findByEmail(email);

      accounts.record({
        identifier: email,
        action: "auth.magic_link.requested",
        method: "magic-link",
        /* Recorded honestly for whoever investigates later — this is the
           server's own log, not the answer given to the browser. */
        result: account ? "issued" : "no-account",
      });

      if (!account || !usable(account)) return {};

      return {
        token: accounts.issueToken({
          accountId: account.id,
          purpose: "magic-link",
          lifetimeMs: LINK_LIFETIME_MS,
        }),
        account,
      };
    },

    /**
     * Follow a link.
     *
     * Four ways to fail, and all four say the same thing: no such token, spent,
     * expired, or the account cannot sign in. The token is spent atomically, so
     * two simultaneous requests with one link cannot both succeed.
     *
     * **Not throttled, deliberately.** There is no subject to count — a token
     * is 256 bits of randomness, not an address somebody chose — and guessing
     * one is not a thing rate limiting makes harder. What is throttled is
     * *asking* for links, which is the part that costs somebody an inbox.
     */
    signInWithMagicLink(input: { token: string; userAgent?: string }): SignedIn {
      const refuse = () => {
        accounts.record({
          action: "auth.magic_link.refused",
          method: "magic-link",
          result: "refused",
        });
        throw ApiError.unauthenticated(text("refusal.auth.linkExpired"));
      };

      const found = accounts.findToken(input.token, "magic-link");
      if (!found) refuse();
      if (found!.usedAt) refuse();
      if (found!.expiresAt <= new Date().toISOString()) refuse();

      const account = accounts.find(found!.accountId);
      if (!usable(account)) refuse();

      /* Single use is decided here, by the database, rather than by the read
         above — two requests can pass that check simultaneously. */
      if (!accounts.consumeToken(input.token, "magic-link")) refuse();

      /* Following a link to an address proves the address. */
      if (!account!.emailVerified) accounts.update(account!.id, { emailVerified: true });

      accounts.record({
        accountId: account!.id,
        action: "auth.magic_link.used",
        method: "magic-link",
      });

      return beginSession(account!, "magic-link", input.userAgent);
    },

    /**
     * Ask to set a new password.
     *
     * The same shape as a magic link, and for the same reasons: always
     * succeeds, single use, short expiry. The difference is what the token
     * lets somebody do when they follow it.
     */
    requestPasswordReset(email: string): { token?: string; account?: Account } {
      guard("password-reset", email);
      throttle?.fail("password-reset", email);

      const account = accounts.findByEmail(email);

      accounts.record({
        identifier: email,
        action: "auth.password_reset.requested",
        result: account ? "issued" : "no-account",
      });

      if (!account || !usable(account)) return {};

      return {
        token: accounts.issueToken({
          accountId: account.id,
          purpose: "password-reset",
          lifetimeMs: LINK_LIFETIME_MS,
        }),
        account,
      };
    },

    /**
     * Set a new password by following a reset link.
     *
     * Does **not** sign anybody in. Proving you can read an address is enough
     * to change a password; it is not enough to skip the sign-in that follows,
     * and conflating the two turns every reset link into a login link with a
     * longer life.
     */
    resetPassword(input: { token: string; password: string }): void {
      const refuse = (): never => {
        accounts.record({ action: "auth.password_reset.refused", result: "refused" });
        throw ApiError.unauthenticated(text("refusal.auth.linkExpired"));
      };

      const found = accounts.findToken(input.token, "password-reset");
      if (!found || found.usedAt || found.expiresAt <= new Date().toISOString()) refuse();

      const account = accounts.find(found!.accountId);
      if (!claimable(account)) refuse();
      if (!accounts.consumeToken(input.token, "password-reset")) refuse();

      /* `setPassword` revokes every session, which is exactly right here: a
         reset is often a response to somebody else having had access. */
      this.setPassword(account!.id, input.password);
      accounts.record({ accountId: account!.id, action: "auth.password_reset.completed" });
    },

    /* ----------------------------------------------------------- google */

    /**
     * Sign in with a Google identity that has already been verified.
     *
     * This takes the **result** of verifying an ID token, not the token — the
     * verification is the OAuth layer's job, and keeping it out of here means
     * this policy can be tested without the network.
     *
     * Matched on Google's stable subject, **never on the email**. An address
     * can change hands; matching on one is how somebody inherits an account
     * that was never theirs.
     */
    signInWithGoogle(input: {
      subject: string;
      email: string;
      emailVerified: boolean;
      userAgent?: string;
    }): SignedIn {
      const refuse = (reason: string): never => {
        accounts.record({
          identifier: input.email,
          action: "auth.login.failed",
          method: "google",
          result: reason,
        });
        throw ApiError.unauthenticated(text("refusal.auth.googleAccountUnknown"));
      };

      const linked = accounts.findBySubject("google", input.subject);
      if (linked) {
        if (!usable(linked)) return refuse("not-usable");
        return beginSession(linked, "google", input.userAgent);
      }

      /*
       * Not linked yet. Linking to an existing account needs **proof**, and a
       * Google-verified email is the proof this product accepts — so an
       * unverified one is refused rather than trusted.
       *
       * Self-registration is not permitted: an account exists because somebody
       * entered a person. An unknown Google identity is refused, not welcomed.
       */
      if (!input.emailVerified) return refuse("email-unverified");

      const account = accounts.findByEmail(input.email);
      if (!account) return refuse("no-account");
      if (!usable(account)) return refuse("not-usable");

      accounts.setCredential({
        accountId: account.id,
        provider: "google",
        subject: input.subject,
      });
      accounts.update(account.id, { emailVerified: true });
      accounts.record({
        accountId: account.id,
        action: "auth.identity.linked",
        method: "google",
      });

      return beginSession(account, "google", input.userAgent);
    },

    /* ---------------------------------------------------------- session */

    /**
     * A session for an account whose identity was established some other way.
     *
     * For an entry path that is not a credential — a public demonstration's
     * chosen identity — so it gets exactly the session every other sign-in
     * gets: the same lifetime, the same `auth_event`, and the same refusal of
     * an account that is not active or whose person has been deactivated.
     * Deciding *whether* somebody may enter that way is the caller's job; this
     * only refuses what no way in may open.
     */
    beginSessionFor(accountId: string, method: string, userAgent?: string): SignedIn {
      const account = accounts.find(accountId);
      if (!usable(account)) {
        accounts.record({
          accountId,
          action: "auth.login.failed",
          method,
          result: "refused",
        });
        throw ApiError.unauthenticated(text("refusal.auth.accountDisabled"));
      }
      return beginSession(account, method, userAgent);
    },

    signOut(token: string, accountId?: string): void {
      accounts.revokeSession(token);
      accounts.record({ ...(accountId ? { accountId } : {}), action: "auth.logout" });
    },

    signOutEverywhere(accountId: string): void {
      accounts.revokeAllSessions(accountId);
      accounts.record({ accountId, action: "auth.session.revoked_all" });
    },

    /* --------------------------------------------------------- accounts */

    /**
     * Give a person a way in.
     *
     * Administrative. An account is created by somebody who already decided the
     * person belongs here, which is what makes invitation-only tenable.
     */
    inviteAccount(personId: string, email: string): Account {
      const person = organization.findPerson(personId);
      if (!person) throw ApiError.notFound("That person");

      const existing = accounts.findByPerson(personId);
      if (existing) {
        const updated = accounts.update(existing.id, { email, status: "invited" })!;
        accounts.record({ accountId: updated.id, action: "auth.account.invited" });
        return updated;
      }

      const taken = accounts.findByEmail(email);
      if (taken) {
        throw ApiError.conflict(text("refusal.auth.emailTaken"));
      }

      const account = accounts.create({ personId, email, status: "invited" });
      accounts.record({ accountId: account.id, action: "auth.account.invited" });
      return account;
    },

    /**
     * Invite many people by address.
     *
     * Each address becomes a person and an invited account. An address the
     * directory already holds invites that person; an address nobody holds
     * adds somebody, recorded under the address until they give their own
     * name on their first visit (`awaitsOwnName`). Either way the invitation
     * grants **nothing** beyond a way in, exactly as a single one does.
     *
     * Somebody who can already sign in is left alone: re-inviting would put an
     * active account back to invited and hand out a new way in nobody asked
     * for. Each address is decided on its own, so one bad line does not refuse
     * the rest. Administrative; the caller checks.
     */
    inviteByEmail(addresses: readonly string[]): InvitationOutcome[] {
      if (addresses.length > MAX_INVITATIONS) {
        throw ApiError.validation({
          emails: text("refusal.auth.inviteTooMany", { max: MAX_INVITATIONS }),
        });
      }

      const seen = new Set<string>();
      const outcomes: InvitationOutcome[] = [];

      for (const raw of addresses) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);

        if (!ADDRESS.test(email) || email.length > 200) {
          outcomes.push({ email, outcome: "invalid" });
          continue;
        }

        /* The address may be on the person's record, or only on their account
           — people entered before email was kept have one without the other. */
        const account =
          accounts.findByEmail(email) ?? accounts.findByEmail(raw.trim()) ?? undefined;
        const known =
          organization.findPersonByEmail(email) ??
          organization.findPersonByEmail(raw.trim()) ??
          (account ? organization.findPerson(account.personId) : undefined);
        const theirs = known ? (accounts.findByPerson(known.id) ?? account) : account;

        if (theirs && theirs.status === "active") {
          outcomes.push({ email, outcome: "already-has-access" });
          continue;
        }
        if (!known && theirs) {
          /* An account whose person is gone: a merge for a person to decide,
             not this loop. */
          outcomes.push({ email, outcome: "conflict" });
          continue;
        }

        const person = known ?? organization.insertPerson({ name: email, email });
        try {
          const invited = this.inviteAccount(person.id, person.email ?? email);
          outcomes.push({
            email,
            outcome: "invited",
            personId: person.id,
            accountId: invited.id,
            created: !known,
          });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          outcomes.push({ email, outcome: "conflict" });
        }
      }

      return outcomes;
    },

    setAccountStatus(accountId: string, status: Account["status"]): Account {
      const account = accounts.update(accountId, { status });
      if (!account) throw ApiError.notFound("That account");

      /* Suspending somebody has to take effect now, not when their session
         happens to lapse. */
      if (status !== "active") accounts.revokeAllSessions(accountId);

      accounts.record({
        accountId,
        action: status === "active" ? "auth.account.activated" : "auth.account.suspended",
      });
      return account;
    },
  };
}

/**
 * A hash to check a password against when there is no account.
 *
 * Generated once at module load so every failed sign-in costs roughly what a
 * successful one costs. Without it, a missing account returns measurably faster
 * than a wrong password, and that difference is an account-enumeration oracle.
 */
const DECOY = hashPassword("decoy-for-constant-time-comparison");

export type AuthService = ReturnType<typeof createAuthService>;
