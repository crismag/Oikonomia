import { text } from "@/config/messages";
import { z } from "zod";

import { ApiError } from "../api/response";
import { parse } from "../api/validation";
import {
  ACTIVE_SESSION_WINDOW_MS,
  type AccountRepository,
} from "../repositories/account-repository";
import type { DemoIdentityRepository } from "../repositories/demo-identity-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";
import type { SignedIn } from "../services/auth-service";
import { config } from "@/config";
import { nextRefreshAt, usableTimeZone } from "@/domain/refresh-schedule";
import { LEAST_PRIVILEGED } from "@/domain/roles";

/**
 * Entering a public demonstration.
 *
 * Nobody signs in to a demonstration with a password. They choose one of the
 * identities its data offers, or they try Oikonomia as themselves with only a
 * name. Either way the result is an ordinary session for an ordinary account,
 * so everything after the entrance is the real application: the same
 * authorization, the same records, the same onboarding.
 *
 * ## Two gates, both required
 *
 * - the installation is in Demo Mode (`OIKONOMIA_DEMO_MODE=true`), and
 * - its database designates at least one identity (`demo_identity`).
 *
 * A church's database with the flag set by mistake designates nobody, so
 * nobody can enter it this way. A demonstration's database running without the
 * flag offers nothing. Neither gate alone opens anything.
 *
 * ## What cannot be chosen
 *
 * Only an identity the data designates. A person id, an account id, a
 * visitor's identity — none of them is accepted, so knowing somebody's id is
 * not a way in.
 */

/**
 * How many people may try the demonstration as themselves before it is reset.
 *
 * A reset replaces the database, visitors included, so this is a limit per
 * reset. It is not protection against a determined abuser — this application
 * has no reliable way to tell one visitor from another — only a ceiling on
 * how much a single period can accumulate.
 */
export const VISITOR_LIMIT = 200;

export const VISITOR_NAME_MAX = 60;

