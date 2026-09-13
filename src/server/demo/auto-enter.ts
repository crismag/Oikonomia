import type { Database as Db } from "better-sqlite3";

import { createAccountRepository } from "../repositories/account-repository";
import { createDemoIdentityRepository } from "../repositories/demo-identity-repository";
import { createOrganizationRepository } from "../repositories/organization-repository";
import { createAuthService } from "../services/auth-service";
import { createDemoEntryService } from "./demo-entry-service";
import { config } from "@/config";
import { viewerOf, type Viewer } from "@/domain/viewer";

/**
 * A demonstration with nobody signed in has nobody to show.
 *
 * Oikosdemo is always Demo Mode — never the sign-in chooser's whole reason
 * for existing, a church's own installation with real credentials — so a
 * first-time visitor is not asked to pick somebody before they can see
 * anything: this signs them into the first identity the demonstration
 * offers, through the same entrance `enterDemoAs` uses (`demo_identity`,
 * designated only, an ordinary session), just taken on their behalf rather
 * than by a click.
 *
 * The chooser in the demo bar still works afterward — this only removes the
 * *first* click, not the ability to explore as someone else.
 */
export function autoEnterDemo(
  db: Db,
  userAgent: string | undefined,
): { token: string; viewer: Viewer } | undefined {
  const accounts = createAccountRepository(db);
  const organization = createOrganizationRepository(db);
  const identities = createDemoIdentityRepository(db);
  const service = createDemoEntryService({
    demoMode: true,
    identities,
    accounts,
    organization,
    auth: createAuthService(accounts, organization),
    transaction: (work) => db.transaction(work)(),
    timeZone: config.site.timezone,
  });

  /* In display order — the same order the chooser offers them in, so the
     default is whichever identity a curator put first. */
  const first = service.entry().identities[0];
  if (!first) return undefined;

  const { token } = service.enter(
    { identityId: first.id },
    { ...(userAgent ? { userAgent } : {}) },
  );

  const session = accounts.session(token);
  const account = session && accounts.find(session.accountId);
  const person = account && organization.findPerson(account.personId);
  /* Entered a moment ago, in the same transaction-free call; this is not
     expected to fail, but a demonstration silently signing nobody in beats
     one that throws where a page merely wanted to know who is looking. */
  if (!person) return undefined;

  return { token, viewer: viewerOf(person) };
}