const visitorInput = z.object({
  name: z
    .string({ message: "Tell us what to call you." })
    /* Control characters and line breaks have no place in a name shown to
       other visitors. */
    .transform((value) =>
      value
        .replace(/\p{Cc}+/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(1, "Tell us what to call you.")
        .max(VISITOR_NAME_MAX, `Keep it to ${VISITOR_NAME_MAX} characters.`),
    ),
});

const entryInput = z.object({ identityId: z.string().min(1).max(200) });

export interface DemoIdentityOption {
  /** The demo identity's id — the only thing `enter` accepts. */
  id: string;
  name: string;
  initials: string;
  /** What this person is called in the church, if anything. */
  title: string;
  /** Their access role, as this installation names it. */
  role: string;
  /** Whether this is who the asking browser is already exploring as. */
  current: boolean;
  /**
   * How many sessions are exploring as this identity right now — used within
   * the last few minutes, not revoked, not expired. Sessions, not people: one
   * visitor with two browsers is two.
   */
  active: number;
}

export interface DemoEntry {
  /** Whether this installation is a demonstration at all. */
  demo: boolean;
  /**
   * Whether the asking browser has a session. A page that believes somebody is
   * signed in, told otherwise, knows its session ended — usually because the
   * demonstration was reset.
   */
  signedIn: boolean;
  identities: DemoIdentityOption[];
  /** Whether trying it as yourself is possible right now. */
  visitorsWelcome: boolean;
  /**
   * When the demonstration next returns to its original data, and the
   * timezone that time is kept in. Null on an ordinary installation.
   */
  refresh: { at: string; timeZone: string } | null;
  /**
   * How many times the demonstration has been reset. A browser that last saw
   * a different number knows its session ended because the data was
   * refreshed, not because it expired. Null on an ordinary installation.
   */
  generation: number | null;
}

export function createDemoEntryService(parts: {
  demoMode: boolean;
  identities: DemoIdentityRepository;
  accounts: AccountRepository;
  organization: OrganizationRepository;
  auth: {
    beginSessionFor(accountId: string, method: string, userAgent?: string): SignedIn;
    signOut(token: string): void;
  };
  /** Runs its argument in one database transaction. */
  transaction: <T>(work: () => T) => T;
  /** The church's timezone, in which refreshes happen on the hour. */
  timeZone: string;
  /** The live database's reset count (`demo_state`), if it is a demonstration's. */
  generation?: () => number | null;
  now?: () => Date;
}) {
  const { identities, accounts, organization, auth } = parts;

  /** An identity's account, if both it and its person can be entered. */
  const enterable = (personId: string) => {
    const person = organization.findPerson(personId);
    const account = accounts.findByPerson(personId);
    if (!person || person.active === false || !account || account.status !== "active") {
      return undefined;
    }
    return { person, account };
  };

  const offered = (viewerPersonId: string | undefined): DemoIdentityOption[] => {
    const enterableIdentities = identities.designated().flatMap((identity) => {
      const found = enterable(identity.personId);
      return found ? [{ identity, ...found }] : [];
    });

    /* Every identity's count in one query, not one query each. */
    const now = (parts.now ?? (() => new Date()))();
    const active = accounts.activeSessionCounts(
      enterableIdentities.map(({ account }) => account.id),
      {
        since: new Date(now.getTime() - ACTIVE_SESSION_WINDOW_MS).toISOString(),
        now: now.toISOString(),
      },
    );

    return enterableIdentities.map(({ identity, person, account }) => ({
      id: identity.id,
      name: person.name,
      initials: person.initials,
      title: person.role,
      role: config.label("people.roles", person.accessRole),
      current: person.id === viewerPersonId,
      active: active.get(account.id) ?? 0,
    }));
  };

  /** Both gates. Anything else is not a demonstration. */
  const requireDemonstration = (): void => {
    if (!parts.demoMode) {
      throw ApiError.disabledByInstallation(text("refusal.demo.notADemo"));
    }
    if (identities.count("designated") === 0) {
      throw ApiError.notFound("A demonstration identity");
    }
  };

  /** The browser's previous session ends, so switching does not pile sessions up. */
  const leavePrevious = (currentToken: string | undefined) => {
    if (currentToken) auth.signOut(currentToken);
  };

  return {
    /** What the sign-in screen offers. Nothing at all on an ordinary installation. */
    entry(viewerPersonId?: string): DemoEntry {
      if (!parts.demoMode) {
        return {
          demo: false,
          signedIn: viewerPersonId !== undefined,
          identities: [],
          visitorsWelcome: false,
          refresh: null,
          generation: null,
        };
      }
      const options = offered(viewerPersonId);
      const timeZone = usableTimeZone(parts.timeZone);
      return {
        demo: true,
        signedIn: viewerPersonId !== undefined,
        identities: options,
        visitorsWelcome:
          identities.count("designated") > 0 && identities.count("visitor") < VISITOR_LIMIT,
        refresh: {
          at: nextRefreshAt((parts.now ?? (() => new Date()))(), timeZone).toISOString(),
          timeZone,
        },
        generation: parts.generation?.() ?? null,
      };
    },

    /** Explore as one of the identities the demonstration offers. */
    enter(input: unknown, context: { currentToken?: string; userAgent?: string }): SignedIn {
      requireDemonstration();
      const { identityId } = parse(entryInput, input);

      const identity = identities.find(identityId);
      /* Designated only: a visitor's identity belongs to whoever created it. */
      const found = identity?.kind === "designated" ? enterable(identity.personId) : undefined;
      if (!found) throw ApiError.notFound("That demonstration identity");

      leavePrevious(context.currentToken);
      return auth.beginSessionFor(found.account.id, "demo", context.userAgent);
    },

    /**
     * Try Oikonomia as yourself.
     *
     * An ordinary person with the least-privileged role, no email, and an
     * active account with no credential — reachable only through this entrance,
     * because nothing else signs in to an account that has no password, no
     * Google identity and no address. They start where any new person starts:
     * onboarding.
     */
    createVisitor(
      input: unknown,
      context: { currentToken?: string; userAgent?: string },
    ): SignedIn {
      requireDemonstration();
      const { name } = parse(visitorInput, input);

      const account = parts.transaction(() => {
        if (identities.count("visitor") >= VISITOR_LIMIT) {
          throw ApiError.conflict(text("refusal.demo.full"));
        }
        const person = organization.insertPerson({ name, accessRole: LEAST_PRIVILEGED });
        const created = accounts.create({ personId: person.id, status: "active" });
        identities.insert({ personId: person.id, kind: "visitor" });
        return created;
      });

      leavePrevious(context.currentToken);
      return auth.beginSessionFor(account.id, "demo-visitor", context.userAgent);
    },
  };
}

export type DemoEntryService = ReturnType<typeof createDemoEntryService>;
